CREATE TYPE "public"."avatar_acquired_via" AS ENUM('starter', 'purchase', 'admin_grant');--> statement-breakpoint
CREATE TYPE "public"."avatar_rarity" AS ENUM('starter', 'common', 'rare', 'epic', 'legendary');--> statement-breakpoint
ALTER TYPE "public"."golden_note_transaction_kind" ADD VALUE 'spend_avatar_unlock' BEFORE 'gift_sent';--> statement-breakpoint
CREATE TABLE "avatars" (
	"id" serial PRIMARY KEY NOT NULL,
	"slug" varchar(64) NOT NULL,
	"name" varchar(128) NOT NULL,
	"imageUrl" varchar(256) NOT NULL,
	"rarity" "avatar_rarity" NOT NULL,
	"priceGn" integer DEFAULT 0 NOT NULL,
	"isActive" boolean DEFAULT true NOT NULL,
	"sortOrder" integer DEFAULT 0 NOT NULL,
	"createdAt" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "avatars_slug_unique" UNIQUE("slug")
);
--> statement-breakpoint
CREATE TABLE "user_avatars" (
	"userId" integer NOT NULL,
	"avatarId" integer NOT NULL,
	"acquiredAt" timestamp with time zone DEFAULT now() NOT NULL,
	"acquiredVia" "avatar_acquired_via" NOT NULL,
	"spentGn" integer DEFAULT 0 NOT NULL,
	CONSTRAINT "user_avatars_userId_avatarId_pk" PRIMARY KEY("userId","avatarId")
);
--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "equippedAvatarId" integer;

--> statement-breakpoint
-- Seed catalog (idempotent; slug is UNIQUE).
INSERT INTO "avatars" ("slug", "name", "imageUrl", "rarity", "priceGn", "sortOrder")
VALUES
  ('default-mic',        'Default Mic',         '/avatars/default-mic.svg',        'starter',   0,   1),
  ('default-headphones', 'Default Headphones',  '/avatars/default-headphones.svg', 'starter',   0,   2),
  ('vinyl-spinner',      'Vinyl Spinner',       '/avatars/vinyl-spinner.svg',      'common',    25, 10),
  ('neon-mic',           'Neon Mic',            '/avatars/neon-mic.svg',           'common',    25, 11),
  ('gold-record',        'Gold Record',         '/avatars/gold-record.svg',        'rare',      50, 20),
  ('crown-singer',       'Crown Singer',        '/avatars/crown-singer.svg',       'rare',      50, 21),
  ('diamond-note',       'Diamond Note',        '/avatars/diamond-note.svg',       'epic',     100, 30),
  ('inferno-star',       'Inferno Star',        '/avatars/inferno-star.svg',       'legendary',200, 40)
ON CONFLICT ("slug") DO NOTHING;
--> statement-breakpoint
-- Backfill: every user gets the default-mic ownership row + equipped pointer.
INSERT INTO "user_avatars" ("userId", "avatarId", "acquiredVia", "spentGn")
SELECT u.id, a.id, 'starter', 0
FROM "users" u
CROSS JOIN "avatars" a
WHERE a.slug = 'default-mic'
ON CONFLICT ("userId", "avatarId") DO NOTHING;
--> statement-breakpoint
UPDATE "users"
SET "equippedAvatarId" = (SELECT id FROM "avatars" WHERE slug = 'default-mic')
WHERE "equippedAvatarId" IS NULL;