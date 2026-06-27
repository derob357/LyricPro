-- AI Player Intelligence Phase 1: player_profiles table
CREATE TABLE IF NOT EXISTS "player_profiles" (
  "user_id"           INTEGER PRIMARY KEY REFERENCES "users"("id") ON DELETE CASCADE,
  "profile"           JSONB NOT NULL DEFAULT '{}',
  "computed_at"       TIMESTAMPTZ NOT NULL DEFAULT now(),
  "games_at_compute"  INTEGER NOT NULL DEFAULT 0
);
