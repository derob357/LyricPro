CREATE TYPE "public"."candidate_use_case" AS ENUM('song_id', 'artist_id', 'year_id', 'finish_the_lyric', 'multi_surface');--> statement-breakpoint
CREATE TYPE "public"."licensing_status" AS ENUM('pending', 'in_review', 'cleared', 'internal_only', 'rejected');--> statement-breakpoint
CREATE TYPE "public"."prompt_format" AS ENUM('multiple_choice', 'typed', 'voice');--> statement-breakpoint
CREATE TYPE "public"."qa_status" AS ENUM('pending', 'passed', 'needs_fix', 'blocked');--> statement-breakpoint
CREATE TYPE "public"."question_type" AS ENUM('song_identification', 'artist_identification', 'year_identification', 'finish_the_lyric');--> statement-breakpoint
ALTER TYPE "public"."subscription_status" ADD VALUE 'past_due';--> statement-breakpoint
ALTER TYPE "public"."subscription_status" ADD VALUE 'unpaid';--> statement-breakpoint
ALTER TYPE "public"."subscription_status" ADD VALUE 'trialing';--> statement-breakpoint
ALTER TYPE "public"."subscription_status" ADD VALUE 'incomplete';--> statement-breakpoint
ALTER TYPE "public"."subscription_status" ADD VALUE 'incomplete_expired';--> statement-breakpoint
CREATE TABLE "gameplay_items" (
	"id" serial PRIMARY KEY NOT NULL,
	"lyric_moment_id" integer NOT NULL,
	"song_id" integer NOT NULL,
	"difficulty" varchar(8) NOT NULL,
	"question_type" "question_type" NOT NULL,
	"prompt_format" "prompt_format" DEFAULT 'multiple_choice' NOT NULL,
	"prompt_text" text NOT NULL,
	"correct_answer" text NOT NULL,
	"distractor_1" text,
	"distractor_2" text,
	"distractor_3" text,
	"year_tolerance" smallint,
	"qa_status" "qa_status" DEFAULT 'pending' NOT NULL,
	"qa_notes" text,
	"is_active" boolean DEFAULT true NOT NULL,
	"times_shown" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "lyric_moments" (
	"id" serial PRIMARY KEY NOT NULL,
	"song_id" integer NOT NULL,
	"section_type" varchar(32) NOT NULL,
	"section_order" smallint,
	"candidate_use_case" "candidate_use_case" NOT NULL,
	"lyric_text" text NOT NULL,
	"lyric_before" text,
	"lyric_after" text,
	"low_fit" boolean DEFAULT false NOT NULL,
	"medium_fit" boolean DEFAULT false NOT NULL,
	"hard_fit" boolean DEFAULT false NOT NULL,
	"song_recognition_fit" boolean DEFAULT false NOT NULL,
	"artist_recognition_fit" boolean DEFAULT false NOT NULL,
	"year_fit" boolean DEFAULT false NOT NULL,
	"finish_the_lyric_fit" boolean DEFAULT false NOT NULL,
	"cue_obviousness_score" smallint,
	"lyric_vividness_score" smallint,
	"artist_fingerprint_score" smallint,
	"sayability_score" smallint,
	"social_recognition_score" smallint,
	"era_signal_score" smallint,
	"question_variety_score" smallint,
	"ambiguity_risk_score" smallint,
	"overall_playability_score" smallint,
	"reviewer_notes" text,
	"approval_status" varchar(16) DEFAULT 'pending' NOT NULL,
	"approved_by" integer,
	"approved_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "song_displays" (
	"id" serial PRIMARY KEY NOT NULL,
	"songId" integer NOT NULL,
	"userId" integer,
	"guestToken" varchar(64),
	"roomCode" varchar(8),
	"variantIndex" integer DEFAULT 0 NOT NULL,
	"shownAt" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "songs" ADD COLUMN "lyricVariants" jsonb;--> statement-breakpoint
ALTER TABLE "songs" ADD COLUMN "featured_artist" varchar(256);--> statement-breakpoint
ALTER TABLE "songs" ADD COLUMN "licensing_status" "licensing_status" DEFAULT 'internal_only' NOT NULL;--> statement-breakpoint
ALTER TABLE "songs" ADD COLUMN "approved_for_game" boolean DEFAULT true NOT NULL;--> statement-breakpoint
ALTER TABLE "songs" ADD COLUMN "in_curated_bank" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "songs" ADD COLUMN "curator_notes" text;--> statement-breakpoint
ALTER TABLE "songs" ADD COLUMN "displayCount" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "songs" ADD COLUMN "lastShownAt" timestamp with time zone;--> statement-breakpoint
CREATE INDEX "gameplay_items_moment_id_idx" ON "gameplay_items" USING btree ("lyric_moment_id");--> statement-breakpoint
CREATE INDEX "gameplay_items_song_id_idx" ON "gameplay_items" USING btree ("song_id");--> statement-breakpoint
CREATE INDEX "gameplay_items_song_diff_type_idx" ON "gameplay_items" USING btree ("song_id","difficulty","question_type");--> statement-breakpoint
CREATE INDEX "gameplay_items_active_idx" ON "gameplay_items" USING btree ("is_active","qa_status");--> statement-breakpoint
CREATE INDEX "lyric_moments_song_id_idx" ON "lyric_moments" USING btree ("song_id");--> statement-breakpoint
CREATE INDEX "lyric_moments_approval_status_idx" ON "lyric_moments" USING btree ("approval_status");--> statement-breakpoint
CREATE INDEX "lyric_moments_song_score_idx" ON "lyric_moments" USING btree ("song_id","overall_playability_score");--> statement-breakpoint
CREATE UNIQUE INDEX "lyric_moments_song_lyric_unique" ON "lyric_moments" USING btree ("song_id","lyric_text");--> statement-breakpoint
CREATE INDEX "song_displays_user_shown_at_idx" ON "song_displays" USING btree ("userId","shownAt");--> statement-breakpoint
CREATE INDEX "song_displays_guest_shown_at_idx" ON "song_displays" USING btree ("guestToken","shownAt");--> statement-breakpoint
CREATE INDEX "song_displays_song_id_idx" ON "song_displays" USING btree ("songId");