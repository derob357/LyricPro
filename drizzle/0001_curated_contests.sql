CREATE TYPE "public"."curated_set_status" AS ENUM('active', 'draft');--> statement-breakpoint
CREATE TABLE "curated_song_sets" (
	"id" serial PRIMARY KEY NOT NULL,
	"name" varchar(256) NOT NULL,
	"description" text,
	"items" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"status" "curated_set_status" DEFAULT 'active' NOT NULL,
	"created_by" integer NOT NULL,
	"createdAt" timestamp with time zone DEFAULT now() NOT NULL,
	"updatedAt" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "game_rooms" ADD COLUMN "customPackVariants" jsonb;