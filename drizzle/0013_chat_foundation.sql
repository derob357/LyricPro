-- 0013_chat_foundation.sql
-- Phase 1 of the multi-room chat system. Pure-additive: no existing tables touched.
-- See docs/superpowers/specs/2026-05-24-chat-system-design.md for design rationale.

-- ─── chat_rooms ─────────────────────────────────────────────────────────────
CREATE TYPE chat_room_kind AS ENUM ('global', 'tournament');

CREATE TABLE chat_rooms (
  id              SERIAL PRIMARY KEY,
  kind            chat_room_kind NOT NULL,
  tournament_id   INTEGER,                       -- FK added later (forward reference)
  retention_days  INTEGER NOT NULL DEFAULT 14,
  "createdAt"     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  "updatedAt"     TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE UNIQUE INDEX chat_rooms_global_singleton
  ON chat_rooms ((1))
  WHERE kind = 'global';

CREATE UNIQUE INDEX chat_rooms_tournament_uniq
  ON chat_rooms (tournament_id)
  WHERE kind = 'tournament';

INSERT INTO chat_rooms (kind, retention_days) VALUES ('global', 14);

-- ─── chat_messages ──────────────────────────────────────────────────────────
CREATE TYPE chat_scope AS ENUM ('global', 'tournament', 'friends');
CREATE TYPE chat_flag_status AS ENUM ('clean', 'flagged', 'flagged_high_confidence', 'reviewed_clean');

CREATE TABLE chat_messages (
  id                            BIGSERIAL PRIMARY KEY,
  scope                         chat_scope NOT NULL,
  room_id                       INTEGER REFERENCES chat_rooms(id) ON DELETE CASCADE,
  author_id                     INTEGER NOT NULL REFERENCES users(id) ON DELETE SET NULL,
  body                          VARCHAR(1000) NOT NULL,
  posted_while_shadow_banned    BOOLEAN NOT NULL DEFAULT FALSE,
  flag_status                   chat_flag_status NOT NULL DEFAULT 'clean',
  flag_reason                   TEXT,
  edited_at                     TIMESTAMPTZ,
  edited_by                     INTEGER REFERENCES users(id),
  deleted_at                    TIMESTAMPTZ,
  deleted_by                    INTEGER REFERENCES users(id),
  deleted_reason                TEXT,
  "createdAt"                   TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  CONSTRAINT chat_messages_room_required CHECK (
    (scope IN ('global', 'tournament') AND room_id IS NOT NULL) OR
    (scope = 'friends' AND room_id IS NULL)
  )
);

CREATE INDEX chat_messages_room_id_id_desc
  ON chat_messages (room_id, id DESC)
  WHERE deleted_at IS NULL AND scope IN ('global', 'tournament');

CREATE INDEX chat_messages_friends_author_id_id_desc
  ON chat_messages (author_id, id DESC)
  WHERE scope = 'friends' AND deleted_at IS NULL;

CREATE INDEX chat_messages_flag_review
  ON chat_messages (flag_status, "createdAt" DESC)
  WHERE flag_status IN ('flagged', 'flagged_high_confidence');

-- ─── user_favorites ─────────────────────────────────────────────────────────
CREATE TABLE user_favorites (
  id            SERIAL PRIMARY KEY,
  follower_id   INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  favorite_id   INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  "createdAt"   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (follower_id, favorite_id),
  CHECK (follower_id != favorite_id)
);
CREATE INDEX user_favorites_follower ON user_favorites (follower_id);
CREATE INDEX user_favorites_favorite ON user_favorites (favorite_id);

-- ─── tournaments ────────────────────────────────────────────────────────────
CREATE TYPE tournament_status AS ENUM ('draft', 'open', 'in_progress', 'completed', 'cancelled');

CREATE TABLE tournaments (
  id              SERIAL PRIMARY KEY,
  name            VARCHAR(128) NOT NULL,
  description     TEXT,
  entry_cost_gn   INTEGER NOT NULL DEFAULT 0 CHECK (entry_cost_gn >= 0),
  capacity        INTEGER CHECK (capacity IS NULL OR capacity > 0),
  starts_at       TIMESTAMPTZ NOT NULL,
  ends_at         TIMESTAMPTZ NOT NULL CHECK (ends_at > starts_at),
  chat_room_id    INTEGER REFERENCES chat_rooms(id),
  status          tournament_status NOT NULL DEFAULT 'draft',
  prize_pool_id   INTEGER REFERENCES prize_pools(id),
  created_by      INTEGER NOT NULL REFERENCES users(id),
  "createdAt"     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  "updatedAt"     TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX tournaments_status_starts_at ON tournaments (status, starts_at);

-- Close the chat_rooms.tournament_id forward reference now that tournaments exists.
ALTER TABLE chat_rooms
  ADD CONSTRAINT chat_rooms_tournament_fk
  FOREIGN KEY (tournament_id) REFERENCES tournaments(id) ON DELETE CASCADE;

ALTER TABLE chat_rooms
  ADD CONSTRAINT chat_rooms_tournament_required CHECK (
    (kind = 'tournament' AND tournament_id IS NOT NULL) OR
    (kind = 'global' AND tournament_id IS NULL)
  );

-- ─── tournament_members ─────────────────────────────────────────────────────
CREATE TYPE tournament_entry_method AS ENUM ('paid', 'admin_invited', 'comp');

CREATE TABLE tournament_members (
  tournament_id   INTEGER NOT NULL REFERENCES tournaments(id) ON DELETE CASCADE,
  user_id         INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  entry_method    tournament_entry_method NOT NULL,
  gn_spent        INTEGER NOT NULL DEFAULT 0,
  joined_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  left_at         TIMESTAMPTZ,
  PRIMARY KEY (tournament_id, user_id)
);
CREATE INDEX tournament_members_user
  ON tournament_members (user_id)
  WHERE left_at IS NULL;

-- ─── chat_bans ──────────────────────────────────────────────────────────────
CREATE TYPE chat_ban_scope AS ENUM ('global', 'room');
CREATE TYPE chat_ban_action AS ENUM ('ban', 'mute_visible', 'mute_shadow');

CREATE TABLE chat_bans (
  id            SERIAL PRIMARY KEY,
  user_id       INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  scope         chat_ban_scope NOT NULL,
  room_id       INTEGER REFERENCES chat_rooms(id) ON DELETE CASCADE,
  action        chat_ban_action NOT NULL,
  reason        TEXT NOT NULL,
  created_by    INTEGER NOT NULL REFERENCES users(id),
  "createdAt"   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  expires_at    TIMESTAMPTZ,
  revoked_at    TIMESTAMPTZ,
  revoked_by    INTEGER REFERENCES users(id),
  CONSTRAINT chat_bans_room_required CHECK (
    (scope = 'room' AND room_id IS NOT NULL) OR
    (scope = 'global' AND room_id IS NULL)
  )
);
CREATE INDEX chat_bans_active
  ON chat_bans (user_id, scope, expires_at)
  WHERE revoked_at IS NULL AND (expires_at IS NULL OR expires_at > NOW());

-- ─── chat_audit_log (immutable, append-only) ────────────────────────────────
CREATE TABLE chat_audit_log (
  id                    BIGSERIAL PRIMARY KEY,
  actor_id              INTEGER NOT NULL REFERENCES users(id),
  actor_role            VARCHAR(32) NOT NULL,
  action                VARCHAR(64) NOT NULL,
  target_user_id        INTEGER REFERENCES users(id),
  target_message_id     BIGINT REFERENCES chat_messages(id),
  target_tournament_id  INTEGER REFERENCES tournaments(id),
  scope                 VARCHAR(32),
  room_id               INTEGER REFERENCES chat_rooms(id),
  reason                TEXT,
  metadata              JSONB,
  ip                    VARCHAR(64),
  user_agent            TEXT,
  "createdAt"           TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX chat_audit_log_actor ON chat_audit_log (actor_id, "createdAt" DESC);
CREATE INDEX chat_audit_log_target_user
  ON chat_audit_log (target_user_id, "createdAt" DESC)
  WHERE target_user_id IS NOT NULL;
CREATE INDEX chat_audit_log_action ON chat_audit_log (action, "createdAt" DESC);

-- Hard-immutability: revoke + deny-change trigger (service_role bypasses RLS,
-- so a privilege-revoke alone isn't enough; the trigger catches everything).
REVOKE UPDATE, DELETE, TRUNCATE ON chat_audit_log FROM PUBLIC;

CREATE OR REPLACE FUNCTION chat_audit_log_deny_change()
RETURNS TRIGGER AS $$
BEGIN
  RAISE EXCEPTION 'chat_audit_log rows are immutable (table is append-only)';
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER chat_audit_log_no_update
  BEFORE UPDATE ON chat_audit_log
  FOR EACH ROW EXECUTE FUNCTION chat_audit_log_deny_change();

CREATE TRIGGER chat_audit_log_no_delete
  BEFORE DELETE ON chat_audit_log
  FOR EACH ROW EXECUTE FUNCTION chat_audit_log_deny_change();

-- ─── chat_room_members (last_read tracking) ────────────────────────────────
CREATE TABLE chat_room_members (
  user_id                  INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  room_id                  INTEGER NOT NULL REFERENCES chat_rooms(id) ON DELETE CASCADE,
  last_read_seq            BIGINT NOT NULL DEFAULT 0,
  last_read_at             TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  notifications_enabled    BOOLEAN NOT NULL DEFAULT TRUE,
  PRIMARY KEY (user_id, room_id)
);

-- ─── chat_friends_read_state ────────────────────────────────────────────────
CREATE TABLE chat_friends_read_state (
  user_id          INTEGER PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  last_read_seq    BIGINT NOT NULL DEFAULT 0,
  last_read_at     TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
