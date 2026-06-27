-- 0000_baseline.sql — SQUASHED BASELINE of the full schema (re-baselined 2026-06-27).
-- WHY: drizzle snapshots had frozen at 0007 while hand-written migrations advanced
-- the live DB to 0020, so `drizzle-kit generate` produced 200+ lines of drift.
-- This file equals the ENTIRE current schema and is ALREADY APPLIED everywhere.
-- DO NOT run it against an existing database — it will fail on existing objects.
-- It exists only as the snapshot anchor so future `drizzle-kit generate` produces
-- clean incremental diffs. Pre-baseline history is preserved in ../drizzle_archive/.
-- See drizzle/README.md.
CREATE SCHEMA "audit";
--> statement-breakpoint
CREATE TYPE "public"."addon_purchase_status" AS ENUM('pending', 'completed', 'failed');--> statement-breakpoint
CREATE TYPE "public"."answer_method" AS ENUM('typed', 'voice', 'mc');--> statement-breakpoint
CREATE TYPE "public"."approval_status" AS ENUM('pending', 'approved', 'rejected');--> statement-breakpoint
CREATE TYPE "public"."avatar_acquired_via" AS ENUM('starter', 'purchase', 'admin_grant');--> statement-breakpoint
CREATE TYPE "public"."avatar_rarity" AS ENUM('starter', 'common', 'rare', 'epic', 'legendary');--> statement-breakpoint
CREATE TYPE "public"."candidate_use_case" AS ENUM('song_id', 'artist_id', 'year_id', 'finish_the_lyric', 'multi_surface');--> statement-breakpoint
CREATE TYPE "public"."chat_ban_action" AS ENUM('ban', 'mute_visible', 'mute_shadow');--> statement-breakpoint
CREATE TYPE "public"."chat_ban_scope" AS ENUM('global', 'room');--> statement-breakpoint
CREATE TYPE "public"."chat_flag_status" AS ENUM('clean', 'flagged', 'flagged_high_confidence', 'reviewed_clean');--> statement-breakpoint
CREATE TYPE "public"."chat_room_kind" AS ENUM('global', 'tournament');--> statement-breakpoint
CREATE TYPE "public"."chat_scope" AS ENUM('global', 'tournament', 'friends');--> statement-breakpoint
CREATE TYPE "public"."commercial_model" AS ENUM('free', 'subscription', 'ad_supported', 'entry_fee');--> statement-breakpoint
CREATE TYPE "public"."difficulty" AS ENUM('low', 'medium', 'high');--> statement-breakpoint
CREATE TYPE "public"."entry_fee_game_status" AS ENUM('pending', 'in_progress', 'completed', 'cancelled');--> statement-breakpoint
CREATE TYPE "public"."entry_fee_game_type" AS ENUM('solo', 'team3', 'team5', 'team7');--> statement-breakpoint
CREATE TYPE "public"."game_mode" AS ENUM('solo', 'multiplayer', 'team', 'remote_live');--> statement-breakpoint
CREATE TYPE "public"."game_status" AS ENUM('waiting', 'active', 'finished');--> statement-breakpoint
CREATE TYPE "public"."gn_stake_state" AS ENUM('active', 'settled', 'refunded');--> statement-breakpoint
CREATE TYPE "public"."golden_note_gift_status" AS ENUM('pending', 'accepted', 'declined', 'expired');--> statement-breakpoint
CREATE TYPE "public"."golden_note_transaction_kind" AS ENUM('purchase', 'spend_extra_game', 'spend_tournament', 'spend_advanced_mode', 'spend_avatar_unlock', 'gift_sent', 'gift_received', 'refund', 'expiry', 'admin_adjustment', 'stake_escrow', 'stake_win', 'stake_refund', 'signup_grant', 'spend_hint', 'spend_streak_insurance', 'spend_practice_pack');--> statement-breakpoint
CREATE TYPE "public"."licensing_status" AS ENUM('pending', 'in_review', 'cleared', 'internal_only', 'rejected');--> statement-breakpoint
CREATE TYPE "public"."lyric_section_type" AS ENUM('chorus', 'hook', 'verse', 'call-response', 'bridge');--> statement-breakpoint
CREATE TYPE "public"."lyric_source_provider" AS ENUM('internal', 'lyricfind', 'musixmatch', 'direct_publisher');--> statement-breakpoint
CREATE TYPE "public"."payout_request_status" AS ENUM('pending', 'approved', 'rejected', 'paid');--> statement-breakpoint
CREATE TYPE "public"."payout_status" AS ENUM('pending', 'processing', 'completed', 'failed');--> statement-breakpoint
CREATE TYPE "public"."prize_pool_status" AS ENUM('active', 'paused', 'closed');--> statement-breakpoint
CREATE TYPE "public"."prompt_format" AS ENUM('multiple_choice', 'typed', 'voice');--> statement-breakpoint
CREATE TYPE "public"."qa_status" AS ENUM('pending', 'passed', 'needs_fix', 'blocked');--> statement-breakpoint
CREATE TYPE "public"."question_type" AS ENUM('song_identification', 'artist_identification', 'year_identification', 'finish_the_lyric');--> statement-breakpoint
CREATE TYPE "public"."ranking_mode" AS ENUM('total_points', 'speed_bonus', 'streak_bonus');--> statement-breakpoint
CREATE TYPE "public"."round_phase" AS ENUM('in_question', 'intermission', 'complete');--> statement-breakpoint
CREATE TYPE "public"."stripe_account_status" AS ENUM('pending', 'verified', 'restricted', 'disabled');--> statement-breakpoint
CREATE TYPE "public"."subscription_status" AS ENUM('active', 'paused', 'canceled', 'expired', 'past_due', 'unpaid', 'trialing', 'incomplete', 'incomplete_expired');--> statement-breakpoint
CREATE TYPE "public"."subscription_tier" AS ENUM('free', 'player', 'pro', 'elite');--> statement-breakpoint
CREATE TYPE "public"."suggestion_rule_category" AS ENUM('mode', 'upsell');--> statement-breakpoint
CREATE TYPE "public"."tournament_entry_method" AS ENUM('paid', 'admin_invited', 'comp');--> statement-breakpoint
CREATE TYPE "public"."tournament_status" AS ENUM('draft', 'open', 'in_progress', 'completed', 'cancelled');--> statement-breakpoint
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
CREATE TABLE "banner_impressions" (
	"id" serial PRIMARY KEY NOT NULL,
	"banner_id" integer NOT NULL,
	"user_id" integer,
	"clicked_at" timestamp with time zone,
	"shown_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "banners" (
	"id" serial PRIMARY KEY NOT NULL,
	"title" varchar(256) NOT NULL,
	"subtitle" text,
	"cta_text" varchar(64) DEFAULT 'Learn More' NOT NULL,
	"cta_action" varchar(512) NOT NULL,
	"partner_name" varchar(128),
	"partner_logo_url" varchar(512),
	"badge_text" varchar(32) DEFAULT 'Featured',
	"badge_color" varchar(7) DEFAULT '#EF4444',
	"image_emoji" varchar(8),
	"image_url" varchar(512),
	"audience" varchar(32) DEFAULT 'all' NOT NULL,
	"target_json" jsonb DEFAULT '{}'::jsonb,
	"priority" integer DEFAULT 100 NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL,
	"starts_at" timestamp with time zone,
	"ends_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "chat_audit_log" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"actor_id" integer NOT NULL,
	"actor_role" varchar(32) NOT NULL,
	"action" varchar(64) NOT NULL,
	"target_user_id" integer,
	"target_message_id" integer,
	"target_tournament_id" integer,
	"scope" varchar(32),
	"room_id" integer,
	"reason" text,
	"metadata" jsonb,
	"ip" varchar(64),
	"user_agent" text,
	"createdAt" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "chat_bans" (
	"id" serial PRIMARY KEY NOT NULL,
	"user_id" integer NOT NULL,
	"scope" "chat_ban_scope" NOT NULL,
	"room_id" integer,
	"action" "chat_ban_action" NOT NULL,
	"reason" text NOT NULL,
	"created_by" integer NOT NULL,
	"createdAt" timestamp with time zone DEFAULT now() NOT NULL,
	"expires_at" timestamp with time zone,
	"revoked_at" timestamp with time zone,
	"revoked_by" integer
);
--> statement-breakpoint
CREATE TABLE "chat_friends_read_state" (
	"user_id" integer PRIMARY KEY NOT NULL,
	"last_read_seq" bigint DEFAULT 0 NOT NULL,
	"last_read_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "chat_messages" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"scope" "chat_scope" NOT NULL,
	"room_id" integer,
	"author_id" integer NOT NULL,
	"body" varchar(1000) NOT NULL,
	"posted_while_shadow_banned" boolean DEFAULT false NOT NULL,
	"flag_status" "chat_flag_status" DEFAULT 'clean' NOT NULL,
	"flag_reason" text,
	"edited_at" timestamp with time zone,
	"edited_by" integer,
	"deleted_at" timestamp with time zone,
	"deleted_by" integer,
	"deleted_reason" text,
	"createdAt" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "chat_room_members" (
	"user_id" integer NOT NULL,
	"room_id" integer NOT NULL,
	"last_read_seq" bigint DEFAULT 0 NOT NULL,
	"last_read_at" timestamp with time zone DEFAULT now() NOT NULL,
	"notifications_enabled" boolean DEFAULT true NOT NULL,
	CONSTRAINT "chat_room_members_user_id_room_id_pk" PRIMARY KEY("user_id","room_id")
);
--> statement-breakpoint
CREATE TABLE "chat_rooms" (
	"id" serial PRIMARY KEY NOT NULL,
	"kind" "chat_room_kind" NOT NULL,
	"tournament_id" integer,
	"retention_days" integer DEFAULT 14 NOT NULL,
	"createdAt" timestamp with time zone DEFAULT now() NOT NULL,
	"updatedAt" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "commentary_templates" (
	"id" serial PRIMARY KEY NOT NULL,
	"trigger_key" varchar(64) NOT NULL,
	"text" text NOT NULL,
	"priority" integer DEFAULT 100 NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
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
	"roundPhase" "round_phase",
	"roundEndsAt" timestamp with time zone,
	"usedSongIds" text,
	"customPackSongIds" jsonb,
	"isVideoRoom" boolean DEFAULT false NOT NULL,
	"videoRoomName" text,
	"maxPlayers" integer DEFAULT 8 NOT NULL,
	"turnOrder" jsonb,
	"inviteCode" varchar(16),
	"inviteExpiresAt" timestamp with time zone,
	"streakInsurance" boolean DEFAULT false NOT NULL,
	"currentQuestion" jsonb,
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
CREATE TABLE "genres" (
	"id" serial PRIMARY KEY NOT NULL,
	"name" varchar(64) NOT NULL,
	"parent_id" integer,
	"is_active" boolean DEFAULT true NOT NULL,
	"sort_order" integer DEFAULT 100 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "gn_stakes" (
	"id" serial PRIMARY KEY NOT NULL,
	"roomId" integer NOT NULL,
	"userId" integer NOT NULL,
	"staked" integer NOT NULL,
	"burned" integer DEFAULT 0 NOT NULL,
	"wonRounds" integer DEFAULT 0 NOT NULL,
	"state" "gn_stake_state" DEFAULT 'active' NOT NULL,
	"createdAt" timestamp with time zone DEFAULT now() NOT NULL,
	"settledAt" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "golden_note_balances" (
	"userId" integer PRIMARY KEY NOT NULL,
	"balance" integer DEFAULT 0 NOT NULL,
	"earnedBalance" integer DEFAULT 0 NOT NULL,
	"purchasedBalance" integer DEFAULT 0 NOT NULL,
	"lifetimePurchased" integer DEFAULT 0 NOT NULL,
	"lifetimeSpent" integer DEFAULT 0 NOT NULL,
	"lifetimeGiftedSent" integer DEFAULT 0 NOT NULL,
	"lifetimeGiftedReceived" integer DEFAULT 0 NOT NULL,
	"lastPurchaseAt" timestamp with time zone,
	"createdAt" timestamp with time zone DEFAULT now() NOT NULL,
	"updatedAt" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "golden_note_gifts" (
	"id" serial PRIMARY KEY NOT NULL,
	"senderUserId" integer NOT NULL,
	"recipientUserId" integer NOT NULL,
	"amount" integer NOT NULL,
	"message" text,
	"status" "golden_note_gift_status" DEFAULT 'pending' NOT NULL,
	"expiresAt" timestamp with time zone NOT NULL,
	"createdAt" timestamp with time zone DEFAULT now() NOT NULL,
	"resolvedAt" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "golden_note_transactions" (
	"id" serial PRIMARY KEY NOT NULL,
	"userId" integer NOT NULL,
	"amount" integer NOT NULL,
	"kind" "golden_note_transaction_kind" NOT NULL,
	"reason" varchar(256),
	"relatedUserId" integer,
	"stripePaymentIntentId" varchar(256),
	"balanceAfter" integer NOT NULL,
	"idempotencyKey" varchar(64),
	"createdAt" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "golden_note_transactions_idempotencyKey_unique" UNIQUE("idempotencyKey")
);
--> statement-breakpoint
CREATE TABLE "guest_sessions" (
	"id" serial PRIMARY KEY NOT NULL,
	"sessionToken" varchar(128) NOT NULL,
	"nickname" varchar(64) NOT NULL,
	"email" varchar(254),
	"marketingOptIn" boolean DEFAULT false NOT NULL,
	"consentedAt" timestamp with time zone,
	"consentWordingVersion" varchar(32),
	"consentSource" varchar(64),
	"consentIp" varchar(45),
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
CREATE TABLE "player_profiles" (
	"user_id" integer PRIMARY KEY NOT NULL,
	"profile" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"computed_at" timestamp with time zone DEFAULT now() NOT NULL,
	"games_at_compute" integer DEFAULT 0 NOT NULL
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
	"hintUsed" boolean DEFAULT false NOT NULL,
	"streakInsuranceUsed" boolean DEFAULT false NOT NULL,
	"createdAt" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "song_displays" (
	"id" serial PRIMARY KEY NOT NULL,
	"songId" integer NOT NULL,
	"userId" integer,
	"guestToken" varchar(64),
	"roomCode" varchar(8),
	"variantIndex" integer DEFAULT 0 NOT NULL,
	"shownAt" timestamp with time zone DEFAULT now() NOT NULL,
	"territory_code" varchar(2),
	"duration_of_use_seconds" integer,
	"lyric_fragment_length_chars" integer,
	"lyric_fragment_length_lines" integer,
	"commercial_model_type" "commercial_model" DEFAULT 'free' NOT NULL,
	"service_description" varchar(64) DEFAULT 'lyricpro-web' NOT NULL,
	"gross_revenue_per_event_micros" bigint DEFAULT 0 NOT NULL,
	"currency_code" varchar(3) DEFAULT 'USD' NOT NULL,
	"attribution_served" varchar(64),
	"user_id_hashed" varchar(64),
	"session_id" varchar(64),
	"reporting_period_yyyymm" varchar(6)
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
	"distractors" jsonb,
	"lyricVariants" jsonb,
	"lyricSectionType" "lyric_section_type" NOT NULL,
	"difficulty" "difficulty" NOT NULL,
	"language" varchar(16) DEFAULT 'en' NOT NULL,
	"explicitFlag" boolean DEFAULT false NOT NULL,
	"approvalStatus" "approval_status" DEFAULT 'approved' NOT NULL,
	"isActive" boolean DEFAULT true NOT NULL,
	"featured_artist" varchar(256),
	"licensing_status" "licensing_status" DEFAULT 'internal_only' NOT NULL,
	"approved_for_game" boolean DEFAULT true NOT NULL,
	"in_curated_bank" boolean DEFAULT false NOT NULL,
	"curator_notes" text,
	"iswc" varchar(15),
	"isrc" varchar(15),
	"songwriters" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"publishers" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"lyric_source_provider" "lyric_source_provider" DEFAULT 'internal' NOT NULL,
	"provider_track_id" varchar(64),
	"displayCount" integer DEFAULT 0 NOT NULL,
	"lastShownAt" timestamp with time zone,
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
CREATE TABLE "suggestion_rules" (
	"id" serial PRIMARY KEY NOT NULL,
	"category" "suggestion_rule_category" NOT NULL,
	"trigger_key" varchar(64) NOT NULL,
	"text" text NOT NULL,
	"action" varchar(256) NOT NULL,
	"priority" integer DEFAULT 100 NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "suggestion_rules_trigger_key_unique" UNIQUE("trigger_key")
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
CREATE TABLE "tournament_members" (
	"tournament_id" integer NOT NULL,
	"user_id" integer NOT NULL,
	"entry_method" "tournament_entry_method" NOT NULL,
	"gn_spent" integer DEFAULT 0 NOT NULL,
	"joined_at" timestamp with time zone DEFAULT now() NOT NULL,
	"left_at" timestamp with time zone,
	CONSTRAINT "tournament_members_tournament_id_user_id_pk" PRIMARY KEY("tournament_id","user_id")
);
--> statement-breakpoint
CREATE TABLE "tournaments" (
	"id" serial PRIMARY KEY NOT NULL,
	"name" varchar(128) NOT NULL,
	"description" text,
	"entry_cost_gn" integer DEFAULT 0 NOT NULL,
	"capacity" integer,
	"starts_at" timestamp with time zone NOT NULL,
	"ends_at" timestamp with time zone NOT NULL,
	"chat_room_id" integer,
	"status" "tournament_status" DEFAULT 'draft' NOT NULL,
	"prize_pool_id" integer,
	"created_by" integer NOT NULL,
	"createdAt" timestamp with time zone DEFAULT now() NOT NULL,
	"updatedAt" timestamp with time zone DEFAULT now() NOT NULL
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
CREATE TABLE "user_favorites" (
	"id" serial PRIMARY KEY NOT NULL,
	"follower_id" integer NOT NULL,
	"favorite_id" integer NOT NULL,
	"createdAt" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
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
	"marketingOptIn" boolean DEFAULT false NOT NULL,
	"consentedAt" timestamp with time zone,
	"consentWordingVersion" varchar(32),
	"consentSource" varchar(64),
	"consentIp" varchar(45),
	"loginMethod" varchar(64),
	"role" "user_role" DEFAULT 'user' NOT NULL,
	"avatarUrl" text,
	"equippedAvatarId" integer,
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
	"gamePrefs" jsonb,
	"createdAt" timestamp with time zone DEFAULT now() NOT NULL,
	"updatedAt" timestamp with time zone DEFAULT now() NOT NULL,
	"lastSignedIn" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "users_openId_unique" UNIQUE("openId")
);
--> statement-breakpoint
ALTER TABLE "audit"."admin_actions_redactions" ADD CONSTRAINT "admin_actions_redactions_action_id_admin_actions_id_fk" FOREIGN KEY ("action_id") REFERENCES "audit"."admin_actions"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "banner_impressions" ADD CONSTRAINT "banner_impressions_banner_id_banners_id_fk" FOREIGN KEY ("banner_id") REFERENCES "public"."banners"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "chat_audit_log" ADD CONSTRAINT "chat_audit_log_actor_id_users_id_fk" FOREIGN KEY ("actor_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "chat_audit_log" ADD CONSTRAINT "chat_audit_log_target_user_id_users_id_fk" FOREIGN KEY ("target_user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "chat_audit_log" ADD CONSTRAINT "chat_audit_log_target_tournament_id_tournaments_id_fk" FOREIGN KEY ("target_tournament_id") REFERENCES "public"."tournaments"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "chat_audit_log" ADD CONSTRAINT "chat_audit_log_room_id_chat_rooms_id_fk" FOREIGN KEY ("room_id") REFERENCES "public"."chat_rooms"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "chat_bans" ADD CONSTRAINT "chat_bans_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "chat_bans" ADD CONSTRAINT "chat_bans_room_id_chat_rooms_id_fk" FOREIGN KEY ("room_id") REFERENCES "public"."chat_rooms"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "chat_bans" ADD CONSTRAINT "chat_bans_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "chat_bans" ADD CONSTRAINT "chat_bans_revoked_by_users_id_fk" FOREIGN KEY ("revoked_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "chat_friends_read_state" ADD CONSTRAINT "chat_friends_read_state_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "chat_messages" ADD CONSTRAINT "chat_messages_room_id_chat_rooms_id_fk" FOREIGN KEY ("room_id") REFERENCES "public"."chat_rooms"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "chat_messages" ADD CONSTRAINT "chat_messages_author_id_users_id_fk" FOREIGN KEY ("author_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "chat_messages" ADD CONSTRAINT "chat_messages_edited_by_users_id_fk" FOREIGN KEY ("edited_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "chat_messages" ADD CONSTRAINT "chat_messages_deleted_by_users_id_fk" FOREIGN KEY ("deleted_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "chat_room_members" ADD CONSTRAINT "chat_room_members_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "chat_room_members" ADD CONSTRAINT "chat_room_members_room_id_chat_rooms_id_fk" FOREIGN KEY ("room_id") REFERENCES "public"."chat_rooms"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "player_profiles" ADD CONSTRAINT "player_profiles_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tournament_members" ADD CONSTRAINT "tournament_members_tournament_id_tournaments_id_fk" FOREIGN KEY ("tournament_id") REFERENCES "public"."tournaments"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tournament_members" ADD CONSTRAINT "tournament_members_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tournaments" ADD CONSTRAINT "tournaments_chat_room_id_chat_rooms_id_fk" FOREIGN KEY ("chat_room_id") REFERENCES "public"."chat_rooms"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tournaments" ADD CONSTRAINT "tournaments_prize_pool_id_prize_pools_id_fk" FOREIGN KEY ("prize_pool_id") REFERENCES "public"."prize_pools"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tournaments" ADD CONSTRAINT "tournaments_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "user_favorites" ADD CONSTRAINT "user_favorites_follower_id_users_id_fk" FOREIGN KEY ("follower_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "user_favorites" ADD CONSTRAINT "user_favorites_favorite_id_users_id_fk" FOREIGN KEY ("favorite_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "idx_admin_actions_actor" ON "audit"."admin_actions" USING btree ("actor_id","occurred_at");--> statement-breakpoint
CREATE INDEX "idx_admin_actions_target" ON "audit"."admin_actions" USING btree ("target_type","target_id","occurred_at");--> statement-breakpoint
CREATE INDEX "idx_admin_actions_action" ON "audit"."admin_actions" USING btree ("action","occurred_at");--> statement-breakpoint
CREATE INDEX "gameplay_items_moment_id_idx" ON "gameplay_items" USING btree ("lyric_moment_id");--> statement-breakpoint
CREATE INDEX "gameplay_items_song_id_idx" ON "gameplay_items" USING btree ("song_id");--> statement-breakpoint
CREATE INDEX "gameplay_items_song_diff_type_idx" ON "gameplay_items" USING btree ("song_id","difficulty","question_type");--> statement-breakpoint
CREATE INDEX "gameplay_items_active_idx" ON "gameplay_items" USING btree ("is_active","qa_status");--> statement-breakpoint
CREATE UNIQUE INDEX "gn_stakes_room_user" ON "gn_stakes" USING btree ("roomId","userId");--> statement-breakpoint
CREATE INDEX "gn_stakes_active_created" ON "gn_stakes" USING btree ("state","createdAt");--> statement-breakpoint
CREATE INDEX "lyric_moments_song_id_idx" ON "lyric_moments" USING btree ("song_id");--> statement-breakpoint
CREATE INDEX "lyric_moments_approval_status_idx" ON "lyric_moments" USING btree ("approval_status");--> statement-breakpoint
CREATE INDEX "lyric_moments_song_score_idx" ON "lyric_moments" USING btree ("song_id","overall_playability_score");--> statement-breakpoint
CREATE UNIQUE INDEX "lyric_moments_song_lyric_unique" ON "lyric_moments" USING btree ("song_id","lyric_text");--> statement-breakpoint
CREATE UNIQUE INDEX "round_results_room_round_player_uq" ON "round_results" USING btree ("roomId","roundNumber","activePlayerId") WHERE "roomId" IS NOT NULL AND "activePlayerId" IS NOT NULL;--> statement-breakpoint
CREATE INDEX "song_displays_user_shown_at_idx" ON "song_displays" USING btree ("userId","shownAt");--> statement-breakpoint
CREATE INDEX "song_displays_guest_shown_at_idx" ON "song_displays" USING btree ("guestToken","shownAt");--> statement-breakpoint
CREATE INDEX "song_displays_song_id_idx" ON "song_displays" USING btree ("songId");--> statement-breakpoint
CREATE INDEX "song_displays_reporting_period_song_idx" ON "song_displays" USING btree ("reporting_period_yyyymm","songId");--> statement-breakpoint
CREATE INDEX "song_displays_song_id_variant_idx" ON "song_displays" USING btree ("songId","variantIndex");--> statement-breakpoint
CREATE UNIQUE INDEX "songs_title_artist_unique" ON "songs" USING btree ("title","artistName");