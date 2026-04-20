CREATE TYPE "public"."golden_note_gift_status" AS ENUM('pending', 'accepted', 'declined', 'expired');--> statement-breakpoint
CREATE TYPE "public"."golden_note_transaction_kind" AS ENUM('purchase', 'spend_extra_game', 'spend_tournament', 'spend_advanced_mode', 'gift_sent', 'gift_received', 'refund', 'expiry', 'admin_adjustment');--> statement-breakpoint
CREATE TABLE "golden_note_balances" (
	"userId" integer PRIMARY KEY NOT NULL,
	"balance" integer DEFAULT 0 NOT NULL,
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
	"createdAt" timestamp with time zone DEFAULT now() NOT NULL
);
