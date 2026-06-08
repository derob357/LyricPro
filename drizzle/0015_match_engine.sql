-- 0015_match_engine.sql
-- Synchronized multiplayer engine: round phase + deadline on game_rooms,
-- and a uniqueness guard preventing double-submit per (room, round, player).
-- Additive + idempotent. Safe on prod.

DO $$ BEGIN
  CREATE TYPE round_phase AS ENUM ('in_question', 'intermission', 'complete');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

ALTER TABLE game_rooms ADD COLUMN IF NOT EXISTS "roundPhase" round_phase;
ALTER TABLE game_rooms ADD COLUMN IF NOT EXISTS "roundEndsAt" timestamptz;

-- One answer row per player per round. Partial: only when both keys present
-- (legacy turn-based rows may have null activePlayerId).
CREATE UNIQUE INDEX IF NOT EXISTS round_results_room_round_player_uq
  ON round_results ("roomId", "roundNumber", "activePlayerId")
  WHERE "roomId" IS NOT NULL AND "activePlayerId" IS NOT NULL;
