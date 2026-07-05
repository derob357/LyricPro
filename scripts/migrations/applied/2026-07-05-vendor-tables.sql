-- 2026-07-05-vendor-tables.sql
-- Vendor KPI Phase 2: vendor org/member/key tables + 'vendor' user role.
-- Idempotent. Applied via: scripts/apply-kpi-migration.mjs (generic runner).
-- Spec: docs/superpowers/specs/2026-07-02-vendor-kpi-dashboard-api-design.md

ALTER TYPE user_role ADD VALUE IF NOT EXISTS 'vendor';

CREATE TABLE IF NOT EXISTS vendors (
  id              serial PRIMARY KEY,
  name            varchar(128) NOT NULL,
  contact_email   varchar(320),
  status          varchar(16) NOT NULL DEFAULT 'active', -- 'active' | 'suspended'
  scope_growth       boolean NOT NULL DEFAULT false,
  scope_engagement   boolean NOT NULL DEFAULT false,
  scope_content      boolean NOT NULL DEFAULT false,
  scope_monetization boolean NOT NULL DEFAULT false,
  catalog_filter  jsonb,             -- {"songIds":[..]} and/or {"artists":[..]}; NULL = all content
  created_at      timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS vendor_members (
  id         serial PRIMARY KEY,
  vendor_id  integer NOT NULL REFERENCES vendors(id) ON DELETE CASCADE,
  user_id    integer NOT NULL UNIQUE REFERENCES users(id) ON DELETE CASCADE,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS vendor_members_vendor_idx ON vendor_members (vendor_id);

CREATE TABLE IF NOT EXISTS vendor_api_keys (
  id           serial PRIMARY KEY,
  vendor_id    integer NOT NULL REFERENCES vendors(id) ON DELETE CASCADE,
  label        varchar(64) NOT NULL,
  key_prefix   varchar(16) NOT NULL,  -- e.g. 'lp_live_Ab3d'
  last4        varchar(4)  NOT NULL,
  key_hash     varchar(64) NOT NULL UNIQUE, -- sha256 hex of full plaintext key
  last_used_at timestamptz,
  expires_at   timestamptz,
  revoked_at   timestamptz,
  created_at   timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS vendor_api_keys_vendor_idx ON vendor_api_keys (vendor_id);

CREATE TABLE IF NOT EXISTS vendor_api_usage (
  key_id        integer NOT NULL REFERENCES vendor_api_keys(id) ON DELETE CASCADE,
  date          date NOT NULL,
  request_count integer NOT NULL DEFAULT 0,
  PRIMARY KEY (key_id, date)
);
