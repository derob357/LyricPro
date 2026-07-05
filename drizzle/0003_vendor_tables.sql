-- ALREADY APPLIED TO PROD (manually, 2026-07-05) via
-- scripts/migrations/applied/2026-07-05-vendor-tables.sql.
-- Kept for drizzle journal coherence; do NOT re-apply.
ALTER TYPE "public"."user_role" ADD VALUE 'vendor';--> statement-breakpoint
CREATE TABLE "vendor_api_keys" (
	"id" serial PRIMARY KEY NOT NULL,
	"vendor_id" integer NOT NULL,
	"label" varchar(64) NOT NULL,
	"key_prefix" varchar(16) NOT NULL,
	"last4" varchar(4) NOT NULL,
	"key_hash" varchar(64) NOT NULL,
	"last_used_at" timestamp with time zone,
	"expires_at" timestamp with time zone,
	"revoked_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "vendor_api_keys_key_hash_unique" UNIQUE("key_hash")
);
--> statement-breakpoint
CREATE TABLE "vendor_api_usage" (
	"key_id" integer NOT NULL,
	"date" date NOT NULL,
	"request_count" integer DEFAULT 0 NOT NULL,
	CONSTRAINT "vendor_api_usage_key_id_date_pk" PRIMARY KEY("key_id","date")
);
--> statement-breakpoint
CREATE TABLE "vendor_members" (
	"id" serial PRIMARY KEY NOT NULL,
	"vendor_id" integer NOT NULL,
	"user_id" integer NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "vendor_members_user_id_unique" UNIQUE("user_id")
);
--> statement-breakpoint
CREATE TABLE "vendors" (
	"id" serial PRIMARY KEY NOT NULL,
	"name" varchar(128) NOT NULL,
	"contact_email" varchar(320),
	"status" varchar(16) DEFAULT 'active' NOT NULL,
	"scope_growth" boolean DEFAULT false NOT NULL,
	"scope_engagement" boolean DEFAULT false NOT NULL,
	"scope_content" boolean DEFAULT false NOT NULL,
	"scope_monetization" boolean DEFAULT false NOT NULL,
	"catalog_filter" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "vendor_api_keys" ADD CONSTRAINT "vendor_api_keys_vendor_id_vendors_id_fk" FOREIGN KEY ("vendor_id") REFERENCES "public"."vendors"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "vendor_api_usage" ADD CONSTRAINT "vendor_api_usage_key_id_vendor_api_keys_id_fk" FOREIGN KEY ("key_id") REFERENCES "public"."vendor_api_keys"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "vendor_members" ADD CONSTRAINT "vendor_members_vendor_id_vendors_id_fk" FOREIGN KEY ("vendor_id") REFERENCES "public"."vendors"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "vendor_members" ADD CONSTRAINT "vendor_members_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;