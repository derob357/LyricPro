-- 0019: marketing consent audit columns on guest_sessions + users.
-- Additive only; all columns nullable or defaulted, so safe on live tables.
ALTER TABLE guest_sessions
  ADD COLUMN IF NOT EXISTS "marketingOptIn" boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS "consentedAt" timestamptz,
  ADD COLUMN IF NOT EXISTS "consentWordingVersion" varchar(32),
  ADD COLUMN IF NOT EXISTS "consentSource" varchar(64),
  ADD COLUMN IF NOT EXISTS "consentIp" varchar(45);

ALTER TABLE users
  ADD COLUMN IF NOT EXISTS "marketingOptIn" boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS "consentedAt" timestamptz,
  ADD COLUMN IF NOT EXISTS "consentWordingVersion" varchar(32),
  ADD COLUMN IF NOT EXISTS "consentSource" varchar(64),
  ADD COLUMN IF NOT EXISTS "consentIp" varchar(45);
