-- Partner/news hero banners
CREATE TABLE IF NOT EXISTS "banners" (
  "id"              SERIAL PRIMARY KEY,
  "title"           VARCHAR(256) NOT NULL,
  "subtitle"        TEXT,
  "cta_text"        VARCHAR(64) NOT NULL DEFAULT 'Learn More',
  "cta_action"      VARCHAR(512) NOT NULL,
  "partner_name"    VARCHAR(128),
  "partner_logo_url" VARCHAR(512),
  "badge_text"      VARCHAR(32) DEFAULT 'Featured',
  "badge_color"     VARCHAR(7) DEFAULT '#EF4444',
  "image_emoji"     VARCHAR(8),
  "image_url"       VARCHAR(512),
  "audience"        VARCHAR(32) NOT NULL DEFAULT 'all',
  "target_json"     JSONB DEFAULT '{}',
  "priority"        INTEGER NOT NULL DEFAULT 100,
  "is_active"       BOOLEAN NOT NULL DEFAULT true,
  "starts_at"       TIMESTAMPTZ,
  "ends_at"         TIMESTAMPTZ,
  "created_at"      TIMESTAMPTZ NOT NULL DEFAULT now(),
  "updated_at"      TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS "banner_impressions" (
  "id"          SERIAL PRIMARY KEY,
  "banner_id"   INTEGER NOT NULL REFERENCES "banners"("id") ON DELETE CASCADE,
  "user_id"     INTEGER,
  "clicked_at"  TIMESTAMPTZ,
  "shown_at"    TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS "banner_impressions_banner_id_idx" ON "banner_impressions" ("banner_id");

-- Seed a default iHeart banner
INSERT INTO banners (title, subtitle, cta_text, cta_action, partner_name, badge_text, badge_color, image_emoji, audience, priority) VALUES
  ('iHeartRadio Jingle Ball Trivia Night', 'Play during the broadcast — top 10 scorers win backstage passes to the LA show.', 'Play to Win', '/setup', 'iHeartRadio', 'Live Event', '#EF4444', '🎄', 'all', 10)
ON CONFLICT DO NOTHING;
