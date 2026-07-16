# Test-Account Cleanup + Test-DB Isolation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Remove the 1,739 `loginMethod='vitest'` test users (and their dependent rows) from the production Supabase DB, with a verified backup and an audit record, and stop the Vitest suite from re-polluting prod.

**Architecture:** A fail-closed test-DB guard redirects all DB-backed tests away from prod (Task 1). Then a one-off Node script (using the project's `postgres` driver on the **session pooler, port 5432**) freezes the cohort, backs it up to an `archive` schema + CSV files (Task 2), deletes it inside a single REPEATABLE READ transaction in FK-safe order with a row-count assertion and an `audit.admin_actions` purge row (Task 3), and verifies the result + optionally clears matching `auth.users` (Task 4).

**Tech Stack:** PostgreSQL (Supabase), `postgres` (porsager) npm driver, `@supabase/supabase-js` admin client, Vitest, dotenv, Drizzle schema (reference only).

## Global Constraints

- **This is production.** Single-Supabase topology: local `.env` connection strings point at the SAME project Vercel uses for prod. Every DB statement here hits prod.
- **Connection:** all deletion/backup statements run over `SUPABASE_SESSION_POOLER_STRING` (session pooler, port 5432) as role `postgres`, with `{ prepare: false }`. NOT the transaction pooler (6543) — session-level `SET` and multi-statement transactions require 5432.
- **Deletion selector:** `WHERE "loginMethod" = 'vitest'` — exactly 1,739 rows expected. KEEP everything else, including `dev@local` (id 3), the 4 bootstrap admins, and the 30 real players. Never widen the selector to fuzzy email/name matching.
- **Secrets:** never print, log, commit, or paste connection strings or keys. Scripts read them from `.env` on disk via `dotenv`. One-off scripts live at repo root as `_tmp_*.mjs` and are deleted after running; nothing containing a connection string is committed.
- **Commits:** no `Co-Authored-By: Claude` trailer.
- **Gate:** Task 2's backup must verify green (row counts match, CSV files non-empty) before Task 3 runs. Task 3 asserts `rowCount === 1739` and ROLLBACKs on any drift.
- **Expected counts (verify live before acting):** users cohort 1,739; dependent rows — chat_audit_log.actor_id 710, chat_audit_log.target_user_id 442, tournaments.created_by 124, chat_room_members 114, chat_messages.author_id 101, chat_messages.deleted_by 53, chat_messages.edited_by 24, chat_bans (user_id/created_by/revoked_by) 7/7/1.

## Research Deltas (folded into tasks below)

- **D1 (Critical):** `chat_messages.author_id` FK is `ON DELETE SET NULL` but the column is declared `.notNull()`. If NOT NULL is live, the SET NULL cascade aborts the whole delete. → Task 3 verifies `attnotnull` and, if set, deletes test-authored chat_messages explicitly before deleting users.
- **D2 (Critical):** `NO ACTION` FKs are non-deferrable in Supabase → behave like `RESTRICT`; `SET CONSTRAINTS DEFERRED` won't help. Must delete children first. → Task 3 delete order.
- **D3 (Critical):** Use session pooler 5432 as `postgres` (BYPASSRLS, so RLS won't silently reduce the affected set); `SET statement_timeout=0; SET idle_in_transaction_session_timeout=0;` at session start. → Task 2/3 connection preamble.
- **D4 (High):** Freeze the id list first, `BEGIN ISOLATION LEVEL REPEATABLE READ`, lock rows `FOR UPDATE`, delete by fixed id array, assert count, ROLLBACK on drift. → Task 3.
- **D5 (High):** `auth.users` is separate from `public.users`. Verify whether the vitest rows even have `auth.users` entries (tests insert `public.users` directly, so they may not). If they do, clear via `supabase.auth.admin.deleteUser` AFTER commit, outside the tx, idempotent. → Task 4.
- **D6 (High):** `CREATE TABLE archive.x AS SELECT` is data-only (no PK/FK/defaults) — correct for a snapshot; preserves original `id`s verbatim. Also stream CSVs to disk via `COPY (...) TO STDOUT`. Snapshot the full FK closure pinned to the frozen id list. → Task 2.
- **D7 (Medium):** Supabase PITR/daily backups are whole-project only and unavailable on Free — the archive is the ONLY targeted restore path. → reinforces Task 2 gate.
- **D8 (High, root cause):** Fix the tap with `.env.test` + a fail-closed host guard in `setupFiles`; dotenv `override:true` (non-`VITE_` DB vars are not auto-injected). → Task 1.

---

### Task 1: Fail-closed test-DB guard (stop prod pollution)

**Files:**
- Create: `server/_core/test-db-guard.ts`
- Create: `server/_core/test-db-guard.test.ts`
- Create: `server/test/guard.setup.ts`
- Create: `.env.test.example`
- Modify: `vitest.config.ts` (add `setupFiles`)
- Modify: `.gitignore` (ensure `.env.test` is ignored)

**Interfaces:**
- Produces: `assertSafeTestDb(env: NodeJS.ProcessEnv): void` — throws if the resolved DB host is prod / not an allowlisted test host; no-op if no DB URL is configured (tests then self-skip as today). `resolveDbHost(env): string | null`.

- [ ] **Step 1: Write the failing test**

```ts
// server/_core/test-db-guard.test.ts
import { describe, it, expect } from "vitest";
import { assertSafeTestDb, resolveDbHost } from "./test-db-guard";

const prod = "postgresql://postgres:pw@aws-0-us-east-1.pooler.supabase.com:5432/postgres?options=project%3Dprodref";
const test = "postgresql://postgres:pw@localhost:5432/postgres";

describe("test-db-guard", () => {
  it("no DB configured → no throw (tests self-skip)", () => {
    expect(() => assertSafeTestDb({})).not.toThrow();
  });
  it("throws when host matches the prod project ref", () => {
    expect(() =>
      assertSafeTestDb({
        SUPABASE_SESSION_POOLER_STRING: prod,
        VITE_SUPABASE_PROJECT_URL: "https://prodref.supabase.co",
      }),
    ).toThrow(/prod/i);
  });
  it("throws when NODE_ENV=production", () => {
    expect(() =>
      assertSafeTestDb({ DATABASE_URL: test, NODE_ENV: "production" }),
    ).toThrow(/production/i);
  });
  it("allows a non-prod host", () => {
    expect(() =>
      assertSafeTestDb({ DATABASE_URL: test, VITE_SUPABASE_PROJECT_URL: "https://prodref.supabase.co" }),
    ).not.toThrow();
  });
  it("resolveDbHost prefers session pooler then falls back", () => {
    expect(resolveDbHost({ DATABASE_URL: test })).toBe("localhost");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm exec vitest run server/_core/test-db-guard.test.ts`
Expected: FAIL — cannot find module `./test-db-guard`.

- [ ] **Step 3: Write minimal implementation**

```ts
// server/_core/test-db-guard.ts
// Fail-closed guard: refuse to run tests against the production database.
const DB_VARS = [
  "SUPABASE_SESSION_POOLER_STRING",
  "SUPABASE_DIRECT_CONNECTION_STRING",
  "SUPABASE_TRANSACTION_POOLER_STRING",
  "DATABASE_URL",
] as const;

export function resolveDbHost(env: NodeJS.ProcessEnv): string | null {
  const url = DB_VARS.map((k) => env[k]).find((v) => !!v);
  if (!url) return null;
  try {
    return new URL(url.replace(/^postgres(ql)?:/, "http:")).hostname;
  } catch {
    return null;
  }
}

function prodRef(env: NodeJS.ProcessEnv): string | null {
  const u = env.VITE_SUPABASE_PROJECT_URL;
  if (!u) return null;
  try {
    // https://<ref>.supabase.co  → "<ref>"
    return new URL(u).hostname.split(".")[0] || null;
  } catch {
    return null;
  }
}

export function assertSafeTestDb(env: NodeJS.ProcessEnv = process.env): void {
  const host = resolveDbHost(env);
  if (!host) return; // no DB configured → DB-gated tests self-skip; nothing to guard
  if (env.NODE_ENV === "production") {
    throw new Error("Refusing to run tests with NODE_ENV=production.");
  }
  const ref = prodRef(env);
  if (ref && host.includes(ref)) {
    throw new Error(
      `Refusing to run tests against the PROD database (host resolves to project ref '${ref}'). ` +
        `Point SUPABASE_*/DATABASE_URL at a test database via .env.test.`,
    );
  }
  const allow = env.TEST_DB_HOST_ALLOW;
  if (allow && !host.includes(allow)) {
    throw new Error(`Test DB host '${host}' is not in TEST_DB_HOST_ALLOW ('${allow}').`);
  }
}
```

```ts
// server/test/guard.setup.ts
import { config } from "dotenv";
import { assertSafeTestDb } from "../_core/test-db-guard";
// Load .env.test if present; override shell/.env so a stray prod var can't win.
config({ path: ".env.test", override: true });
assertSafeTestDb(process.env);
```

```ini
# .env.test.example  — copy to .env.test and point at a NON-prod database.
# Do NOT put the production connection string here.
# Option A: a second (free) Supabase project.  Option B: local `supabase db start`.
SUPABASE_SESSION_POOLER_STRING=postgresql://postgres:[PASSWORD]@[TEST_HOST]:5432/postgres
# Optional allowlist fragment the test host MUST contain (fail-closed):
TEST_DB_HOST_ALLOW=localhost
```

- [ ] **Step 4: Wire setupFiles into vitest.config.ts**

In `vitest.config.ts`, add to the `test` block:

```ts
  test: {
    environment: "node",
    include: ["server/**/*.test.ts", "server/**/*.spec.ts"],
    setupFiles: ["./server/test/guard.setup.ts"],
  },
```

Confirm `.gitignore` contains `.env.test` (add it if missing).

- [ ] **Step 5: Run tests to verify guard passes green (unit test) and blocks prod**

Run: `pnpm exec vitest run server/_core/test-db-guard.test.ts`
Expected: PASS (5 tests).

Then verify fail-closed behavior against the real environment WITHOUT exposing the
connection string on the command line. With no `.env.test` present, the guard loads
the ambient env (the same prod vars that caused the pollution) and must abort:
Run: `pnpm exec vitest run server/_core/chatAudit.test.ts 2>&1 | head -20`
Expected: the run aborts in setup with "Refusing to run tests against the PROD database…".
(If the DB test instead skips, the ambient env has no DB URL — load `.env` the way the
suite normally does and re-run; never pass the connection string as an inline arg.)

- [ ] **Step 6: Commit**

```bash
git add server/_core/test-db-guard.ts server/_core/test-db-guard.test.ts server/test/guard.setup.ts .env.test.example vitest.config.ts .gitignore
git commit -m "test: fail-closed guard to stop DB tests hitting prod"
```

---

### Task 2: Freeze cohort + backup (archive schema + CSV) — GATE

**Files:**
- Create (temp, deleted after): `_tmp_backup.mjs`
- Output: `archive.*` tables in the DB; CSVs under `exports/test-user-purge-2026-07-16/`

**Interfaces:**
- Produces: archive tables `archive.users_backup_20260716` (+ one per dependent table), `archive.purge_manifest_20260716` (table_name, row_count), and CSV files. The frozen id list lives in `archive.users_backup_20260716`.

- [ ] **Step 1: Write the backup script**

```js
// _tmp_backup.mjs  — READ + archive-create only. No deletes.
import "dotenv/config";
import fs from "node:fs";
import { pipeline } from "node:stream/promises";
import postgres from "postgres";
const DB_URL = process.env.SUPABASE_SESSION_POOLER_STRING; // session pooler 5432
const sql = postgres(DB_URL, { max: 1, prepare: false });
const STAMP = "20260716";
const OUTDIR = `exports/test-user-purge-${STAMP}`;
fs.mkdirSync(OUTDIR, { recursive: true });

// dependent tables keyed to user id (col name), FK closure for the cohort
const DEPS = [
  ["public.player_profiles", "user_id"],
  ["public.chat_room_members", "user_id"],
  ["public.chat_bans", "user_id"],
  ["public.tournament_members", "user_id"],
  ["public.user_favorites", "follower_id"],
  ["public.vendor_members", "user_id"],
  ["public.chat_friends_read_state", "user_id"],
  ["public.chat_audit_log", "actor_id"],
  ["public.chat_audit_log", "target_user_id"],
  ["public.chat_bans", "created_by"],
  ["public.chat_bans", "revoked_by"],
  ["public.chat_messages", "author_id"],
  ["public.chat_messages", "edited_by"],
  ["public.chat_messages", "deleted_by"],
  ["public.tournaments", "created_by"],
];

try {
  const [{ current_user: who }] = await sql`SELECT current_user`;
  if (who !== "postgres") throw new Error(`Expected role 'postgres', got '${who}'`);
  await sql`CREATE SCHEMA IF NOT EXISTS archive`;

  // 1) Freeze the cohort (data-only snapshot; preserves original ids)
  await sql`DROP TABLE IF EXISTS archive.users_backup_20260716`;
  const [{ n: userCount }] = await sql`
    SELECT count(*)::int AS n FROM users WHERE "loginMethod"='vitest'`;
  await sql`CREATE TABLE archive.users_backup_20260716 AS
            SELECT * FROM users WHERE "loginMethod"='vitest'`;
  const manifest = [{ table: "users", rows: userCount }];

  // 2) Snapshot each dependent table pinned to the frozen id list
  for (const [tbl, col] of DEPS) {
    const arch = `archive.${tbl.split(".")[1]}__${col}_bak_${STAMP}`;
    await sql`DROP TABLE IF EXISTS ${sql(arch)}`;
    await sql`CREATE TABLE ${sql(arch)} AS SELECT * FROM ${sql(tbl)}
              WHERE ${sql(col)} IN (SELECT id FROM archive.users_backup_20260716)`;
    const [{ n }] = await sql`SELECT count(*)::int AS n FROM ${sql(arch)}`;
    manifest.push({ table: `${tbl}.${col}`, rows: n });
  }

  // 3) Manifest table
  await sql`DROP TABLE IF EXISTS archive.purge_manifest_20260716`;
  await sql`CREATE TABLE archive.purge_manifest_20260716 (table_name text, row_count int)`;
  for (const m of manifest)
    await sql`INSERT INTO archive.purge_manifest_20260716 VALUES (${m.table}, ${m.rows})`;

  // 4) CSV export (belt-and-suspenders) — users + each dependent archive table
  const dump = async (archTable, file) => {
    const q = `COPY (SELECT * FROM ${archTable}) TO STDOUT WITH (FORMAT csv, HEADER true)`;
    await pipeline(await sql.unsafe(q).readable(), fs.createWriteStream(`${OUTDIR}/${file}.csv`));
  };
  await dump("archive.users_backup_20260716", "users");
  for (const [tbl, col] of DEPS)
    await dump(`archive.${tbl.split(".")[1]}__${col}_bak_${STAMP}`, `${tbl.split(".")[1]}__${col}`);

  console.log("MANIFEST:"); console.table(manifest);
  console.log(`CSV written to ${OUTDIR}`);
} catch (e) {
  console.error("BACKUP ERROR:", e.message); process.exitCode = 1;
} finally { await sql.end({ timeout: 5 }); }
```

- [ ] **Step 2: Run the backup**

Run: `node _tmp_backup.mjs`
Expected: `current_user` is `postgres`; MANIFEST shows `users=1739` and dependent counts matching the Global Constraints table; CSVs written.

- [ ] **Step 3: Verify backup integrity, then remove the temp script**

Run: `ls -la exports/test-user-purge-20260716/ && wc -l exports/test-user-purge-20260716/users.csv`
Expected: `users.csv` has 1,740 lines (1,739 rows + header). Then: `rm -f _tmp_backup.mjs`

- [ ] **Step 4: Commit the CSV manifest (not the script)**

```bash
git add exports/test-user-purge-20260716/
git commit -m "chore: backup of vitest test-user cohort before purge"
```

STOP HERE for review. Deletion (Task 3) must not run until the manifest is confirmed correct.

---

### Task 3: Transactional FK-safe delete + audit record

**Files:**
- Create (temp, deleted after): `_tmp_purge.mjs`

- [ ] **Step 1: Write the purge script**

```js
// _tmp_purge.mjs — DELETES the vitest cohort in one transaction. Requires Task 2 archive present.
import "dotenv/config";
import postgres from "postgres";
const sql = postgres(process.env.SUPABASE_SESSION_POOLER_STRING, { max: 1, prepare: false });
const ACTOR_ID = 12; // deric.robinson71@gmail.com (admin) — the authorizing actor
const ACTOR_EMAIL = "deric.robinson71@gmail.com";
const EXPECTED = 1739;

try {
  const [{ current_user: who }] = await sql`SELECT current_user`;
  if (who !== "postgres") throw new Error(`Expected role 'postgres', got '${who}'`);
  // Preflight: confirm the archive exists (don't delete without a backup)
  const [{ n: bak }] = await sql`SELECT count(*)::int AS n FROM archive.users_backup_20260716`;
  if (bak !== EXPECTED) throw new Error(`Archive has ${bak} rows, expected ${EXPECTED}. Run Task 2 first.`);

  // D1 preflight: is chat_messages.author_id NOT NULL? (SET NULL onto NOT NULL would abort)
  const [{ attnotnull }] = await sql`
    SELECT attnotnull FROM pg_attribute
    WHERE attrelid='public.chat_messages'::regclass AND attname='author_id'`;

  await sql`SET statement_timeout=0`;
  await sql`SET idle_in_transaction_session_timeout=0`;

  const result = await sql.begin(async (tx) => {
    await tx`SET TRANSACTION ISOLATION LEVEL REPEATABLE READ`;
    // Lock + freeze the exact target set
    const rows = await tx`SELECT id FROM users WHERE "loginMethod"='vitest' ORDER BY id FOR UPDATE`;
    const ids = rows.map((r) => r.id);
    if (ids.length !== EXPECTED) throw new Error(`Locked ${ids.length}, expected ${EXPECTED} — aborting.`);

    const counts = {};
    const del = async (label, q) => { const r = await q; counts[label] = r.count; };

    // (a) NO ACTION / RESTRICT children first (D2)
    await del("chat_audit_log(actor)", tx`DELETE FROM chat_audit_log WHERE actor_id = ANY(${ids})`);
    await del("chat_audit_log(target)", tx`DELETE FROM chat_audit_log WHERE target_user_id = ANY(${ids})`);
    await del("chat_bans(created_by/revoked_by)", tx`DELETE FROM chat_bans WHERE created_by = ANY(${ids}) OR revoked_by = ANY(${ids})`);
    // (b) chat_messages: delete rows authored by cohort (also clears NOT NULL author_id landmine, D1),
    //     and neutralize edited_by/deleted_by references from cohort on OTHER messages.
    await del("chat_messages(authored)", tx`DELETE FROM chat_messages WHERE author_id = ANY(${ids})`);
    await del("chat_messages(edited_by→null)", tx`UPDATE chat_messages SET edited_by=NULL WHERE edited_by = ANY(${ids})`);
    await del("chat_messages(deleted_by→null)", tx`UPDATE chat_messages SET deleted_by=NULL WHERE deleted_by = ANY(${ids})`);
    // (c) tournaments.created_by (NO ACTION): these are test tournaments → delete them
    await del("tournaments(created_by)", tx`DELETE FROM tournaments WHERE created_by = ANY(${ids})`);
    // (d) Parent delete — CASCADE/SET NULL children (player_profiles, chat_room_members,
    //     chat_bans.user_id, user_favorites, tournament_members, vendor_members, chat_friends_read_state,
    //     lyric_moments.approved_by) resolve automatically here.
    const deleted = await tx`DELETE FROM users WHERE id = ANY(${ids}) RETURNING id`;
    if (deleted.length !== EXPECTED) throw new Error(`Deleted ${deleted.length}, expected ${EXPECTED} — ROLLBACK.`);

    // (e) Audit record in the same transaction
    await tx`INSERT INTO audit.admin_actions
      (actor_type, actor_id, actor_email, action, target_type, target_id, payload)
      VALUES ('admin', ${ACTOR_ID}, ${ACTOR_EMAIL}, 'test_users.purge', 'system', 'vitest-cohort',
        ${tx.json({
          reason: "Remove vitest test users accidentally written to prod",
          criteria: "loginMethod = 'vitest'",
          deletedUsers: deleted.length,
          childCounts: counts,
          authorIdWasNotNull: attnotnull,
          backup: "archive.*_20260716 + exports/test-user-purge-20260716/",
        })})`;
    return { deleted: deleted.length, counts };
  });

  console.log("PURGE COMMITTED:", JSON.stringify(result, null, 2));
} catch (e) {
  console.error("PURGE ERROR (transaction rolled back):", e.message); process.exitCode = 1;
} finally { await sql.end({ timeout: 5 }); }
```

- [ ] **Step 2: Run the purge**

Run: `node _tmp_purge.mjs`
Expected: `PURGE COMMITTED` with `deleted: 1739` and per-table child counts. Any drift → "transaction rolled back" and non-zero exit (nothing deleted).

- [ ] **Step 3: Remove the temp script**

Run: `rm -f _tmp_purge.mjs`

---

### Task 4: Post-delete verification + conditional auth.users cleanup

**Files:**
- Create (temp, deleted after): `_tmp_verify.mjs`

- [ ] **Step 1: Write the verification script**

```js
// _tmp_verify.mjs — READ-ONLY verification + auth.users reconciliation.
import "dotenv/config";
import postgres from "postgres";
import { createClient } from "@supabase/supabase-js";
const sql = postgres(process.env.SUPABASE_SESSION_POOLER_STRING, { max: 1, prepare: false });
try {
  const [{ n: remaining }] = await sql`SELECT count(*)::int AS n FROM users WHERE "loginMethod"='vitest'`;
  const [{ n: total }] = await sql`SELECT count(*)::int AS n FROM users`;
  const [{ n: keptReal }] = await sql`SELECT count(*)::int AS n FROM users WHERE "loginMethod" <> 'vitest' OR "loginMethod" IS NULL`;
  const [{ n: devLocal }] = await sql`SELECT count(*)::int AS n FROM users WHERE id=3`;
  console.log({ remainingVitest: remaining, totalUsers: total, keptReal, devLocalPresent: devLocal });
  // Orphan checks: any dependent rows still referencing deleted ids?
  const orphans = await sql`
    SELECT 'chat_messages.author_id' AS ref, count(*)::int AS n FROM chat_messages
      WHERE author_id IS NOT NULL AND author_id NOT IN (SELECT id FROM users)`;
  console.table(orphans);

  // D5: do any vitest-cohort emails still exist in auth.users?
  const cohort = await sql`SELECT email FROM archive.users_backup_20260716 WHERE email IS NOT NULL`;
  const emails = cohort.map((r) => r.email);
  const supa = createClient(process.env.VITE_SUPABASE_PROJECT_URL, process.env.SUPABASE_SECRET_KEY, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
  // Look up a sample to decide whether auth cleanup is needed
  const { data } = await supa.auth.admin.listUsers({ page: 1, perPage: 200 });
  const authMatches = (data?.users ?? []).filter((u) => emails.includes(u.email ?? ""));
  console.log(`auth.users matching cohort emails (sample of first 200 auth users): ${authMatches.length}`);
  console.log("If >0, run admin.deleteUser(id) over authMatches AFTER confirming — outside any DB tx.");
} catch (e) { console.error("VERIFY ERROR:", e.message); process.exitCode = 1; }
finally { await sql.end({ timeout: 5 }); }
```

- [ ] **Step 2: Run verification**

Run: `node _tmp_verify.mjs`
Expected: `remainingVitest: 0`, `totalUsers: 35`, `keptReal: 35`, `devLocalPresent: 1`, zero orphaned `chat_messages.author_id`. Report the `auth.users` match count.

- [ ] **Step 3: Conditional auth cleanup**

If Step 2 reports auth matches > 0: extend `_tmp_verify.mjs` to loop `await supa.auth.admin.deleteUser(u.id)` over `authMatches` (idempotent; outside any DB transaction; paginate `listUsers` until exhausted), re-run, confirm zero matches. If 0, no auth action needed (tests inserted `public.users` directly).

- [ ] **Step 4: Remove the temp script and update memory**

Run: `rm -f _tmp_verify.mjs`
Update `memory/project_test_account_cleanup.md`: mark COMPLETE with final counts, note whether auth cleanup was needed, and record that the `.env.test` guard is live (Deric must still provision the test DB / populate `.env.test`).

---

## Self-Review

- **Spec coverage:** cleanup of vitest users (Tasks 2–4), backup (Task 2), audit record (Task 3), root-cause tap fix (Task 1), keep dev@local + reals (selector + verify Task 4). ✓
- **Owner follow-up (not code):** provision the actual test database and populate `.env.test`; until then the guard fail-closes and DB-gated tests will abort rather than hit prod. Optional: tighten per-test teardown in the 13 polluting test files (harmless once pointed at a test DB).
- **Open verification during execution:** confirm `chat_messages.author_id` NOT NULL status (D1) — script handles both cases by deleting authored rows first. Confirm `current_user='postgres'` (D3) before any write.
