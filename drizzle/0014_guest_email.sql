-- 0014_guest_email.sql
-- Adds a nullable email column to guest_sessions for interstitial lead capture.
-- Pure-additive: nullable, no default, no existing rows affected. Safe on prod.
-- See docs/superpowers/specs/2026-06-07-interstitial-home-page-design.md (D2).

ALTER TABLE guest_sessions ADD COLUMN IF NOT EXISTS email VARCHAR(254);
