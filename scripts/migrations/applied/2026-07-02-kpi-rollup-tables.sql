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
  status      varchar(16) NOT NULL, -- 'success' | 'error'
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
