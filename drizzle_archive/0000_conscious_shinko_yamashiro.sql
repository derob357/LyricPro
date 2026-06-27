CREATE TYPE "public"."addon_purchase_status" AS ENUM('pending', 'completed', 'failed');--> statement-breakpoint
CREATE TYPE "public"."answer_method" AS ENUM('typed', 'voice');--> statement-breakpoint
CREATE TYPE "public"."approval_status" AS ENUM('pending', 'approved', 'rejected');--> statement-breakpoint
CREATE TYPE "public"."difficulty" AS ENUM('low', 'medium', 'high');--> statement-breakpoint
CREATE TYPE "public"."entry_fee_game_status" AS ENUM('pending', 'in_progress', 'completed', 'cancelled');--> statement-breakpoint
CREATE TYPE "public"."entry_fee_game_type" AS ENUM('solo', 'team3', 'team5', 'team7');--> statement-breakpoint
CREATE TYPE "public"."game_mode" AS ENUM('solo', 'multiplayer', 'team');--> statement-breakpoint
CREATE TYPE "public"."game_status" AS ENUM('waiting', 'active', 'finished');--> statement-breakpoint
CREATE TYPE "public"."lyric_section_type" AS ENUM('chorus', 'hook', 'verse', 'call-response', 'bridge');--> statement-breakpoint
CREATE TYPE "public"."payout_request_status" AS ENUM('pending', 'approved', 'rejected', 'paid');--> statement-breakpoint
CREATE TYPE "public"."payout_status" AS ENUM('pending', 'processing', 'completed', 'failed');--> statement-breakpoint
CREATE TYPE "public"."prize_pool_status" AS ENUM('active', 'paused', 'closed');--> statement-breakpoint
CREATE TYPE "public"."ranking_mode" AS ENUM('total_points', 'speed_bonus', 'streak_bonus');--> statement-breakpoint
CREATE TYPE "public"."stripe_account_status" AS ENUM('pending', 'verified', 'restricted', 'disabled');--> statement-breakpoint
CREATE TYPE "public"."subscription_status" AS ENUM('active', 'paused', 'canceled', 'expired');--> statement-breakpoint
CREATE TYPE "public"."subscription_tier" AS ENUM('free', 'player', 'pro', 'elite');--> statement-breakpoint
CREATE TYPE "public"."user_role" AS ENUM('user', 'admin');--> statement-breakpoint
CREATE TABLE "addon_game_purchases" (
	"id" serial PRIMARY KEY NOT NULL,
	"userId" integer NOT NULL,
	"quantity" integer NOT NULL,
	"pricePerGame" double precision NOT NULL,
	"totalAmount" double precision NOT NULL,
	"stripePaymentIntentId" varchar(256),
	"status" "addon_purchase_status" DEFAULT 'pending' NOT NULL,
	"createdAt" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "artist_metadata" (
	"id" serial PRIMARY KEY NOT NULL,
	"artistName" varchar(256) NOT NULL,
	"aliases" text,
	"officialWebsite" text,
	"instagramUrl" text,
	"facebookUrl" text,
	"xUrl" text,
	"tiktokUrl" text,
	"youtubeUrl" text,
	"spotifyUrl" text,
	"appleMusicUrl" text,
	"newsSearchUrl" text,
	"isActive" boolean DEFAULT true NOT NULL,
	"createdAt" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "daily_game_tracking" (
	"id" serial PRIMARY KEY NOT NULL,
	"userId" integer NOT NULL,
	"date" varchar(10) NOT NULL,
	"gamesPlayedToday" integer DEFAULT 0 NOT NULL,
	"createdAt" timestamp with time zone DEFAULT now() NOT NULL,
	"updatedAt" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "entry_fee_games" (
	"id" serial PRIMARY KEY NOT NULL,
	"roomId" integer NOT NULL,
	"entryFeeAmount" double precision NOT NULL,
	"gameType" "entry_fee_game_type" NOT NULL,
	"prizePoolAmount" double precision NOT NULL,
	"totalEntriesCollected" double precision NOT NULL,
	"status" "entry_fee_game_status" DEFAULT 'pending' NOT NULL,
	"createdAt" timestamp with time zone DEFAULT now() NOT NULL,
	"completedAt" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "entry_fee_participants" (
	"id" serial PRIMARY KEY NOT NULL,
	"entryFeeGameId" integer NOT NULL,
	"userId" integer NOT NULL,
	"entryFeeAmount" double precision NOT NULL,
	"finalScore" integer DEFAULT 0,
	"placement" integer,
	"prizeWon" double precision DEFAULT 0,
	"payoutStatus" "payout_status" DEFAULT 'pending' NOT NULL,
	"stripePayoutId" varchar(256),
	"createdAt" timestamp with time zone DEFAULT now() NOT NULL,
	"updatedAt" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "game_rooms" (
	"id" serial PRIMARY KEY NOT NULL,
	"roomCode" varchar(8) NOT NULL,
	"hostUserId" integer,
	"hostGuestToken" varchar(128),
	"mode" "game_mode" NOT NULL,
	"rankingMode" "ranking_mode" DEFAULT 'total_points' NOT NULL,
	"timerSeconds" integer DEFAULT 30 NOT NULL,
	"roundsTotal" integer DEFAULT 10 NOT NULL,
	"selectedGenres" text NOT NULL,
	"selectedDecades" text NOT NULL,
	"difficulty" "difficulty" DEFAULT 'medium' NOT NULL,
	"explicitFilter" boolean DEFAULT false NOT NULL,
	"status" "game_status" DEFAULT 'waiting' NOT NULL,
	"currentRound" integer DEFAULT 0 NOT NULL,
	"currentPlayerIndex" integer DEFAULT 0 NOT NULL,
	"currentSongId" integer,
	"usedSongIds" text,
	"createdAt" timestamp with time zone DEFAULT now() NOT NULL,
	"updatedAt" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "game_rooms_roomCode_unique" UNIQUE("roomCode")
);
--> statement-breakpoint
CREATE TABLE "game_sessions" (
	"id" serial PRIMARY KEY NOT NULL,
	"roomId" integer,
	"userId" integer,
	"guestToken" varchar(128),
	"mode" "game_mode" NOT NULL,
	"rankingMode" "ranking_mode" DEFAULT 'total_points' NOT NULL,
	"finalScore" integer DEFAULT 0 NOT NULL,
	"placement" integer,
	"startedAt" timestamp with time zone DEFAULT now() NOT NULL,
	"endedAt" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "guest_sessions" (
	"id" serial PRIMARY KEY NOT NULL,
	"sessionToken" varchar(128) NOT NULL,
	"nickname" varchar(64) NOT NULL,
	"createdAt" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "guest_sessions_sessionToken_unique" UNIQUE("sessionToken")
);
--> statement-breakpoint
CREATE TABLE "leaderboard_entries" (
	"id" serial PRIMARY KEY NOT NULL,
	"userId" integer,
	"guestName" varchar(64),
	"displayName" varchar(64) NOT NULL,
	"score" integer NOT NULL,
	"mode" "game_mode" NOT NULL,
	"genre" varchar(64),
	"decade" varchar(32),
	"rankingMode" varchar(32) NOT NULL,
	"createdAt" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "payout_requests" (
	"id" serial PRIMARY KEY NOT NULL,
	"userId" integer NOT NULL,
	"amount" double precision NOT NULL,
	"status" "payout_request_status" DEFAULT 'pending' NOT NULL,
	"stripePayoutId" varchar(256),
	"rejectionReason" text,
	"createdAt" timestamp with time zone DEFAULT now() NOT NULL,
	"updatedAt" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "prize_payouts" (
	"id" serial PRIMARY KEY NOT NULL,
	"prizePoolId" integer NOT NULL,
	"userId" integer NOT NULL,
	"amount" double precision NOT NULL,
	"rank" integer NOT NULL,
	"reason" varchar(256) NOT NULL,
	"status" "payout_status" DEFAULT 'pending' NOT NULL,
	"stripePayoutId" varchar(256),
	"failureReason" text,
	"createdAt" timestamp with time zone DEFAULT now() NOT NULL,
	"updatedAt" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "prize_pools" (
	"id" serial PRIMARY KEY NOT NULL,
	"name" varchar(256) NOT NULL,
	"description" text,
	"totalAmount" double precision NOT NULL,
	"distributedAmount" double precision DEFAULT 0 NOT NULL,
	"remainingAmount" double precision NOT NULL,
	"status" "prize_pool_status" DEFAULT 'active' NOT NULL,
	"distributionRules" text NOT NULL,
	"createdAt" timestamp with time zone DEFAULT now() NOT NULL,
	"updatedAt" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "processed_webhook_events" (
	"eventId" varchar(128) PRIMARY KEY NOT NULL,
	"eventType" varchar(64) NOT NULL,
	"createdAt" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "room_players" (
	"id" serial PRIMARY KEY NOT NULL,
	"roomId" integer NOT NULL,
	"userId" integer,
	"guestToken" varchar(128),
	"guestName" varchar(64),
	"teamId" integer,
	"joinOrder" integer DEFAULT 0 NOT NULL,
	"currentScore" integer DEFAULT 0 NOT NULL,
	"currentStreak" integer DEFAULT 0 NOT NULL,
	"isReady" boolean DEFAULT false NOT NULL,
	"isActive" boolean DEFAULT true NOT NULL,
	"joinedAt" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "round_results" (
	"id" serial PRIMARY KEY NOT NULL,
	"sessionId" integer,
	"roomId" integer,
	"roundNumber" integer NOT NULL,
	"activePlayerId" integer,
	"activeGuestToken" varchar(128),
	"songId" integer NOT NULL,
	"userLyricAnswer" text,
	"userArtistAnswer" text,
	"userYearAnswer" integer,
	"answerMethod" "answer_method" DEFAULT 'typed' NOT NULL,
	"responseTimeSeconds" double precision,
	"lyricPoints" integer DEFAULT 0 NOT NULL,
	"artistPoints" integer DEFAULT 0 NOT NULL,
	"yearPoints" integer DEFAULT 0 NOT NULL,
	"speedBonusPoints" integer DEFAULT 0 NOT NULL,
	"streakBonusPoints" integer DEFAULT 0 NOT NULL,
	"totalRoundPoints" integer DEFAULT 0 NOT NULL,
	"passUsed" boolean DEFAULT false NOT NULL,
	"createdAt" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "songs" (
	"id" serial PRIMARY KEY NOT NULL,
	"title" varchar(256) NOT NULL,
	"artistName" varchar(256) NOT NULL,
	"artistMetadataId" integer,
	"genre" varchar(64) NOT NULL,
	"subgenre" varchar(64),
	"releaseYear" integer NOT NULL,
	"decadeRange" varchar(32) NOT NULL,
	"lyricPrompt" text NOT NULL,
	"lyricAnswer" text NOT NULL,
	"lyricSectionType" "lyric_section_type" NOT NULL,
	"difficulty" "difficulty" NOT NULL,
	"language" varchar(16) DEFAULT 'en' NOT NULL,
	"explicitFlag" boolean DEFAULT false NOT NULL,
	"approvalStatus" "approval_status" DEFAULT 'approved' NOT NULL,
	"isActive" boolean DEFAULT true NOT NULL,
	"createdAt" timestamp with time zone DEFAULT now() NOT NULL,
	"updatedAt" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "stripe_accounts" (
	"id" serial PRIMARY KEY NOT NULL,
	"userId" integer NOT NULL,
	"stripeConnectAccountId" varchar(256) NOT NULL,
	"status" "stripe_account_status" DEFAULT 'pending' NOT NULL,
	"bankAccountVerified" boolean DEFAULT false NOT NULL,
	"createdAt" timestamp with time zone DEFAULT now() NOT NULL,
	"updatedAt" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "stripe_accounts_userId_unique" UNIQUE("userId"),
	CONSTRAINT "stripe_accounts_stripeConnectAccountId_unique" UNIQUE("stripeConnectAccountId")
);
--> statement-breakpoint
CREATE TABLE "subscriptions" (
	"id" serial PRIMARY KEY NOT NULL,
	"userId" integer NOT NULL,
	"tier" "subscription_tier" DEFAULT 'free' NOT NULL,
	"stripeSubscriptionId" varchar(256),
	"status" "subscription_status" DEFAULT 'active' NOT NULL,
	"currentPeriodStart" timestamp with time zone,
	"currentPeriodEnd" timestamp with time zone,
	"canceledAt" timestamp with time zone,
	"createdAt" timestamp with time zone DEFAULT now() NOT NULL,
	"updatedAt" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "subscriptions_userId_unique" UNIQUE("userId")
);
--> statement-breakpoint
CREATE TABLE "teams" (
	"id" serial PRIMARY KEY NOT NULL,
	"roomId" integer NOT NULL,
	"teamName" varchar(64) NOT NULL,
	"teamColor" varchar(16) DEFAULT '#8B5CF6' NOT NULL,
	"currentScore" integer DEFAULT 0 NOT NULL,
	"createdAt" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "user_wallets" (
	"id" serial PRIMARY KEY NOT NULL,
	"userId" integer NOT NULL,
	"availableBalance" double precision DEFAULT 0 NOT NULL,
	"totalWinnings" double precision DEFAULT 0 NOT NULL,
	"totalPayouts" double precision DEFAULT 0 NOT NULL,
	"lastPayoutDate" timestamp with time zone,
	"createdAt" timestamp with time zone DEFAULT now() NOT NULL,
	"updatedAt" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "user_wallets_userId_unique" UNIQUE("userId")
);
--> statement-breakpoint
CREATE TABLE "users" (
	"id" serial PRIMARY KEY NOT NULL,
	"openId" varchar(64) NOT NULL,
	"name" text,
	"firstName" varchar(128),
	"lastName" varchar(128),
	"email" varchar(320),
	"loginMethod" varchar(64),
	"role" "user_role" DEFAULT 'user' NOT NULL,
	"avatarUrl" text,
	"lifetimeScore" integer DEFAULT 0 NOT NULL,
	"totalWins" integer DEFAULT 0 NOT NULL,
	"gamesPlayed" integer DEFAULT 0 NOT NULL,
	"rankTier" varchar(32) DEFAULT 'Rookie' NOT NULL,
	"premiumStatus" boolean DEFAULT false NOT NULL,
	"favoriteGenre" varchar(64),
	"strongestDecade" varchar(32),
	"currentStreak" integer DEFAULT 0 NOT NULL,
	"longestStreak" integer DEFAULT 0 NOT NULL,
	"lyricAccuracy" double precision DEFAULT 0,
	"artistAccuracy" double precision DEFAULT 0,
	"yearAccuracy" double precision DEFAULT 0,
	"createdAt" timestamp with time zone DEFAULT now() NOT NULL,
	"updatedAt" timestamp with time zone DEFAULT now() NOT NULL,
	"lastSignedIn" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "users_openId_unique" UNIQUE("openId")
);
--> statement-breakpoint
CREATE UNIQUE INDEX "songs_title_artist_unique" ON "songs" USING btree ("title","artistName");