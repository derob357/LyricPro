# Vendor KPI Phase 1 — Data Foundation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Nightly KPI rollup pipeline — rollup tables, a `rollup_daily_kpis` Postgres function scheduled by pg_cron, a Vercel cron reconciler, and a backfill script — so the Phase 2 vendor API and Phase 3 dashboard read pre-aggregated data only.

**Architecture:** Hand-written SQL migrations create four rollup tables plus two PL/pgSQL functions; `rollup_kpis_reconcile()` (pg_cron, 07:30 UTC) processes every closed America/New_York day since the last successful run via idempotent delete-day-then-insert. A thin Vercel cron endpoint re-triggers/alerts as backup. Spec: `docs/superpowers/specs/2026-07-02-vendor-kpi-dashboard-api-design.md`.

**Tech Stack:** Postgres (Supabase) + pg_cron, postgres.js (`postgres` pkg), Drizzle ORM, TypeScript strict/ESM, vitest, Vercel serverless crons.

## Global Constraints

- NEVER run `drizzle-kit generate` or `db:push` — hand-written SQL in `scripts/migrations/applied/YYYY-MM-DD-<name>.sql` + `.mjs` runner only.
- The local `.env` DB connection strings point at the PRODUCTION Supabase project. Every `apply`/backfill run hits prod — dry-run first, apply deliberately.
- Canonical reporting timezone: `America/New_York`. All day bucketing uses `AT TIME ZONE 'America/New_York'`.
- Rollup writes are full-day delete-then-insert or `ON CONFLICT ... DO UPDATE` — never increments.
- Raw-table columns are quoted camelCase (`"userId"`, `"startedAt"`, `"shownAt"`, `"createdAt"`, `"responseTimeSeconds"`); NEW tables use snake_case.
- Commit messages: conventional commits, NO Co-Authored-By trailer.
- Env vars by name only, never values in code/commits/chat: `SUPABASE_SESSION_POOLER_STRING`, `SUPABASE_TRANSACTION_POOLER_STRING`, `CRON_SECRET` (already exists).
- TypeScript strict, ESM (`"type": "module"`). Server tests: `pnpm test:server` (vitest, `server/**/*.test.ts`).

---

### Task 1: Rollup tables migration + generic runner

**Files:**

- Create: `scripts/migrations/applied/2026-07-02-kpi-rollup-tables.sql`
- Create: `scripts/apply-kpi-migration.mjs` (generic runner, takes SQL path arg — reused by Task 2)

**Interfaces:**

- Produces: tables `kpi_daily_metrics`, `kpi_daily_song_stats`, `kpi_retention_cohorts`, `rollup_runs` (used by Tasks 2–5); runner `node scripts/apply-kpi-migration.mjs <sql-file> [--dry-run]`.

- [ ] **Step 1: Write the migration SQL**

```sql
-- 2026-07-02-kpi-rollup-tables.sql
-- Vendor KPI Phase 1: rollup tables + supporting raw-table indexes.
-- Spec: docs/superpowers/specs/2026-07-02-vendor-kpi-dashboard-api-design.md
--
-- Idempotent (IF NOT EXISTS on every clause).
-- Applied via: scripts/apply-kpi-migration.mjs scripts/migrations/applied/2026-07-02-kpi-rollup-tables.sql

-- Generic per-day metric rollup. `user_count` = distinct contributing
-- users/guests, stored for k-anonymity suppression at read time.
CREATE TABLE IF NOT EXISTS kpi_daily_metrics (
  date            date NOT NULL,
  metric          varchar(64) NOT NULL,
  dimension       varchar(32) NOT NULL DEFAULT 'all',
  dimension_value varchar(128) NOT NULL DEFAULT 'all',
  value           double precision NOT NULL DEFAULT 0,
  user_count      integer NOT NULL DEFAULT 0,
  computed_at     timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (date, metric, dimension, dimension_value)
);
CREATE INDEX IF NOT EXISTS kpi_daily_metrics_metric_date_idx
  ON kpi_daily_metrics (metric, date);

-- Per-song content stats. Counts/sums (not rates/averages) so rows can be
-- re-aggregated across days at read time.
CREATE TABLE IF NOT EXISTS kpi_daily_song_stats (
  date                 date NOT NULL,
  song_id              integer NOT NULL,
  displays             integer NOT NULL DEFAULT 0,
  rounds_played        integer NOT NULL DEFAULT 0,
  correct_rounds       integer NOT NULL DEFAULT 0,
  response_seconds_sum double precision NOT NULL DEFAULT 0,
  response_count       integer NOT NULL DEFAULT 0,
  user_count           integer NOT NULL DEFAULT 0,
  computed_at          timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (date, song_id)
);
CREATE INDEX IF NOT EXISTS kpi_daily_song_stats_song_idx
  ON kpi_daily_song_stats (song_id, date);

-- Classic bounded retention: cohort = registered users first created on
-- cohort_date (local); retained = active exactly on cohort_date + day_offset.
CREATE TABLE IF NOT EXISTS kpi_retention_cohorts (
  cohort_date    date NOT NULL,
  day_offset     smallint NOT NULL,
  cohort_size    integer NOT NULL DEFAULT 0,
  retained_count integer NOT NULL DEFAULT 0,
  computed_at    timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (cohort_date, day_offset)
);

-- Watermark / bookkeeping. Reconcile processes days after max successful run.
CREATE TABLE IF NOT EXISTS rollup_runs (
  id          serial PRIMARY KEY,
  run_date    date NOT NULL,
  status      varchar(16) NOT NULL, -- 'running' | 'success' | 'error'
  started_at  timestamptz NOT NULL DEFAULT now(),
  finished_at timestamptz,
  error       text
);
CREATE INDEX IF NOT EXISTS rollup_runs_date_idx ON rollup_runs (run_date, status);

-- Raw-table indexes the rollup scans need (skipped automatically if present).
CREATE INDEX IF NOT EXISTS game_sessions_started_at_idx ON game_sessions ("startedAt");
CREATE INDEX IF NOT EXISTS round_results_created_at_idx ON round_results ("createdAt");
CREATE INDEX IF NOT EXISTS golden_note_transactions_created_at_idx ON golden_note_transactions ("createdAt");
CREATE INDEX IF NOT EXISTS users_created_at_idx ON users ("createdAt");
```

- [ ] **Step 2: Write the generic apply runner**

Unlike prior per-migration runners, this one takes the SQL path as an argument and executes the **whole file** via `sql.unsafe` (no statement splitting — Task 2's file contains `CREATE FUNCTION` bodies with embedded semicolons that naive splitting would corrupt). Multi-statement simple-query runs as one implicit transaction.

```javascript
// scripts/apply-kpi-migration.mjs
// Generic runner for the KPI rollup migrations.
// Usage: node scripts/apply-kpi-migration.mjs <path-to-sql> [--dry-run]
// Executes the whole file in one implicit transaction (no statement
// splitting — function bodies contain semicolons).
import postgres from "postgres";
import dotenv from "dotenv";
import fs from "node:fs";
import path from "node:path";

dotenv.config();

const DB_URL =
  process.env.SUPABASE_SESSION_POOLER_STRING ??
  process.env.SUPABASE_DIRECT_CONNECTION_STRING ??
  process.env.DATABASE_URL;
if (!DB_URL) {
  console.error("Set SUPABASE_SESSION_POOLER_STRING in .env");
  process.exit(1);
}

const args = process.argv.slice(2);
const DRY_RUN = args.includes("--dry-run") || args.includes("--dry");
const sqlFile = args.find((a) => !a.startsWith("--"));
if (!sqlFile) {
  console.error("Usage: node scripts/apply-kpi-migration.mjs <path-to-sql> [--dry-run]");
  process.exit(1);
}

const content = fs.readFileSync(path.resolve(sqlFile), "utf8");
console.log(`Migration: ${sqlFile} (${content.length} chars)`);

if (DRY_RUN) {
  console.log("--- DRY RUN: first 40 lines ---");
  console.log(content.split("\n").slice(0, 40).join("\n"));
  console.log("--- no statements executed ---");
  process.exit(0);
}

const sql = postgres(DB_URL, { max: 1, prepare: false });
try {
  await sql.unsafe(content);
  console.log("Applied OK.");
} catch (err) {
  console.error("FAILED:", err.message);
  process.exitCode = 1;
} finally {
  await sql.end();
}
```

- [ ] **Step 3: Dry-run**

Run: `node scripts/apply-kpi-migration.mjs scripts/migrations/applied/2026-07-02-kpi-rollup-tables.sql --dry-run`
Expected: prints file preview, "no statements executed", exit 0.

- [ ] **Step 4: Apply (PROD — deliberate)**

Run: `node scripts/apply-kpi-migration.mjs scripts/migrations/applied/2026-07-02-kpi-rollup-tables.sql`
Expected: `Applied OK.`
Note: the four raw-table indexes build non-concurrently (brief write lock); tables are modest so this is seconds, but run outside a live game burst if possible.

- [ ] **Step 5: Verify tables exist**

```bash
node -e "
import('postgres').then(async ({default: postgres}) => {
  (await import('dotenv')).config();
  const sql = postgres(process.env.SUPABASE_SESSION_POOLER_STRING, { max: 1 });
  const rows = await sql\`SELECT table_name FROM information_schema.tables
    WHERE table_name IN ('kpi_daily_metrics','kpi_daily_song_stats','kpi_retention_cohorts','rollup_runs')\`;
  console.log(rows.map(r => r.table_name).sort());
  await sql.end();
});"
```

Expected: `[ 'kpi_daily_metrics', 'kpi_daily_song_stats', 'kpi_retention_cohorts', 'rollup_runs' ]`

- [ ] **Step 6: Commit**

```bash
git add scripts/migrations/applied/2026-07-02-kpi-rollup-tables.sql scripts/apply-kpi-migration.mjs
git commit -m "feat(kpi): rollup tables migration + generic apply runner"
```

---

### Task 2: Rollup functions + pg_cron migration

**Files:**

- Create: `scripts/migrations/applied/2026-07-02-kpi-rollup-fn.sql`

**Interfaces:**

- Consumes: Task 1 tables; raw tables `game_sessions`, `song_displays`, `round_results`, `users`, `guest_sessions`, `golden_note_transactions`, `addon_game_purchases`, `entry_fee_games`, `prize_payouts`, `subscriptions`, `songs`.
- Produces: `public.rollup_daily_kpis(target_day date) RETURNS void`; `public.rollup_kpis_reconcile() RETURNS TABLE(processed date, run_status text)`; pg_cron job `kpi-daily-rollup` at `30 7 * * *` UTC (02:30 EST / 03:30 EDT).

Metric keys written to `kpi_daily_metrics` (Phase 2 reads these — names are a contract):
`dau`, `wau`, `mau`, `new_users`, `new_guests`, `guest_conversions`, `sessions`, `sessions_with_end`, `session_seconds_sum`, `rounds`, `displays` (dims `all`, `genre`, `decade`), `gn_purchased`, `gn_spent` (dim `kind`), `addon_revenue_usd`, `entry_fee_revenue_usd`, `prizes_paid_usd`, `active_subscriptions` (dim `tier`).

- [ ] **Step 1: Write the functions migration SQL**

```sql
-- 2026-07-02-kpi-rollup-fn.sql
-- Vendor KPI Phase 1: rollup functions + pg_cron schedule.
-- Idempotent: CREATE OR REPLACE; cron.schedule upserts by job name.
-- Applied via: scripts/apply-kpi-migration.mjs scripts/migrations/applied/2026-07-02-kpi-rollup-fn.sql

-- ── Daily rollup: full-day recompute (delete-then-insert = idempotent) ──────
CREATE OR REPLACE FUNCTION public.rollup_daily_kpis(target_day date)
RETURNS void
LANGUAGE plpgsql
AS $fn$
DECLARE
  tz        constant text := 'America/New_York';
  day_start timestamptz;
  day_end   timestamptz;
  wau_start timestamptz;
  mau_start timestamptz;
  o         int;
BEGIN
  day_start := target_day::timestamp AT TIME ZONE tz;
  day_end   := (target_day + 1)::timestamp AT TIME ZONE tz;
  wau_start := (target_day - 6)::timestamp AT TIME ZONE tz;
  mau_start := (target_day - 29)::timestamp AT TIME ZONE tz;

  DELETE FROM kpi_daily_metrics WHERE date = target_day;
  DELETE FROM kpi_daily_song_stats WHERE date = target_day;

  -- Active identities for the day: game session started OR lyric displayed.
  DROP TABLE IF EXISTS _act_day;
  CREATE TEMP TABLE _act_day AS
    SELECT DISTINCT
      COALESCE(s."userId"::text, 'g:' || s."guestToken") AS identity,
      s."userId" AS user_id
    FROM (
      SELECT "userId", "guestToken" FROM game_sessions
        WHERE "startedAt" >= day_start AND "startedAt" < day_end
      UNION ALL
      SELECT "userId", "guestToken" FROM song_displays
        WHERE "shownAt" >= day_start AND "shownAt" < day_end
    ) s
    WHERE s."userId" IS NOT NULL OR s."guestToken" IS NOT NULL;

  -- dau
  INSERT INTO kpi_daily_metrics (date, metric, value, user_count)
  SELECT target_day, 'dau', count(*), count(*) FROM _act_day;

  -- wau / mau (trailing 7 / 30 local days ending target_day, inclusive)
  INSERT INTO kpi_daily_metrics (date, metric, value, user_count)
  SELECT target_day, m.metric, m.v, m.v
  FROM (
    SELECT 'wau' AS metric,
      (SELECT count(DISTINCT COALESCE(s."userId"::text, 'g:' || s."guestToken"))
       FROM (
         SELECT "userId", "guestToken" FROM game_sessions
           WHERE "startedAt" >= wau_start AND "startedAt" < day_end
         UNION ALL
         SELECT "userId", "guestToken" FROM song_displays
           WHERE "shownAt" >= wau_start AND "shownAt" < day_end
       ) s WHERE s."userId" IS NOT NULL OR s."guestToken" IS NOT NULL)::double precision AS v
    UNION ALL
    SELECT 'mau',
      (SELECT count(DISTINCT COALESCE(s."userId"::text, 'g:' || s."guestToken"))
       FROM (
         SELECT "userId", "guestToken" FROM game_sessions
           WHERE "startedAt" >= mau_start AND "startedAt" < day_end
         UNION ALL
         SELECT "userId", "guestToken" FROM song_displays
           WHERE "shownAt" >= mau_start AND "shownAt" < day_end
       ) s WHERE s."userId" IS NOT NULL OR s."guestToken" IS NOT NULL)::double precision
  ) m;

  -- new_users / new_guests
  INSERT INTO kpi_daily_metrics (date, metric, value, user_count)
  SELECT target_day, 'new_users', count(*), count(*)
  FROM users WHERE "createdAt" >= day_start AND "createdAt" < day_end;

  INSERT INTO kpi_daily_metrics (date, metric, value, user_count)
  SELECT target_day, 'new_guests', count(*), count(*)
  FROM guest_sessions WHERE "createdAt" >= day_start AND "createdAt" < day_end;

  -- guest_conversions: users created today whose email matches a guest
  -- session created in the prior 30 days.
  INSERT INTO kpi_daily_metrics (date, metric, value, user_count)
  SELECT target_day, 'guest_conversions', count(DISTINCT u.id), count(DISTINCT u.id)
  FROM users u
  JOIN guest_sessions g
    ON lower(g.email) = lower(u.email)
   AND g."createdAt" < u."createdAt"
   AND g."createdAt" > u."createdAt" - interval '30 days'
  WHERE u."createdAt" >= day_start AND u."createdAt" < day_end
    AND u.email IS NOT NULL;

  -- sessions / durations / rounds
  INSERT INTO kpi_daily_metrics (date, metric, value, user_count)
  SELECT target_day, 'sessions', count(*),
         count(DISTINCT COALESCE("userId"::text, 'g:' || "guestToken"))
  FROM game_sessions WHERE "startedAt" >= day_start AND "startedAt" < day_end;

  INSERT INTO kpi_daily_metrics (date, metric, value, user_count)
  SELECT target_day, 'sessions_with_end', count(*),
         count(DISTINCT COALESCE("userId"::text, 'g:' || "guestToken"))
  FROM game_sessions
  WHERE "startedAt" >= day_start AND "startedAt" < day_end AND "endedAt" IS NOT NULL;

  INSERT INTO kpi_daily_metrics (date, metric, value, user_count)
  SELECT target_day, 'session_seconds_sum',
         COALESCE(sum(EXTRACT(EPOCH FROM ("endedAt" - "startedAt"))), 0),
         count(DISTINCT COALESCE("userId"::text, 'g:' || "guestToken"))
  FROM game_sessions
  WHERE "startedAt" >= day_start AND "startedAt" < day_end AND "endedAt" IS NOT NULL;

  INSERT INTO kpi_daily_metrics (date, metric, value, user_count)
  SELECT target_day, 'rounds', count(*),
         count(DISTINCT COALESCE("activePlayerId"::text, 'g:' || "activeGuestToken"))
  FROM round_results WHERE "createdAt" >= day_start AND "createdAt" < day_end;

  -- displays: all + by genre + by decade
  INSERT INTO kpi_daily_metrics (date, metric, value, user_count)
  SELECT target_day, 'displays', count(*),
         count(DISTINCT COALESCE("userId"::text, 'g:' || "guestToken"))
  FROM song_displays WHERE "shownAt" >= day_start AND "shownAt" < day_end;

  INSERT INTO kpi_daily_metrics (date, metric, dimension, dimension_value, value, user_count)
  SELECT target_day, 'displays', 'genre', s.genre, count(*),
         count(DISTINCT COALESCE(d."userId"::text, 'g:' || d."guestToken"))
  FROM song_displays d JOIN songs s ON s.id = d."songId"
  WHERE d."shownAt" >= day_start AND d."shownAt" < day_end
  GROUP BY s.genre;

  INSERT INTO kpi_daily_metrics (date, metric, dimension, dimension_value, value, user_count)
  SELECT target_day, 'displays', 'decade', s."decadeRange", count(*),
         count(DISTINCT COALESCE(d."userId"::text, 'g:' || d."guestToken"))
  FROM song_displays d JOIN songs s ON s.id = d."songId"
  WHERE d."shownAt" >= day_start AND d."shownAt" < day_end
  GROUP BY s."decadeRange";

  -- monetization
  INSERT INTO kpi_daily_metrics (date, metric, value, user_count)
  SELECT target_day, 'gn_purchased', COALESCE(sum(amount), 0), count(DISTINCT "userId")
  FROM golden_note_transactions
  WHERE kind = 'purchase' AND "createdAt" >= day_start AND "createdAt" < day_end;

  INSERT INTO kpi_daily_metrics (date, metric, dimension, dimension_value, value, user_count)
  SELECT target_day, 'gn_spent', 'kind', kind::text, COALESCE(sum(-amount), 0), count(DISTINCT "userId")
  FROM golden_note_transactions
  WHERE amount < 0 AND "createdAt" >= day_start AND "createdAt" < day_end
  GROUP BY kind;

  INSERT INTO kpi_daily_metrics (date, metric, value, user_count)
  SELECT target_day, 'addon_revenue_usd', COALESCE(sum("totalAmount"), 0), count(DISTINCT "userId")
  FROM addon_game_purchases
  WHERE status = 'completed' AND "createdAt" >= day_start AND "createdAt" < day_end;

  INSERT INTO kpi_daily_metrics (date, metric, value, user_count)
  SELECT target_day, 'entry_fee_revenue_usd',
         COALESCE(sum("entryFeeAmount" * "totalEntriesCollected"), 0), count(*)
  FROM entry_fee_games
  WHERE status = 'completed' AND "completedAt" >= day_start AND "completedAt" < day_end;

  INSERT INTO kpi_daily_metrics (date, metric, value, user_count)
  SELECT target_day, 'prizes_paid_usd', COALESCE(sum(amount), 0), count(DISTINCT "userId")
  FROM prize_payouts
  WHERE status = 'completed' AND "createdAt" >= day_start AND "createdAt" < day_end;

  -- active paid subscriptions snapshot, by tier
  INSERT INTO kpi_daily_metrics (date, metric, dimension, dimension_value, value, user_count)
  SELECT target_day, 'active_subscriptions', 'tier', tier::text, count(*), count(*)
  FROM subscriptions
  WHERE status = 'active' AND tier <> 'free'
    AND ("currentPeriodStart" IS NULL OR "currentPeriodStart" < day_end)
    AND ("currentPeriodEnd" IS NULL OR "currentPeriodEnd" >= day_start)
  GROUP BY tier;

  -- per-song content stats
  INSERT INTO kpi_daily_song_stats
    (date, song_id, displays, rounds_played, correct_rounds,
     response_seconds_sum, response_count, user_count)
  SELECT target_day, s.id,
         COALESCE(d.displays, 0), COALESCE(r.rounds, 0), COALESCE(r.correct, 0),
         COALESCE(r.rt_sum, 0), COALESCE(r.rt_cnt, 0), COALESCE(d.users, 0)
  FROM songs s
  LEFT JOIN (
    SELECT "songId", count(*) AS displays,
           count(DISTINCT COALESCE("userId"::text, 'g:' || "guestToken")) AS users
    FROM song_displays
    WHERE "shownAt" >= day_start AND "shownAt" < day_end
    GROUP BY "songId"
  ) d ON d."songId" = s.id
  LEFT JOIN (
    SELECT "songId", count(*) AS rounds,
           count(*) FILTER (WHERE "lyricPoints" > 0) AS correct,
           COALESCE(sum("responseTimeSeconds"), 0) AS rt_sum,
           count("responseTimeSeconds") AS rt_cnt
    FROM round_results
    WHERE "createdAt" >= day_start AND "createdAt" < day_end
    GROUP BY "songId"
  ) r ON r."songId" = s.id
  WHERE d."songId" IS NOT NULL OR r."songId" IS NOT NULL;

  -- classic bounded retention: cohorts closing today at offsets 1/7/30
  FOREACH o IN ARRAY ARRAY[1, 7, 30] LOOP
    INSERT INTO kpi_retention_cohorts
      (cohort_date, day_offset, cohort_size, retained_count, computed_at)
    SELECT target_day - o, o,
      (SELECT count(*) FROM users u
        WHERE (u."createdAt" AT TIME ZONE tz)::date = target_day - o),
      (SELECT count(*) FROM users u
        JOIN _act_day a ON a.user_id = u.id
        WHERE (u."createdAt" AT TIME ZONE tz)::date = target_day - o),
      now()
    ON CONFLICT (cohort_date, day_offset) DO UPDATE
      SET cohort_size = EXCLUDED.cohort_size,
          retained_count = EXCLUDED.retained_count,
          computed_at = EXCLUDED.computed_at;
  END LOOP;

  DROP TABLE IF EXISTS _act_day;
END;
$fn$;

-- ── Reconcile: process every closed local day since last success ────────────
CREATE OR REPLACE FUNCTION public.rollup_kpis_reconcile()
RETURNS TABLE(processed date, run_status text)
LANGUAGE plpgsql
AS $fn$
DECLARE
  tz         constant text := 'America/New_York';
  closed_day date;
  start_day  date;
  d          date;
BEGIN
  -- one runner at a time (Vercel reconciler + pg_cron could overlap)
  IF NOT pg_try_advisory_lock(hashtext('kpi_rollup')) THEN
    processed := NULL; run_status := 'skipped: lock held'; RETURN NEXT; RETURN;
  END IF;

  closed_day := (now() AT TIME ZONE tz)::date - 1;
  SELECT max(run_date) + 1 INTO start_day FROM rollup_runs WHERE status = 'success';
  IF start_day IS NULL THEN start_day := closed_day; END IF;      -- first ever run: just yesterday
  IF closed_day - start_day > 40 THEN start_day := closed_day - 40; END IF;  -- safety cap

  d := start_day;
  WHILE d <= closed_day LOOP
    BEGIN
      INSERT INTO rollup_runs (run_date, status) VALUES (d, 'running');
      PERFORM public.rollup_daily_kpis(d);
      UPDATE rollup_runs SET status = 'success', finished_at = now()
        WHERE run_date = d AND status = 'running';
      processed := d; run_status := 'success'; RETURN NEXT;
    EXCEPTION WHEN OTHERS THEN
      UPDATE rollup_runs SET status = 'error', finished_at = now(), error = SQLERRM
        WHERE run_date = d AND status = 'running';
      processed := d; run_status := 'error: ' || SQLERRM; RETURN NEXT;
    END;
    d := d + 1;
  END LOOP;

  PERFORM pg_advisory_unlock(hashtext('kpi_rollup'));
END;
$fn$;

-- ── pg_cron schedule (02:30 EST / 03:30 EDT) ────────────────────────────────
DO $$
BEGIN
  CREATE EXTENSION IF NOT EXISTS pg_cron;
EXCEPTION WHEN OTHERS THEN
  RAISE NOTICE 'pg_cron extension not creatable here (%). Enable via Supabase Dashboard -> Database -> Extensions.', SQLERRM;
END $$;

DO $$
BEGIN
  PERFORM cron.schedule('kpi-daily-rollup', '30 7 * * *',
                        'SELECT public.rollup_kpis_reconcile()');
EXCEPTION WHEN OTHERS THEN
  RAISE NOTICE 'cron.schedule failed (%). Schedule manually: SELECT cron.schedule(''kpi-daily-rollup'', ''30 7 * * *'', ''SELECT public.rollup_kpis_reconcile()'');', SQLERRM;
END $$;
```

- [ ] **Step 2: Dry-run, then apply (PROD)**

Run: `node scripts/apply-kpi-migration.mjs scripts/migrations/applied/2026-07-02-kpi-rollup-fn.sql --dry-run`
Expected: preview, exit 0.
Run: `node scripts/apply-kpi-migration.mjs scripts/migrations/applied/2026-07-02-kpi-rollup-fn.sql`
Expected: `Applied OK.` (If a `RAISE NOTICE` about pg_cron appears in server logs, enable the extension in the Supabase Dashboard and re-apply — the file is idempotent.)

- [ ] **Step 3: Smoke-run for yesterday + idempotency check**

```bash
node -e "
import('postgres').then(async ({default: postgres}) => {
  (await import('dotenv')).config();
  const sql = postgres(process.env.SUPABASE_SESSION_POOLER_STRING, { max: 1 });
  const day = (await sql\`SELECT ((now() AT TIME ZONE 'America/New_York')::date - 1)::text AS d\`)[0].d;
  await sql\`SELECT public.rollup_daily_kpis(\${day}::date)\`;
  const a = await sql\`SELECT count(*)::int AS n, COALESCE(sum(value),0) AS s FROM kpi_daily_metrics WHERE date = \${day}::date\`;
  await sql\`SELECT public.rollup_daily_kpis(\${day}::date)\`;   // run twice
  const b = await sql\`SELECT count(*)::int AS n, COALESCE(sum(value),0) AS s FROM kpi_daily_metrics WHERE date = \${day}::date\`;
  console.log('run1:', a[0], 'run2:', b[0], 'idempotent:', a[0].n === b[0].n && a[0].s === b[0].s);
  await sql.end();
});"
```

Expected: `idempotent: true` and `n` > 0 (at least dau/wau/mau/new_users rows exist even on a quiet day).

- [ ] **Step 4: Verify pg_cron job registered**

```bash
node -e "
import('postgres').then(async ({default: postgres}) => {
  (await import('dotenv')).config();
  const sql = postgres(process.env.SUPABASE_SESSION_POOLER_STRING, { max: 1 });
  console.log(await sql\`SELECT jobname, schedule FROM cron.job WHERE jobname = 'kpi-daily-rollup'\`);
  await sql.end();
});"
```

Expected: one row, schedule `30 7 * * *`. (If `relation cron.job does not exist`, enable pg_cron in the dashboard and re-apply the migration.)

- [ ] **Step 5: Commit**

```bash
git add scripts/migrations/applied/2026-07-02-kpi-rollup-fn.sql
git commit -m "feat(kpi): rollup functions + pg_cron nightly schedule"
```

---

### Task 3: Drizzle schema definitions for rollup tables

**Files:**

- Modify: `drizzle/schema.ts` (append after the last table block, before any trailing type exports at EOF)

**Interfaces:**

- Produces: exported consts `kpiDailyMetrics`, `kpiDailySongStats`, `kpiRetentionCohorts`, `rollupRuns` (Phase 2 query layer imports these).

- [ ] **Step 1: Add table definitions**

Ensure `date`, `doublePrecision`, `smallint`, `primaryKey` are in the existing `drizzle-orm/pg-core` import at the top of the file (add any that are missing to that import — most already exist).

```typescript
// ─── Vendor KPI Rollups (Phase 1 — written by rollup_daily_kpis()) ──────────
// Read-only from the app's perspective; the nightly SQL function owns writes.
export const kpiDailyMetrics = pgTable(
  "kpi_daily_metrics",
  {
    date: date("date").notNull(),
    metric: varchar("metric", { length: 64 }).notNull(),
    dimension: varchar("dimension", { length: 32 }).default("all").notNull(),
    dimensionValue: varchar("dimension_value", { length: 128 }).default("all").notNull(),
    value: doublePrecision("value").default(0).notNull(),
    userCount: integer("user_count").default(0).notNull(),
    computedAt: timestamp("computed_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => ({
    pk: primaryKey({ columns: [t.date, t.metric, t.dimension, t.dimensionValue] }),
  }),
);

export const kpiDailySongStats = pgTable(
  "kpi_daily_song_stats",
  {
    date: date("date").notNull(),
    songId: integer("song_id").notNull(),
    displays: integer("displays").default(0).notNull(),
    roundsPlayed: integer("rounds_played").default(0).notNull(),
    correctRounds: integer("correct_rounds").default(0).notNull(),
    responseSecondsSum: doublePrecision("response_seconds_sum").default(0).notNull(),
    responseCount: integer("response_count").default(0).notNull(),
    userCount: integer("user_count").default(0).notNull(),
    computedAt: timestamp("computed_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => ({ pk: primaryKey({ columns: [t.date, t.songId] }) }),
);

export const kpiRetentionCohorts = pgTable(
  "kpi_retention_cohorts",
  {
    cohortDate: date("cohort_date").notNull(),
    dayOffset: smallint("day_offset").notNull(),
    cohortSize: integer("cohort_size").default(0).notNull(),
    retainedCount: integer("retained_count").default(0).notNull(),
    computedAt: timestamp("computed_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => ({ pk: primaryKey({ columns: [t.cohortDate, t.dayOffset] }) }),
);

export const rollupRuns = pgTable("rollup_runs", {
  id: serial("id").primaryKey(),
  runDate: date("run_date").notNull(),
  status: varchar("status", { length: 16 }).notNull(), // running | success | error
  startedAt: timestamp("started_at", { withTimezone: true }).defaultNow().notNull(),
  finishedAt: timestamp("finished_at", { withTimezone: true }),
  error: text("error"),
});
```

- [ ] **Step 2: Typecheck + drizzle sync check**

Run: `pnpm check`
Expected: no errors.
Run: `pnpm db:check`
Expected: passes / reports the new tables in sync (this script compares `drizzle/schema.ts` against the live DB — Tasks 1–2 already created the tables).

- [ ] **Step 3: Commit**

```bash
git add drizzle/schema.ts
git commit -m "feat(kpi): drizzle definitions for rollup tables"
```

---

### Task 4: Reconciler module (TDD) + Vercel cron endpoint

**Files:**

- Create: `server/vendor/kpiReconcile.ts`
- Test: `server/vendor/kpiReconcile.test.ts`
- Create: `api-src/cron/kpi-rollup-reconcile.ts`
- Modify: `vercel.json` (crons block)

**Interfaces:**

- Consumes: `public.rollup_kpis_reconcile()` (Task 2), `getDb()` from `server/db.ts`, `CRON_SECRET` env (already used by existing crons).
- Produces: `runKpiReconcile(db): Promise<KpiReconcileSummary>` where `KpiReconcileSummary = { processed: { day: string; status: string }[]; missingLast7: string[] }`; HTTP endpoint `/api/cron/kpi-rollup-reconcile`.

- [ ] **Step 1: Write the failing test**

```typescript
// server/vendor/kpiReconcile.test.ts
import { describe, expect, it, vi } from "vitest";
import { runKpiReconcile } from "./kpiReconcile";

function makeFakeDb(resultQueue: unknown[][]) {
  let call = 0;
  return {
    execute: vi.fn().mockImplementation(() => Promise.resolve(resultQueue[call++] ?? [])),
  };
}

describe("runKpiReconcile", () => {
  it("returns processed days and missing-day gaps", async () => {
    const db = makeFakeDb([
      [{ day: "2026-07-01", status: "success" }],
      [{ day: "2026-06-28" }],
    ]);

    const summary = await runKpiReconcile(db as never);

    expect(db.execute).toHaveBeenCalledTimes(2);
    expect(summary.processed).toEqual([{ day: "2026-07-01", status: "success" }]);
    expect(summary.missingLast7).toEqual(["2026-06-28"]);
  });

  it("returns empty arrays when nothing to do", async () => {
    const db = makeFakeDb([[], []]);

    const summary = await runKpiReconcile(db as never);

    expect(summary.processed).toEqual([]);
    expect(summary.missingLast7).toEqual([]);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm test:server server/vendor/kpiReconcile.test.ts`
Expected: FAIL — cannot resolve `./kpiReconcile`.

- [ ] **Step 3: Write the implementation**

```typescript
// server/vendor/kpiReconcile.ts
// Triggers the DB-side KPI rollup reconcile and reports gaps for alerting.
// pg_cron is the primary scheduler; the Vercel cron endpoint below is a
// backup trigger + visibility layer (pg_cron failures are silent).
import { sql } from "drizzle-orm";
import type { getDb } from "../db";

type Db = NonNullable<Awaited<ReturnType<typeof getDb>>>;

export interface KpiReconcileSummary {
  processed: { day: string; status: string }[];
  missingLast7: string[];
}

function toRows(result: unknown): Record<string, unknown>[] {
  return Array.isArray(result)
    ? (result as Record<string, unknown>[])
    : Array.from(result as Iterable<Record<string, unknown>>);
}

export async function runKpiReconcile(db: Db): Promise<KpiReconcileSummary> {
  const processedRes = await db.execute(sql`
    SELECT processed::text AS day, run_status AS status
    FROM public.rollup_kpis_reconcile()
    WHERE processed IS NOT NULL
  `);

  const missingRes = await db.execute(sql`
    SELECT gs::date::text AS day
    FROM generate_series(
      (now() AT TIME ZONE 'America/New_York')::date - 7,
      (now() AT TIME ZONE 'America/New_York')::date - 1,
      interval '1 day'
    ) gs
    WHERE NOT EXISTS (
      SELECT 1 FROM rollup_runs r
      WHERE r.run_date = gs::date AND r.status = 'success'
    )
    ORDER BY 1
  `);

  return {
    processed: toRows(processedRes).map((r) => ({
      day: String(r.day),
      status: String(r.status),
    })),
    missingLast7: toRows(missingRes).map((r) => String(r.day)),
  };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm test:server server/vendor/kpiReconcile.test.ts`
Expected: 2 passed.

- [ ] **Step 5: Write the cron endpoint (mirrors chat-retention-sweep pattern)**

```typescript
// api-src/cron/kpi-rollup-reconcile.ts
// Backup trigger + gap alerting for the nightly KPI rollup.
// Primary scheduler is pg_cron job 'kpi-daily-rollup' (07:30 UTC); this runs
// an hour later, re-processes anything pg_cron missed, and surfaces gaps.
//
// Triggered by Vercel Cron — see vercel.json.
// Auth: the CRON_SECRET env var must match the Authorization header.
import type { VercelRequest, VercelResponse } from "@vercel/node";
import { getDb } from "../../server/db";
import { runKpiReconcile } from "../../server/vendor/kpiReconcile";

export default async function handler(req: VercelRequest, res: VercelResponse): Promise<void> {
  const expected = process.env.CRON_SECRET;
  const provided = req.headers.authorization?.replace(/^Bearer\s+/i, "");
  if (!expected || provided !== expected) {
    res.status(401).json({ ok: false, error: "unauthorized" });
    return;
  }

  const db = await getDb();
  if (!db) {
    res.status(500).json({ ok: false, error: "db unavailable" });
    return;
  }

  try {
    const summary = await runKpiReconcile(db);
    if (summary.missingLast7.length > 0) {
      console.error("[kpi-rollup] MISSING DAYS in last 7:", summary.missingLast7.join(", "));
    }
    res.status(200).json({ ok: true, ...summary });
  } catch (err) {
    console.error("[kpi-rollup] reconcile failed:", err);
    res.status(500).json({ ok: false, error: "reconcile failed" });
  }
}

export const config = { maxDuration: 300 };
```

- [ ] **Step 6: Add the cron to vercel.json**

In the existing `"crons"` array, append:

```json
{
  "path": "/api/cron/kpi-rollup-reconcile",
  "schedule": "30 8 * * *"
}
```

- [ ] **Step 7: Typecheck + full server tests**

Run: `pnpm check && pnpm test:server`
Expected: no type errors; all server tests pass.

- [ ] **Step 8: Commit**

```bash
git add server/vendor/kpiReconcile.ts server/vendor/kpiReconcile.test.ts api-src/cron/kpi-rollup-reconcile.ts vercel.json
git commit -m "feat(kpi): reconcile module + backup Vercel cron endpoint"
```

---

### Task 5: Backfill + verification scripts, run backfill

**Files:**

- Create: `scripts/backfill-kpi-rollups.mjs`
- Create: `scripts/verify-kpi-rollups.mjs`

**Interfaces:**

- Consumes: `public.rollup_daily_kpis(date)`, `rollup_runs`, rollup tables.
- Produces: populated history (last 90 days) so Phase 2 launches with data.

- [ ] **Step 1: Write the backfill script**

```javascript
// scripts/backfill-kpi-rollups.mjs
// Backfill KPI rollups day by day (each day = its own transaction, so an
// interruption leaves complete committed days; re-running is idempotent).
// Usage: node scripts/backfill-kpi-rollups.mjs --from 2026-04-03 --to 2026-07-01
import postgres from "postgres";
import dotenv from "dotenv";

dotenv.config();

const DB_URL =
  process.env.SUPABASE_SESSION_POOLER_STRING ??
  process.env.SUPABASE_DIRECT_CONNECTION_STRING ??
  process.env.DATABASE_URL;
if (!DB_URL) {
  console.error("Set SUPABASE_SESSION_POOLER_STRING in .env");
  process.exit(1);
}

function argValue(flag) {
  const i = process.argv.indexOf(flag);
  return i >= 0 ? process.argv[i + 1] : undefined;
}
const from = argValue("--from");
const to = argValue("--to");
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
if (!DATE_RE.test(from ?? "") || !DATE_RE.test(to ?? "") || from > to) {
  console.error("Usage: node scripts/backfill-kpi-rollups.mjs --from YYYY-MM-DD --to YYYY-MM-DD");
  process.exit(1);
}

const sql = postgres(DB_URL, { max: 1, prepare: false });
let ok = 0;
let failed = 0;
try {
  // enumerate days in UTC-safe way (dates only, no TZ math needed)
  for (let d = new Date(`${from}T00:00:00Z`); ; d.setUTCDate(d.getUTCDate() + 1)) {
    const day = d.toISOString().slice(0, 10);
    if (day > to) break;
    try {
      await sql.begin(async (tx) => {
        await tx`SELECT public.rollup_daily_kpis(${day}::date)`;
        await tx`
          INSERT INTO rollup_runs (run_date, status, finished_at)
          VALUES (${day}::date, 'success', now())
        `;
      });
      ok++;
      console.log(`${day} OK`);
    } catch (err) {
      failed++;
      console.error(`${day} FAILED: ${err.message}`);
    }
  }
} finally {
  await sql.end();
}
console.log(`Backfill done: ${ok} ok, ${failed} failed.`);
process.exitCode = failed > 0 ? 1 : 0;
```

- [ ] **Step 2: Write the verification script**

Cross-checks a day's rollups against direct raw-table aggregates.

```javascript
// scripts/verify-kpi-rollups.mjs
// Spot-check rollup values against direct raw-table queries for one day.
// Usage: node scripts/verify-kpi-rollups.mjs --day 2026-07-01
import postgres from "postgres";
import dotenv from "dotenv";

dotenv.config();

const DB_URL =
  process.env.SUPABASE_SESSION_POOLER_STRING ??
  process.env.SUPABASE_DIRECT_CONNECTION_STRING ??
  process.env.DATABASE_URL;
const i = process.argv.indexOf("--day");
const day = i >= 0 ? process.argv[i + 1] : undefined;
if (!DB_URL || !/^\d{4}-\d{2}-\d{2}$/.test(day ?? "")) {
  console.error("Usage: node scripts/verify-kpi-rollups.mjs --day YYYY-MM-DD");
  process.exit(1);
}

const sql = postgres(DB_URL, { max: 1, prepare: false });
try {
  const rolled = Object.fromEntries(
    (await sql`
      SELECT metric, value FROM kpi_daily_metrics
      WHERE date = ${day}::date AND dimension = 'all'
    `).map((r) => [r.metric, Number(r.value)]),
  );

  const [direct] = await sql`
    WITH bounds AS (
      SELECT ${day}::date::timestamp AT TIME ZONE 'America/New_York' AS s,
             (${day}::date + 1)::timestamp AT TIME ZONE 'America/New_York' AS e
    )
    SELECT
      (SELECT count(DISTINCT COALESCE(x."userId"::text, 'g:' || x."guestToken"))
       FROM (
         SELECT "userId", "guestToken" FROM game_sessions, bounds
           WHERE "startedAt" >= bounds.s AND "startedAt" < bounds.e
         UNION ALL
         SELECT "userId", "guestToken" FROM song_displays, bounds
           WHERE "shownAt" >= bounds.s AND "shownAt" < bounds.e
       ) x WHERE x."userId" IS NOT NULL OR x."guestToken" IS NOT NULL
      )::int AS dau,
      (SELECT count(*) FROM game_sessions, bounds
        WHERE "startedAt" >= bounds.s AND "startedAt" < bounds.e)::int AS sessions,
      (SELECT count(*) FROM song_displays, bounds
        WHERE "shownAt" >= bounds.s AND "shownAt" < bounds.e)::int AS displays
  `;

  let pass = true;
  for (const key of ["dau", "sessions", "displays"]) {
    const match = Number(rolled[key] ?? -1) === Number(direct[key]);
    if (!match) pass = false;
    console.log(`${key}: rollup=${rolled[key] ?? "MISSING"} direct=${direct[key]} ${match ? "MATCH" : "MISMATCH"}`);
  }
  // song-stats displays must sum to the 'displays' metric
  const [{ song_sum }] = await sql`
    SELECT COALESCE(sum(displays), 0)::int AS song_sum
    FROM kpi_daily_song_stats WHERE date = ${day}::date
  `;
  const songMatch = Number(song_sum) === Number(direct.displays);
  if (!songMatch) pass = false;
  console.log(`song_stats displays sum: ${song_sum} vs ${direct.displays} ${songMatch ? "MATCH" : "MISMATCH"}`);

  process.exitCode = pass ? 0 : 1;
} finally {
  await sql.end();
}
```

- [ ] **Step 3: Backfill the last 90 days (PROD, deliberate)**

Compute the range: `--to` = yesterday in America/New_York, `--from` = 90 days before that.

Run: `node scripts/backfill-kpi-rollups.mjs --from <yesterday-90d> --to <yesterday>`
Expected: `<N> ok, 0 failed.` (a few minutes; each day is one function call).

- [ ] **Step 4: Verify two sample days**

Run: `node scripts/verify-kpi-rollups.mjs --day <yesterday>` and `node scripts/verify-kpi-rollups.mjs --day <yesterday-30d>`
Expected: all lines `MATCH`, exit 0 for both.

- [ ] **Step 5: Commit**

```bash
git add scripts/backfill-kpi-rollups.mjs scripts/verify-kpi-rollups.mjs
git commit -m "feat(kpi): backfill + verification scripts"
```

---

### Task 6: Post-implementation checks + docs note

**Files:**

- Modify: `todo.md` (repo root — append follow-ups)

- [ ] **Step 1: Security review pass (spec checklist)**

Confirm and note results:
- `/api/cron/kpi-rollup-reconcile` rejects requests without `Bearer $CRON_SECRET` (curl it deployed or via `vercel dev`: expect 401).
- No PII lands in rollup tables (columns are counts/sums only — inspect `SELECT * FROM kpi_daily_metrics LIMIT 5`).
- No secrets in any committed file: `git log -p --since=today | grep -iE 'postgres(ql)?://|sk_live|whsec' | wc -l` → expect `0`.

- [ ] **Step 2: Next-morning verification (async follow-up)**

The morning after deploy, confirm the pipeline ran unattended:

```sql
SELECT run_date, status FROM rollup_runs ORDER BY run_date DESC LIMIT 3;
SELECT jobname, start_time, status FROM cron.job_run_details
  ORDER BY start_time DESC LIMIT 3;
```

Expected: yesterday's `run_date` with `status = 'success'`; a pg_cron run entry.

- [ ] **Step 3: Append follow-ups to todo.md**

```markdown
## Vendor KPI Phase 1 follow-ups (2026-07-02)
- [ ] Morning-after check: rollup_runs has yesterday = success (see plan Task 6)
- [ ] Phase 2 plan: vendor tables + enum, API keys, REST endpoints, admin Vendors tab
- [ ] Consider BRIN index on song_displays("shownAt") when table exceeds ~10M rows
- [ ] Spec's timezone-boundary test (23:55 local event lands in correct day) not run — single-Supabase topology means no scratch DB for synthetic events; verify manually with SELECT rollup vs a known late-evening event once one occurs
- [ ] gn_purchased is in GN units; addon/entry-fee/prizes are USD — definitions footnote must state units (Phase 2)
```

- [ ] **Step 4: Commit**

```bash
git add todo.md
git commit -m "chore(kpi): phase 1 follow-ups"
```
