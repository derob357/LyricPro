-- Managed genre/subgenre reference table
CREATE TABLE IF NOT EXISTS "genres" (
  "id"        SERIAL PRIMARY KEY,
  "name"      VARCHAR(64) NOT NULL,
  "parent_id" INTEGER REFERENCES "genres"("id") ON DELETE CASCADE,
  "is_active" BOOLEAN NOT NULL DEFAULT true,
  "sort_order" INTEGER NOT NULL DEFAULT 100,
  "created_at" TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Unique constraint: no duplicate names under the same parent
CREATE UNIQUE INDEX IF NOT EXISTS "genres_name_parent_idx"
  ON "genres" ("name", COALESCE("parent_id", 0));

-- Seed top-level genres
INSERT INTO genres (name, parent_id, sort_order) VALUES
  ('Rock', NULL, 10),
  ('Pop', NULL, 20),
  ('Hip Hop', NULL, 30),
  ('R&B', NULL, 40),
  ('Country', NULL, 50),
  ('Gospel', NULL, 60),
  ('Soul', NULL, 70),
  ('Jazz', NULL, 80),
  ('Reggae', NULL, 90)
ON CONFLICT DO NOTHING;

-- Seed some common subgenres
INSERT INTO genres (name, parent_id, sort_order)
SELECT sub.name, g.id, sub.sort_order
FROM (VALUES
  ('Dancehall', 'Reggae', 10),
  ('Roots Reggae', 'Reggae', 20),
  ('Dub', 'Reggae', 30),
  ('Neo Soul', 'R&B', 10),
  ('Contemporary R&B', 'R&B', 20),
  ('Quiet Storm', 'R&B', 30),
  ('Trap', 'Hip Hop', 10),
  ('Boom Bap', 'Hip Hop', 20),
  ('Conscious', 'Hip Hop', 30),
  ('Alt Rock', 'Rock', 10),
  ('Classic Rock', 'Rock', 20),
  ('Indie Rock', 'Rock', 30),
  ('Synth Pop', 'Pop', 10),
  ('Dance Pop', 'Pop', 20),
  ('Country Pop', 'Country', 10),
  ('Outlaw Country', 'Country', 20),
  ('Contemporary Gospel', 'Gospel', 10),
  ('Traditional Gospel', 'Gospel', 20),
  ('Southern Soul', 'Soul', 10),
  ('Funk', 'Soul', 20),
  ('Smooth Jazz', 'Jazz', 10),
  ('Bebop', 'Jazz', 20),
  ('Jazz Fusion', 'Jazz', 30)
) AS sub(name, parent_name, sort_order)
JOIN genres g ON g.name = sub.parent_name AND g.parent_id IS NULL
ON CONFLICT DO NOTHING;
