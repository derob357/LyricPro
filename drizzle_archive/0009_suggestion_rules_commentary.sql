-- AI Player Intelligence: suggestion_rules + commentary_templates

CREATE TYPE "suggestion_rule_category" AS ENUM ('mode', 'upsell');

CREATE TABLE IF NOT EXISTS "suggestion_rules" (
  "id"          SERIAL PRIMARY KEY,
  "category"    suggestion_rule_category NOT NULL,
  "trigger_key" VARCHAR(64) NOT NULL UNIQUE,
  "text"        TEXT NOT NULL,
  "action"      VARCHAR(256) NOT NULL,
  "priority"    INTEGER NOT NULL DEFAULT 100,
  "is_active"   BOOLEAN NOT NULL DEFAULT true,
  "created_at"  TIMESTAMPTZ NOT NULL DEFAULT now(),
  "updated_at"  TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS "commentary_templates" (
  "id"          SERIAL PRIMARY KEY,
  "trigger_key" VARCHAR(64) NOT NULL,
  "text"        TEXT NOT NULL,
  "priority"    INTEGER NOT NULL DEFAULT 100,
  "is_active"   BOOLEAN NOT NULL DEFAULT true,
  "created_at"  TIMESTAMPTZ NOT NULL DEFAULT now(),
  "updated_at"  TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Seed default suggestion rules
INSERT INTO suggestion_rules (category, trigger_key, text, action, priority) VALUES
  ('mode', 'nudge-medium', 'Low is too easy for you. Medium unlocks harder lyrics and double the points.', '/play?difficulty=medium', 10),
  ('mode', 'try-multiplayer', 'You''ve been going solo — challenge a friend and see who really knows their lyrics.', '/play?mode=multiplayer', 20),
  ('mode', 'try-team', 'Try Team mode — draft your squad and battle together.', '/play?mode=team', 30),
  ('mode', 'try-new-genre', 'You own {strongGenre}. Ready to test yourself with some {weakGenre}?', '/play?genre={weakGenre}', 40),
  ('mode', 'mix-genres', 'Shake it up — try a mixed-genre game and see how you do across the board.', '/play', 41),
  ('mode', 'try-speed-bonus', 'Your streak game is strong. Try speed bonus mode — same fire, tighter clock.', '/play?ranking=speed_bonus', 50),
  ('mode', 'welcome-back', 'Welcome back! New songs have been added while you were away.', '/play', 60),
  ('mode', 'try-marathon', 'Going hard today! A 10-round marathon might be your vibe.', '/play?rounds=10', 70),
  ('mode', 'nudge-high', 'You''ve been leveling up. High difficulty is where the real points are — ready?', '/play?difficulty=high', 80),
  ('upsell', 'upsell-golden-notes', 'Playing every day? Grab some Golden Notes so you never hit a cap.', '/shop', 10),
  ('upsell', 'spend-golden-notes', 'You''re sitting on {gnBalance} Golden Notes. Use them to unlock practice packs for your weak spots.', '/dashboard', 20),
  ('upsell', 'practice-pack', 'Your {weakGenre} game needs work. Try a practice pack to level up.', '/dashboard', 30)
ON CONFLICT (trigger_key) DO NOTHING;

-- Seed default commentary templates
INSERT INTO commentary_templates (trigger_key, text, priority) VALUES
  -- 0/4 correct
  ('zero_correct', 'Tough one. Even the DJ doesn''t know every track.', 10),
  ('zero_correct', 'That song was a deep cut. Don''t sweat it.', 20),
  ('zero_correct', 'Oof. Pretend that round never happened.', 30),
  ('zero_correct_speed', 'Even Usain Bolt trips sometimes. Shake it off.', 10),
  ('zero_correct_streak', 'There goes the streak... rebuild starts now.', 10),
  ('zero_correct_genre_mismatch', '{genre} isn''t your lane yet. That''s what practice mode is for.', 10),
  -- 1/4 correct
  ('one_correct', 'One down, three to go. You''ll get there.', 10),
  ('one_correct', 'Hey, at least you got one. Progress.', 20),
  ('one_correct_artist_only', 'You know WHO sings it, just not WHAT they sing. Classic fan move.', 10),
  ('one_correct_year_only', 'You''re a walking music calendar. Now learn the actual lyrics.', 10),
  ('one_correct_lyric_only', 'You know the words but not who wrote them. Interesting.', 10),
  ('one_correct_title_only', 'Song title locked in. Now nail the rest.', 10),
  -- 2/4 correct
  ('two_correct', 'Halfway there. Not bad at all.', 10),
  ('two_correct', 'Two for four — you''re in the game.', 20),
  ('two_correct', 'Solid start. A couple tweaks and you''re dangerous.', 30),
  -- 3/4 correct
  ('three_correct', 'So close to perfect! One more and you own it.', 10),
  ('three_correct', 'Three out of four — that''s a strong round.', 20),
  ('three_correct', 'Almost flawless. What tripped you up?', 30),
  -- 4/4 perfect
  ('perfect', 'Flawless. Absolutely flawless.', 10),
  ('perfect', 'Nothing but net. Every single one.', 20),
  ('perfect_first', 'Your FIRST perfect round! Screenshot this — it''s going in the hall of fame.', 10),
  ('perfect_speed', '{responseTime} seconds. Your brain is basically Shazam.', 10),
  ('perfect_weak_genre', 'Wait — you just aced {genre}? Who ARE you?', 10),
  ('perfect_streak', 'That''s {streakCount} perfects in a row. Are you cheating? (We checked. You''re not.)', 10),
  -- Multiplayer
  ('mp_close_win', 'Won by {margin} points. Your opponent is typing ''rematch'' right now.', 10),
  ('mp_blowout_win', 'That wasn''t even fair. Maybe invite someone who actually listens to music.', 10),
  ('mp_close_loss', 'Lost by {margin} points. ONE more correct year and you had it.', 10),
  ('mp_blowout_loss', 'Sometimes you''re the DJ. Sometimes you''re the aux cord that gets unplugged.', 10),
  -- Improvement
  ('improved', 'Last session avg: {oldAvg}. This session: {newAvg}. You''re leveling up.', 10),
  -- Pass
  ('passed', 'Smart to pass — save your streak for one you know.', 10),
  ('passed', 'No shame in passing. Live to play another round.', 20);
