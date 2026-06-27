CREATE TABLE "user_insights" (
	"id" serial PRIMARY KEY NOT NULL,
	"userId" integer NOT NULL,
	"diagnosis" text NOT NULL,
	"packSongIds" jsonb NOT NULL,
	"roundsAnalyzed" integer NOT NULL,
	"weakestGenre" varchar(64),
	"weakestDecade" varchar(32),
	"weakestCategory" varchar(16),
	"computedAt" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "user_insights_userId_unique" UNIQUE("userId")
);
--> statement-breakpoint
ALTER TABLE "game_rooms" ADD COLUMN "customPackSongIds" jsonb;--> statement-breakpoint
ALTER TABLE "game_rooms" ADD COLUMN "streakInsurance" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "round_results" ADD COLUMN "hintUsed" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "round_results" ADD COLUMN "streakInsuranceUsed" boolean DEFAULT false NOT NULL;