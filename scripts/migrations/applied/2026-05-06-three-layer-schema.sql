-- 2026-05-06-three-layer-schema.sql
-- Phase 5b: DDL for the three-layer content schema.
--
-- Adds 5 columns to songs, creates lyric_moments + gameplay_items tables,
-- and indexes per docs/phase-5-schema/SCHEMA-DESIGN.md.
--
-- Idempotent (IF NOT EXISTS guards on every clause that supports it; enums
-- guarded via DO $$ BEGIN ... EXCEPTION WHEN duplicate_object THEN NULL).
-- Single transaction in the apply script (Postgres supports transactional
-- DDL).
--
-- Applied via: scripts/apply-three-layer-schema-migration.mjs
--
-- The legacy songs.lyricVariants column STAYS in place. This is the rollback
-- artifact for the entire Phase 5b/5c/5d sequence until ≥7 days of stability
-- on the new path.
--
-- Rollback (if needed before Phase 5c read-path repoint):
-- DROP TABLE IF EXISTS gameplay_items CASCADE;
-- DROP TABLE IF EXISTS lyric_moments CASCADE;
-- ALTER TABLE songs
--   DROP COLUMN IF EXISTS featured_artist,
--   DROP COLUMN IF EXISTS licensing_status,
--   DROP COLUMN IF EXISTS approved_for_game,
--   DROP COLUMN IF EXISTS in_curated_bank,
--   DROP COLUMN IF EXISTS curator_notes;
-- DROP TYPE IF EXISTS qa_status;
-- DROP TYPE IF EXISTS prompt_format;
-- DROP TYPE IF EXISTS question_type;
-- DROP TYPE IF EXISTS candidate_use_case;
-- DROP TYPE IF EXISTS licensing_status;

-- ─── 1. New enums ─────────────────────────────────────────────────────────────
DO $$ BEGIN
  CREATE TYPE licensing_status AS ENUM
    ('pending', 'in_review', 'cleared', 'internal_only', 'rejected');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE candidate_use_case AS ENUM
    ('song_id', 'artist_id', 'year_id', 'finish_the_lyric', 'multi_surface');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE question_type AS ENUM
    ('song_identification', 'artist_identification',
     'year_identification', 'finish_the_lyric');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE prompt_format AS ENUM ('multiple_choice', 'typed', 'voice');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE qa_status AS ENUM ('pending', 'passed', 'needs_fix', 'blocked');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- ─── 2. Songs additions (5 new columns) ───────────────────────────────────────
ALTER TABLE "songs"
  ADD COLUMN IF NOT EXISTS "featured_artist"   varchar(256);
ALTER TABLE "songs"
  ADD COLUMN IF NOT EXISTS "licensing_status"  licensing_status NOT NULL DEFAULT 'internal_only';
ALTER TABLE "songs"
  ADD COLUMN IF NOT EXISTS "approved_for_game" boolean NOT NULL DEFAULT true;
ALTER TABLE "songs"
  ADD COLUMN IF NOT EXISTS "in_curated_bank"   boolean NOT NULL DEFAULT false;
ALTER TABLE "songs"
  ADD COLUMN IF NOT EXISTS "curator_notes"     text;

-- ─── 3. lyric_moments table ───────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS "lyric_moments" (
  "id"                          serial PRIMARY KEY NOT NULL,
  "song_id"                     integer NOT NULL,
  "section_type"                varchar(32) NOT NULL,
  "section_order"               smallint,
  "candidate_use_case"          candidate_use_case NOT NULL,
  "lyric_text"                  text NOT NULL,
  "lyric_before"                text,
  "lyric_after"                 text,
  "low_fit"                     boolean NOT NULL DEFAULT false,
  "medium_fit"                  boolean NOT NULL DEFAULT false,
  "hard_fit"                    boolean NOT NULL DEFAULT false,
  "song_recognition_fit"        boolean NOT NULL DEFAULT false,
  "artist_recognition_fit"      boolean NOT NULL DEFAULT false,
  "year_fit"                    boolean NOT NULL DEFAULT false,
  "finish_the_lyric_fit"        boolean NOT NULL DEFAULT false,
  "cue_obviousness_score"       smallint,
  "lyric_vividness_score"       smallint,
  "artist_fingerprint_score"    smallint,
  "sayability_score"            smallint,
  "social_recognition_score"    smallint,
  "era_signal_score"            smallint,
  "question_variety_score"      smallint,
  "ambiguity_risk_score"        smallint,
  "overall_playability_score"   smallint GENERATED ALWAYS AS (
    CASE
      WHEN "cue_obviousness_score" IS NULL OR "lyric_vividness_score" IS NULL
        OR "artist_fingerprint_score" IS NULL OR "sayability_score" IS NULL
        OR "social_recognition_score" IS NULL OR "era_signal_score" IS NULL
        OR "question_variety_score" IS NULL OR "ambiguity_risk_score" IS NULL
      THEN NULL
      ELSE (
        (20 * "cue_obviousness_score")
      + (15 * "lyric_vividness_score")
      + (15 * "artist_fingerprint_score")
      + (15 * "sayability_score")
      + (15 * "social_recognition_score")
      + ( 5 * "era_signal_score")
      + (10 * "question_variety_score")
      - ( 3 * "ambiguity_risk_score")
      )
    END
  ) STORED,
  "reviewer_notes"              text,
  "approval_status"             varchar(16) NOT NULL DEFAULT 'pending',
  "approved_by"                 integer,
  "approved_at"                 timestamp with time zone,
  "created_at"                  timestamp with time zone NOT NULL DEFAULT now(),
  "updated_at"                  timestamp with time zone NOT NULL DEFAULT now()
);

DO $$ BEGIN
  ALTER TABLE "lyric_moments"
    ADD CONSTRAINT "lyric_moments_song_fk"
      FOREIGN KEY ("song_id") REFERENCES "songs"("id") ON DELETE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  ALTER TABLE "lyric_moments"
    ADD CONSTRAINT "lyric_moments_approver_fk"
      FOREIGN KEY ("approved_by") REFERENCES "users"("id") ON DELETE SET NULL;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  ALTER TABLE "lyric_moments"
    ADD CONSTRAINT "lyric_moments_score_ranges" CHECK (
      ("cue_obviousness_score"    IS NULL OR "cue_obviousness_score"    BETWEEN 1 AND 5) AND
      ("lyric_vividness_score"    IS NULL OR "lyric_vividness_score"    BETWEEN 1 AND 5) AND
      ("artist_fingerprint_score" IS NULL OR "artist_fingerprint_score" BETWEEN 1 AND 5) AND
      ("sayability_score"         IS NULL OR "sayability_score"         BETWEEN 1 AND 5) AND
      ("social_recognition_score" IS NULL OR "social_recognition_score" BETWEEN 1 AND 5) AND
      ("era_signal_score"         IS NULL OR "era_signal_score"         BETWEEN 1 AND 5) AND
      ("question_variety_score"   IS NULL OR "question_variety_score"   BETWEEN 1 AND 5) AND
      ("ambiguity_risk_score"     IS NULL OR "ambiguity_risk_score"     BETWEEN 1 AND 5)
    );
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

CREATE INDEX IF NOT EXISTS "lyric_moments_song_id_idx"
  ON "lyric_moments" USING btree ("song_id");
CREATE INDEX IF NOT EXISTS "lyric_moments_approval_status_idx"
  ON "lyric_moments" USING btree ("approval_status");
CREATE INDEX IF NOT EXISTS "lyric_moments_song_score_idx"
  ON "lyric_moments" USING btree ("song_id", "overall_playability_score");
CREATE UNIQUE INDEX IF NOT EXISTS "lyric_moments_song_lyric_unique"
  ON "lyric_moments" USING btree ("song_id", "lyric_text");

-- ─── 4. gameplay_items table ──────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS "gameplay_items" (
  "id"                  serial PRIMARY KEY NOT NULL,
  "lyric_moment_id"     integer NOT NULL,
  "song_id"             integer NOT NULL,
  "difficulty"          varchar(8) NOT NULL,
  "question_type"       question_type NOT NULL,
  "prompt_format"       prompt_format NOT NULL DEFAULT 'multiple_choice',
  "prompt_text"         text NOT NULL,
  "correct_answer"      text NOT NULL,
  "distractor_1"        text,
  "distractor_2"        text,
  "distractor_3"        text,
  "year_tolerance"      smallint,
  "qa_status"           qa_status NOT NULL DEFAULT 'pending',
  "qa_notes"            text,
  "is_active"           boolean NOT NULL DEFAULT true,
  "times_shown"         integer NOT NULL DEFAULT 0,
  "created_at"          timestamp with time zone NOT NULL DEFAULT now(),
  "updated_at"          timestamp with time zone NOT NULL DEFAULT now()
);

DO $$ BEGIN
  ALTER TABLE "gameplay_items"
    ADD CONSTRAINT "gameplay_items_moment_fk"
      FOREIGN KEY ("lyric_moment_id") REFERENCES "lyric_moments"("id") ON DELETE RESTRICT;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  ALTER TABLE "gameplay_items"
    ADD CONSTRAINT "gameplay_items_song_fk"
      FOREIGN KEY ("song_id") REFERENCES "songs"("id") ON DELETE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

CREATE INDEX IF NOT EXISTS "gameplay_items_moment_id_idx"
  ON "gameplay_items" USING btree ("lyric_moment_id");
CREATE INDEX IF NOT EXISTS "gameplay_items_song_id_idx"
  ON "gameplay_items" USING btree ("song_id");
CREATE INDEX IF NOT EXISTS "gameplay_items_song_diff_type_idx"
  ON "gameplay_items" USING btree ("song_id", "difficulty", "question_type");
CREATE INDEX IF NOT EXISTS "gameplay_items_active_idx"
  ON "gameplay_items" USING btree ("is_active", "qa_status");
