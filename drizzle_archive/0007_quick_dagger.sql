CREATE SCHEMA "audit";
--> statement-breakpoint
CREATE TYPE "public"."commercial_model" AS ENUM('free', 'subscription', 'ad_supported', 'entry_fee');--> statement-breakpoint
CREATE TYPE "public"."lyric_source_provider" AS ENUM('internal', 'lyricfind', 'musixmatch', 'direct_publisher');--> statement-breakpoint
CREATE TABLE "audit"."admin_actions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"occurred_at" timestamp with time zone DEFAULT now() NOT NULL,
	"actor_type" varchar(16) NOT NULL,
	"actor_id" integer,
	"actor_email" varchar(320),
	"action" varchar(64) NOT NULL,
	"target_type" varchar(32) NOT NULL,
	"target_id" varchar(64) NOT NULL,
	"target_variant_index" integer,
	"payload" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"request_id" varchar(64),
	"ip_truncated" text,
	"user_agent" text
);
--> statement-breakpoint
CREATE TABLE "audit"."admin_actions_redactions" (
	"action_id" uuid PRIMARY KEY NOT NULL,
	"redacted_at" timestamp with time zone DEFAULT now() NOT NULL,
	"reason" text NOT NULL,
	"fields" text[] NOT NULL
);
--> statement-breakpoint
ALTER TABLE "song_displays" ADD COLUMN "territory_code" varchar(2);--> statement-breakpoint
ALTER TABLE "song_displays" ADD COLUMN "duration_of_use_seconds" integer;--> statement-breakpoint
ALTER TABLE "song_displays" ADD COLUMN "lyric_fragment_length_chars" integer;--> statement-breakpoint
ALTER TABLE "song_displays" ADD COLUMN "lyric_fragment_length_lines" integer;--> statement-breakpoint
ALTER TABLE "song_displays" ADD COLUMN "commercial_model_type" "commercial_model" DEFAULT 'free' NOT NULL;--> statement-breakpoint
ALTER TABLE "song_displays" ADD COLUMN "service_description" varchar(64) DEFAULT 'lyricpro-web' NOT NULL;--> statement-breakpoint
ALTER TABLE "song_displays" ADD COLUMN "gross_revenue_per_event_micros" bigint DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "song_displays" ADD COLUMN "currency_code" varchar(3) DEFAULT 'USD' NOT NULL;--> statement-breakpoint
ALTER TABLE "song_displays" ADD COLUMN "attribution_served" varchar(64);--> statement-breakpoint
ALTER TABLE "song_displays" ADD COLUMN "user_id_hashed" varchar(64);--> statement-breakpoint
ALTER TABLE "song_displays" ADD COLUMN "session_id" varchar(64);--> statement-breakpoint
ALTER TABLE "song_displays" ADD COLUMN "reporting_period_yyyymm" varchar(6);--> statement-breakpoint
ALTER TABLE "songs" ADD COLUMN "iswc" varchar(15);--> statement-breakpoint
ALTER TABLE "songs" ADD COLUMN "isrc" varchar(15);--> statement-breakpoint
ALTER TABLE "songs" ADD COLUMN "songwriters" jsonb DEFAULT '[]'::jsonb NOT NULL;--> statement-breakpoint
ALTER TABLE "songs" ADD COLUMN "publishers" jsonb DEFAULT '[]'::jsonb NOT NULL;--> statement-breakpoint
ALTER TABLE "songs" ADD COLUMN "lyric_source_provider" "lyric_source_provider" DEFAULT 'internal' NOT NULL;--> statement-breakpoint
ALTER TABLE "songs" ADD COLUMN "provider_track_id" varchar(64);--> statement-breakpoint
ALTER TABLE "audit"."admin_actions_redactions" ADD CONSTRAINT "admin_actions_redactions_action_id_admin_actions_id_fk" FOREIGN KEY ("action_id") REFERENCES "audit"."admin_actions"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "idx_admin_actions_actor" ON "audit"."admin_actions" USING btree ("actor_id","occurred_at");--> statement-breakpoint
CREATE INDEX "idx_admin_actions_target" ON "audit"."admin_actions" USING btree ("target_type","target_id","occurred_at");--> statement-breakpoint
CREATE INDEX "idx_admin_actions_action" ON "audit"."admin_actions" USING btree ("action","occurred_at");--> statement-breakpoint
CREATE INDEX "song_displays_reporting_period_song_idx" ON "song_displays" USING btree ("reporting_period_yyyymm","songId");--> statement-breakpoint
CREATE INDEX "song_displays_song_id_variant_idx" ON "song_displays" USING btree ("songId","variantIndex");
--> statement-breakpoint

-- ─── REVOKE + deny-change trigger on audit.admin_actions ───────────────────
REVOKE ALL ON SCHEMA audit FROM PUBLIC;--> statement-breakpoint
REVOKE ALL ON audit.admin_actions FROM PUBLIC;--> statement-breakpoint
GRANT  INSERT, SELECT ON audit.admin_actions TO authenticated;--> statement-breakpoint
GRANT  INSERT, SELECT ON audit.admin_actions TO service_role;--> statement-breakpoint
GRANT  USAGE ON SCHEMA audit TO authenticated;--> statement-breakpoint
GRANT  USAGE ON SCHEMA audit TO service_role;--> statement-breakpoint

CREATE OR REPLACE FUNCTION audit.deny_change() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'audit.admin_actions is append-only (%)', TG_OP;
END $$;--> statement-breakpoint

CREATE TRIGGER admin_actions_no_update
  BEFORE UPDATE ON audit.admin_actions
  FOR EACH ROW EXECUTE FUNCTION audit.deny_change();--> statement-breakpoint

CREATE TRIGGER admin_actions_no_delete
  BEFORE DELETE ON audit.admin_actions
  FOR EACH ROW EXECUTE FUNCTION audit.deny_change();--> statement-breakpoint

CREATE TRIGGER admin_actions_no_truncate
  BEFORE TRUNCATE ON audit.admin_actions
  FOR EACH STATEMENT EXECUTE FUNCTION audit.deny_change();--> statement-breakpoint

-- ─── Convert reporting_period_yyyymm to a GENERATED column ─────────────────
-- Drizzle declared this as a plain varchar; we now drop and re-add it as
-- GENERATED ALWAYS AS STORED so it's auto-populated from shownAt.
ALTER TABLE song_displays DROP COLUMN reporting_period_yyyymm;--> statement-breakpoint
ALTER TABLE song_displays
  ADD COLUMN reporting_period_yyyymm varchar(6)
  GENERATED ALWAYS AS (
    lpad(EXTRACT(year FROM ("shownAt" AT TIME ZONE 'UTC'))::int::text, 4, '0') ||
    lpad(EXTRACT(month FROM ("shownAt" AT TIME ZONE 'UTC'))::int::text, 2, '0')
  ) STORED;--> statement-breakpoint

-- The drizzle-generated CREATE INDEX for reporting_period_yyyymm ran before
-- this drop+readd, so we recreate the index here.
DROP INDEX IF EXISTS song_displays_reporting_period_song_idx;--> statement-breakpoint
CREATE INDEX song_displays_reporting_period_song_idx
  ON song_displays (reporting_period_yyyymm, "songId");--> statement-breakpoint

-- ─── Best-effort backfill for historical song_displays rows ────────────────
-- Note: USER_HASH_PEPPER is read from the GUC app.user_hash_pepper which the
-- server sets per-connection in `getDb()`. For the migration we use the env
-- value directly via current_setting. If app.user_hash_pepper is not set,
-- userIdHashed stays NULL for historical rows.
DO $$
DECLARE
  pepper text;
BEGIN
  BEGIN
    pepper := current_setting('app.user_hash_pepper', true);
  EXCEPTION WHEN OTHERS THEN
    pepper := NULL;
  END;

  IF pepper IS NOT NULL AND length(pepper) > 0 THEN
    UPDATE song_displays
    SET user_id_hashed =
      encode(digest("userId"::text || pepper, 'sha256'), 'hex')
    WHERE "userId" IS NOT NULL AND user_id_hashed IS NULL;
  END IF;
END $$;--> statement-breakpoint

-- Backfill fragment lengths from songs.lyricVariants[variantIndex].prompt
-- (fallback to songs.lyricPrompt if variantIndex out of range).
UPDATE song_displays sd
SET
  lyric_fragment_length_chars = COALESCE(
    length(((s."lyricVariants" -> sd."variantIndex") ->> 'prompt')),
    length(s."lyricPrompt")
  ),
  lyric_fragment_length_lines = COALESCE(
    array_length(string_to_array(
      ((s."lyricVariants" -> sd."variantIndex") ->> 'prompt'), E'\n'), 1),
    array_length(string_to_array(s."lyricPrompt", E'\n'), 1)
  )
FROM songs s
WHERE sd."songId" = s.id
  AND (sd.lyric_fragment_length_chars IS NULL
       OR sd.lyric_fragment_length_lines IS NULL);