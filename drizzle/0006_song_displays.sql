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
ALTER TABLE "songs" ADD COLUMN "displayCount" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "songs" ADD COLUMN "lastShownAt" timestamp with time zone;--> statement-breakpoint
CREATE INDEX "song_displays_user_shown_at_idx" ON "song_displays" USING btree ("userId","shownAt");--> statement-breakpoint
CREATE INDEX "song_displays_guest_shown_at_idx" ON "song_displays" USING btree ("guestToken","shownAt");--> statement-breakpoint
CREATE INDEX "song_displays_song_id_idx" ON "song_displays" USING btree ("songId");