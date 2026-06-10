-- 0020: GN economy — pool split, stake escrow table, new transaction kinds,
-- idempotency keys. ALTER TYPE ADD VALUE cannot run inside a transaction,
-- so this file is applied non-transactionally (every statement idempotent).

ALTER TYPE golden_note_transaction_kind ADD VALUE IF NOT EXISTS 'stake_escrow';
ALTER TYPE golden_note_transaction_kind ADD VALUE IF NOT EXISTS 'stake_win';
ALTER TYPE golden_note_transaction_kind ADD VALUE IF NOT EXISTS 'stake_refund';
ALTER TYPE golden_note_transaction_kind ADD VALUE IF NOT EXISTS 'signup_grant';
ALTER TYPE golden_note_transaction_kind ADD VALUE IF NOT EXISTS 'spend_hint';
ALTER TYPE golden_note_transaction_kind ADD VALUE IF NOT EXISTS 'spend_streak_insurance';
ALTER TYPE golden_note_transaction_kind ADD VALUE IF NOT EXISTS 'spend_practice_pack';

ALTER TABLE golden_note_balances
  ADD COLUMN IF NOT EXISTS "earnedBalance" integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS "purchasedBalance" integer NOT NULL DEFAULT 0;

-- Existing balances are overwhelmingly Stripe/admin in origin → purchased pool.
-- Idempotent: only rows where the split hasn't been initialized.
UPDATE golden_note_balances
  SET "purchasedBalance" = balance
  WHERE "purchasedBalance" = 0 AND "earnedBalance" = 0 AND balance > 0;

ALTER TABLE golden_note_transactions
  ADD COLUMN IF NOT EXISTS "idempotencyKey" varchar(64);
CREATE UNIQUE INDEX IF NOT EXISTS golden_note_transactions_idem
  ON golden_note_transactions ("idempotencyKey") WHERE "idempotencyKey" IS NOT NULL;

DO $$ BEGIN
  CREATE TYPE gn_stake_state AS ENUM ('active', 'settled', 'refunded');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

CREATE TABLE IF NOT EXISTS gn_stakes (
  id serial PRIMARY KEY,
  "roomId" integer NOT NULL,
  "userId" integer NOT NULL,
  staked integer NOT NULL,
  burned integer NOT NULL DEFAULT 0,
  "wonRounds" integer NOT NULL DEFAULT 0,
  state gn_stake_state NOT NULL DEFAULT 'active',
  "createdAt" timestamptz NOT NULL DEFAULT now(),
  "settledAt" timestamptz
);
CREATE UNIQUE INDEX IF NOT EXISTS gn_stakes_room_user ON gn_stakes ("roomId", "userId");
CREATE INDEX IF NOT EXISTS gn_stakes_active_created ON gn_stakes (state, "createdAt");
