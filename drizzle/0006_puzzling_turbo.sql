-- Widens subscription_status enum so the upcoming customer.subscription.updated
-- and invoice.payment_failed webhook handlers (Tasks 14 / 15) can write the full
-- Stripe state space. Surfaced by Wave 0 baseline scan finding CA-08.
--
-- drizzle-kit auto-generation also detected Phase 5b drift (CREATE TYPE for
-- candidate_use_case/licensing_status/prompt_format/qa_status/question_type and
-- CREATE TABLE for gameplay_items/lyric_moments/song_displays + columns on songs).
-- Those were already applied to production via orphaned 0006_song_displays.sql /
-- 0007_lyric_variants.sql and are reflected in the live DB per project memory
-- (Phase 5b applied 2026-05-06). They are intentionally stripped from this
-- migration to avoid "already exists" errors. The drizzle/meta/0006_snapshot.json
-- already reflects the full live state, so subsequent drizzle-kit generate runs
-- will see no drift.

ALTER TYPE "public"."subscription_status" ADD VALUE 'past_due';--> statement-breakpoint
ALTER TYPE "public"."subscription_status" ADD VALUE 'unpaid';--> statement-breakpoint
ALTER TYPE "public"."subscription_status" ADD VALUE 'trialing';--> statement-breakpoint
ALTER TYPE "public"."subscription_status" ADD VALUE 'incomplete';--> statement-breakpoint
ALTER TYPE "public"."subscription_status" ADD VALUE 'incomplete_expired';
