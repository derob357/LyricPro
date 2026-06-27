-- 0017_match_question.sql
-- Store the per-round answer-free MC question on the room so getMatchState
-- returns a STABLE payload (no reshuffle on every poll). Additive/nullable.
ALTER TABLE game_rooms ADD COLUMN IF NOT EXISTS "currentQuestion" jsonb;
