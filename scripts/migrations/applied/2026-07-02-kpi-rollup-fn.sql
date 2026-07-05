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
         -- totalEntriesCollected is already total dollars collected (fee × participants,
         -- computed at write time in db-monetization.ts) — do NOT multiply by the fee again.
         COALESCE(sum("totalEntriesCollected"), 0),
         COALESCE((SELECT count(DISTINCT p."userId")
                   FROM entry_fee_participants p
                   JOIN entry_fee_games g2 ON g2.id = p."entryFeeGameId"
                   WHERE g2.status = 'completed'
                     AND g2."completedAt" >= day_start AND g2."completedAt" < day_end), 0)
  FROM entry_fee_games
  WHERE status = 'completed' AND "completedAt" >= day_start AND "completedAt" < day_end;

  INSERT INTO kpi_daily_metrics (date, metric, value, user_count)
  SELECT target_day, 'prizes_paid_usd', COALESCE(sum(amount), 0), count(DISTINCT "userId")
  FROM prize_payouts
  WHERE status = 'completed' AND "createdAt" >= day_start AND "createdAt" < day_end;

  -- NOTE: snapshot of LIVE subscription state — not reproducible for historical backfill; backfilled days reflect state at rollup time.
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

-- ── Reconcile: heal every missing closed local day in the window ────────────
CREATE OR REPLACE FUNCTION public.rollup_kpis_reconcile()
RETURNS TABLE(processed date, run_status text)
LANGUAGE plpgsql
AS $fn$
DECLARE
  tz         constant text := 'America/New_York';
  closed_day date;
  floor_day  date;
  d          date;
BEGIN
  -- xact-scoped lock: auto-released on commit OR abort — no leak path
  IF NOT pg_try_advisory_xact_lock(hashtext('kpi_rollup')) THEN
    processed := NULL; run_status := 'skipped: lock held'; RETURN NEXT; RETURN;
  END IF;

  closed_day := (now() AT TIME ZONE tz)::date - 1;

  IF NOT EXISTS (SELECT 1 FROM rollup_runs WHERE status = 'success') THEN
    -- First ever run: just the last closed day (history comes via backfill).
    floor_day := closed_day;
  ELSE
    -- Heal ANY day missing a success row in the window — a day that failed
    -- must not be orphaned just because a later day succeeded.
    SELECT GREATEST(min(run_date), closed_day - 40) INTO floor_day
    FROM rollup_runs WHERE status = 'success';
  END IF;

  FOR d IN
    SELECT gs::date
    FROM generate_series(floor_day, closed_day, interval '1 day') gs
    WHERE NOT EXISTS (
      SELECT 1 FROM rollup_runs r
      WHERE r.run_date = gs::date AND r.status = 'success'
    )
    ORDER BY 1
  LOOP
    BEGIN
      PERFORM public.rollup_daily_kpis(d);
      INSERT INTO rollup_runs (run_date, status, finished_at)
      VALUES (d, 'success', now());
      processed := d; run_status := 'success'; RETURN NEXT;
    EXCEPTION WHEN OTHERS THEN
      -- The subxact rolled back all of rollup_daily_kpis' writes; persist the
      -- failure with a FRESH insert (updating a row written inside the failed
      -- subxact would match nothing).
      INSERT INTO rollup_runs (run_date, status, finished_at, error)
      VALUES (d, 'error', now(), SQLERRM);
      processed := d; run_status := 'error: ' || SQLERRM; RETURN NEXT;
    END;
  END LOOP;
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
