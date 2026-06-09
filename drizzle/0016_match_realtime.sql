-- 0016_match_realtime.sql
-- Realtime for synchronized matches. Mirrors the chat broadcast pipeline (0013).
-- Topic: game:{game_rooms.id}. Two triggers:
--   1. game_rooms_broadcast_trg  — fires on UPDATE, signals phase/status transitions
--   2. round_results_broadcast_trg — fires on INSERT, signals player_answered
-- RLS lets a user subscribe only to rooms they belong to.
-- Idempotent: DROP ... IF EXISTS before CREATE.
--
-- Anti-cheat: round_results INSERT broadcasts a MINIMAL payload (activePlayerId +
-- roundNumber only) via realtime.send(), NOT the full row. Broadcasting the full
-- row would reveal answers/points to other clients before the reveal phase.
-- realtime.send() signature: (payload jsonb, event text, topic text, private boolean)
--
-- broadcast_changes signature (verified against live DB — see 0013, apply-chat-trigger-fix.mjs):
--   (topic_name text, event_name text, operation text,
--    table_name text, table_schema text,
--    new record, old record)
-- Pass NEW/OLD as-is (typed record). DO NOT cast to jsonb.

-- ── RLS: a user may join game:{roomId} only if they are a room_player ──────────
DROP POLICY IF EXISTS realtime_game_channel_join ON realtime.messages;
CREATE POLICY realtime_game_channel_join ON realtime.messages FOR SELECT TO authenticated
USING (
  realtime.topic() LIKE 'game:%'
  AND EXISTS (
    SELECT 1 FROM room_players rp
    WHERE rp."roomId" = NULLIF(split_part(realtime.topic(), ':', 2), '')::int
      AND rp."userId" = current_chat_user_id()
  )
);

-- ── Trigger function: broadcast game_rooms phase/status transitions ─────────────
CREATE OR REPLACE FUNCTION game_rooms_broadcast() RETURNS TRIGGER AS $$
DECLARE
  ev text;
BEGIN
  -- round_started: entering in_question on any round (new round or phase change)
  IF NEW."roundPhase" = 'in_question'
     AND (OLD."currentRound" IS DISTINCT FROM NEW."currentRound"
          OR OLD."roundPhase" IS DISTINCT FROM NEW."roundPhase") THEN
    ev := 'round_started';
  -- round_revealed: entering intermission
  ELSIF NEW."roundPhase" = 'intermission'
        AND OLD."roundPhase" IS DISTINCT FROM NEW."roundPhase" THEN
    ev := 'round_revealed';
  -- match_complete: room transitions to finished
  ELSIF NEW.status = 'finished'
        AND OLD.status IS DISTINCT FROM NEW.status THEN
    ev := 'match_complete';
  ELSE
    -- No meaningful transition — skip broadcast
    RETURN NEW;
  END IF;

  PERFORM realtime.broadcast_changes(
    'game:' || NEW.id::text,
    ev,
    TG_OP,
    'game_rooms',
    'public',
    NEW,
    OLD
  );
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

DROP TRIGGER IF EXISTS game_rooms_broadcast_trg ON game_rooms;
CREATE TRIGGER game_rooms_broadcast_trg
  AFTER UPDATE ON game_rooms
  FOR EACH ROW EXECUTE FUNCTION game_rooms_broadcast();

-- ── Trigger function: broadcast minimal player_answered signal ─────────────────
-- ANTI-CHEAT: We do NOT use broadcast_changes here because that would send the
-- full round_results row (userLyricAnswer, userArtistAnswer, points, etc.) to
-- every subscriber before the reveal phase, letting players copy answers.
-- Instead we use realtime.send() with a hand-crafted minimal payload containing
-- only the non-sensitive signal fields: roomId, activePlayerId, roundNumber.
-- Clients use this to update "X players have answered" UI without seeing answers.
CREATE OR REPLACE FUNCTION round_results_broadcast() RETURNS TRIGGER AS $$
BEGIN
  IF NEW."roomId" IS NOT NULL THEN
    PERFORM realtime.send(
      jsonb_build_object(
        'roomId',         NEW."roomId",
        'activePlayerId', NEW."activePlayerId",
        'roundNumber',    NEW."roundNumber"
      ),
      'player_answered',
      'game:' || NEW."roomId"::text,
      true  -- private channel (requires subscription auth)
    );
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

DROP TRIGGER IF EXISTS round_results_broadcast_trg ON round_results;
CREATE TRIGGER round_results_broadcast_trg
  AFTER INSERT ON round_results
  FOR EACH ROW EXECUTE FUNCTION round_results_broadcast();
