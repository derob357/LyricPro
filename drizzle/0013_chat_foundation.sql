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
