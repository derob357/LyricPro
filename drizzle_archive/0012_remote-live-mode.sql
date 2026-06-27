-- Phase 1: Remote Live mode — extend game_rooms for LiveKit video rooms.
-- Idempotent: safe to re-run.
--
-- NOTE: this table uses camelCase quoted column names ("roomCode",
-- "hostUserId", etc) — match that convention for the new columns.

-- 1. Add 'remote_live' to the game_mode enum.
ALTER TYPE game_mode ADD VALUE IF NOT EXISTS 'remote_live';

-- 2. Extend game_rooms with video-room columns (camelCase to match existing).
ALTER TABLE game_rooms ADD COLUMN IF NOT EXISTS "isVideoRoom" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE game_rooms ADD COLUMN IF NOT EXISTS "videoRoomName" TEXT;
ALTER TABLE game_rooms ADD COLUMN IF NOT EXISTS "maxPlayers" INTEGER NOT NULL DEFAULT 8;
ALTER TABLE game_rooms ADD COLUMN IF NOT EXISTS "turnOrder" JSONB;

-- 5. Add invite code columns for shareable room links.
ALTER TABLE game_rooms ADD COLUMN IF NOT EXISTS "inviteCode" VARCHAR(16);
ALTER TABLE game_rooms ADD COLUMN IF NOT EXISTS "inviteExpiresAt" TIMESTAMPTZ;

-- 6. Unique index on inviteCode (when set).
CREATE UNIQUE INDEX IF NOT EXISTS game_rooms_invite_code_idx
  ON game_rooms ("inviteCode")
  WHERE "inviteCode" IS NOT NULL;

-- 3. Constrain maxPlayers to the 2-8 range allowed by the spec.
ALTER TABLE game_rooms DROP CONSTRAINT IF EXISTS game_rooms_max_players_check;
ALTER TABLE game_rooms ADD CONSTRAINT game_rooms_max_players_check
  CHECK ("maxPlayers" BETWEEN 2 AND 8);

-- 4. Unique index on videoRoomName (when set) so LiveKit room names are 1:1 with game rooms.
CREATE UNIQUE INDEX IF NOT EXISTS game_rooms_video_room_name_idx
  ON game_rooms ("videoRoomName")
  WHERE "videoRoomName" IS NOT NULL;
