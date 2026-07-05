-- ALREADY APPLIED TO PROD (manually, 2026-07-05) via
-- scripts/migrations/applied/2026-07-02-kpi-rollup-tables.sql — which also
-- created secondary/raw-table indexes not tracked by drizzle. Kept for
-- drizzle journal coherence; do NOT re-apply.
CREATE TABLE "kpi_daily_metrics" (
	"date" date NOT NULL,
	"metric" varchar(64) NOT NULL,
	"dimension" varchar(32) DEFAULT 'all' NOT NULL,
	"dimension_value" varchar(128) DEFAULT 'all' NOT NULL,
	"value" double precision DEFAULT 0 NOT NULL,
	"user_count" integer DEFAULT 0 NOT NULL,
	"computed_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "kpi_daily_metrics_date_metric_dimension_dimension_value_pk" PRIMARY KEY("date","metric","dimension","dimension_value")
);
--> statement-breakpoint
CREATE TABLE "kpi_daily_song_stats" (
	"date" date NOT NULL,
	"song_id" integer NOT NULL,
	"displays" integer DEFAULT 0 NOT NULL,
	"rounds_played" integer DEFAULT 0 NOT NULL,
	"correct_rounds" integer DEFAULT 0 NOT NULL,
	"response_seconds_sum" double precision DEFAULT 0 NOT NULL,
	"response_count" integer DEFAULT 0 NOT NULL,
	"user_count" integer DEFAULT 0 NOT NULL,
	"computed_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "kpi_daily_song_stats_date_song_id_pk" PRIMARY KEY("date","song_id")
);
--> statement-breakpoint
CREATE TABLE "kpi_retention_cohorts" (
	"cohort_date" date NOT NULL,
	"day_offset" smallint NOT NULL,
	"cohort_size" integer DEFAULT 0 NOT NULL,
	"retained_count" integer DEFAULT 0 NOT NULL,
	"computed_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "kpi_retention_cohorts_cohort_date_day_offset_pk" PRIMARY KEY("cohort_date","day_offset")
);
--> statement-breakpoint
CREATE TABLE "rollup_runs" (
	"id" serial PRIMARY KEY NOT NULL,
	"run_date" date NOT NULL,
	"status" varchar(16) NOT NULL,
	"started_at" timestamp with time zone DEFAULT now() NOT NULL,
	"finished_at" timestamp with time zone,
	"error" text
);
