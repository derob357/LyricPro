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

-- ─── Helper: is_chat_banned(user_id, scope, room_id?) ───────────────────────
CREATE OR REPLACE FUNCTION is_chat_banned(p_user_id INTEGER, p_scope chat_ban_scope, p_room_id INTEGER DEFAULT NULL)
RETURNS BOOLEAN AS $$
  SELECT EXISTS (
    SELECT 1 FROM chat_bans
    WHERE user_id = p_user_id
      AND action = 'ban'
      AND revoked_at IS NULL
      AND (expires_at IS NULL OR expires_at > NOW())
      AND (
        (scope = 'global') OR
        (scope = 'room' AND p_scope = 'room' AND room_id = p_room_id)
      )
  );
$$ LANGUAGE SQL STABLE;

-- ─── Helper: is_admin(user_id) ──────────────────────────────────────────────
CREATE OR REPLACE FUNCTION is_chat_admin(p_user_id INTEGER)
RETURNS BOOLEAN AS $$
  SELECT EXISTS (SELECT 1 FROM users WHERE id = p_user_id AND role = 'admin');
$$ LANGUAGE SQL STABLE;

-- ─── Helper: current_chat_user_id() — extracts users.id from JWT sub ────────
-- Maps Supabase auth.uid() to public.users.id via the "openId" column.
-- Confirmed at server/_core/supabase-auth.ts: openId stores the Supabase auth UUID.
CREATE OR REPLACE FUNCTION current_chat_user_id()
RETURNS INTEGER AS $$
  SELECT id FROM users WHERE "openId" = auth.uid()::text LIMIT 1;
$$ LANGUAGE SQL STABLE;

-- ─── RLS on chat_messages ───────────────────────────────────────────────────
ALTER TABLE chat_messages ENABLE ROW LEVEL SECURITY;

-- SELECT policy
CREATE POLICY chat_messages_select ON chat_messages FOR SELECT TO authenticated
  USING (
    -- Soft-deleted: only admin or author sees the row
    (deleted_at IS NULL OR author_id = current_chat_user_id() OR is_chat_admin(current_chat_user_id()))
    AND
    -- Shadow-banned: only admin or author sees the row
    (NOT posted_while_shadow_banned OR author_id = current_chat_user_id() OR is_chat_admin(current_chat_user_id()))
    AND
    -- Scope-specific visibility
    (
      (scope = 'global' AND NOT is_chat_banned(current_chat_user_id(), 'global'))
      OR
      (scope = 'tournament' AND EXISTS (
        SELECT 1 FROM tournament_members tm
        WHERE tm.tournament_id = (SELECT t.id FROM tournaments t WHERE t.chat_room_id = chat_messages.room_id)
          AND tm.user_id = current_chat_user_id()
          AND tm.left_at IS NULL
      ))
      OR
      (scope = 'friends' AND (
        author_id = current_chat_user_id()
        OR EXISTS (
          SELECT 1 FROM user_favorites uf
          WHERE uf.follower_id = current_chat_user_id() AND uf.favorite_id = chat_messages.author_id
        )
      ))
      OR
      is_chat_admin(current_chat_user_id())
    )
  );

-- INSERT policy — defensive; tRPC mutations are the canonical write path.
CREATE POLICY chat_messages_insert ON chat_messages FOR INSERT TO authenticated
  WITH CHECK (
    author_id = current_chat_user_id()
    AND NOT is_chat_banned(current_chat_user_id(), 'global')
    AND (room_id IS NULL OR NOT is_chat_banned(current_chat_user_id(), 'room', room_id))
  );

-- UPDATE policy — admins only (edit/delete message). Authors cannot edit their own messages.
CREATE POLICY chat_messages_update ON chat_messages FOR UPDATE TO authenticated
  USING (is_chat_admin(current_chat_user_id()))
  WITH CHECK (is_chat_admin(current_chat_user_id()));

-- No DELETE policy: deletion is exclusively via soft-delete (UPDATE deleted_at).
-- Retention sweep cron uses service_role which bypasses RLS.

-- ─── RLS on chat_bans ───────────────────────────────────────────────────────
ALTER TABLE chat_bans ENABLE ROW LEVEL SECURITY;

CREATE POLICY chat_bans_select_admin ON chat_bans FOR SELECT TO authenticated
  USING (is_chat_admin(current_chat_user_id()) OR user_id = current_chat_user_id());

CREATE POLICY chat_bans_write_admin ON chat_bans FOR ALL TO authenticated
  USING (is_chat_admin(current_chat_user_id()))
  WITH CHECK (is_chat_admin(current_chat_user_id()));

-- ─── RLS on chat_audit_log — admin SELECT only; INSERT via service_role ─────
ALTER TABLE chat_audit_log ENABLE ROW LEVEL SECURITY;
CREATE POLICY chat_audit_log_select_admin ON chat_audit_log FOR SELECT TO authenticated
  USING (is_chat_admin(current_chat_user_id()));

-- ─── RLS on realtime.messages (private-channel authorization) ───────────────
-- Topic format: chat:global | chat:tournament:<id> | chat:user:<id>:feed | chat:moderation
CREATE POLICY realtime_chat_channel_join ON realtime.messages FOR SELECT TO authenticated
  USING (
    -- Global
    (realtime.topic() = 'chat:global'
      AND NOT is_chat_banned(current_chat_user_id(), 'global'))
    OR
    -- Per-tournament
    (realtime.topic() LIKE 'chat:tournament:%'
      AND EXISTS (
        SELECT 1 FROM tournament_members tm
        JOIN tournaments t ON t.id = tm.tournament_id
        WHERE tm.user_id = current_chat_user_id()
          AND tm.left_at IS NULL
          AND ('chat:tournament:' || t.chat_room_id::text) = realtime.topic()
      )
      AND NOT is_chat_banned(current_chat_user_id(), 'global'))
    OR
    -- Personal feed (Friends + moderation events targeting self)
    (realtime.topic() = ('chat:user:' || current_chat_user_id()::text || ':feed')
      AND NOT is_chat_banned(current_chat_user_id(), 'global'))
    OR
    -- Admin moderation channel
    (realtime.topic() = 'chat:moderation'
      AND is_chat_admin(current_chat_user_id()))
  );

-- ─── Trigger: broadcast new chat_messages to per-room topics ────────────────
CREATE OR REPLACE FUNCTION chat_messages_broadcast() RETURNS TRIGGER AS $$
DECLARE
  follower_id INTEGER;
BEGIN
  IF NEW.scope = 'global' THEN
    PERFORM realtime.broadcast_changes('chat:global', 'message_inserted', 'INSERT', NEW.id::text, NULL, to_jsonb(NEW), NULL);

  ELSIF NEW.scope = 'tournament' THEN
    PERFORM realtime.broadcast_changes('chat:tournament:' || NEW.room_id::text, 'message_inserted', 'INSERT', NEW.id::text, NULL, to_jsonb(NEW), NULL);

  ELSIF NEW.scope = 'friends' THEN
    -- Author always sees their own message
    PERFORM realtime.broadcast_changes('chat:user:' || NEW.author_id::text || ':feed', 'message_inserted', 'INSERT', NEW.id::text, NULL, to_jsonb(NEW), NULL);

    IF NOT NEW.posted_while_shadow_banned THEN
      -- Fan out to every follower of the author
      FOR follower_id IN
        SELECT uf.follower_id FROM user_favorites uf
        WHERE uf.favorite_id = NEW.author_id
      LOOP
        PERFORM realtime.broadcast_changes('chat:user:' || follower_id::text || ':feed', 'message_inserted', 'INSERT', NEW.id::text, NULL, to_jsonb(NEW), NULL);
      END LOOP;
    END IF;

    -- Admins always see all friends messages via the moderation channel
    PERFORM realtime.broadcast_changes('chat:moderation', 'message_inserted', 'INSERT', NEW.id::text, NULL, to_jsonb(NEW), NULL);
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER chat_messages_after_insert
  AFTER INSERT ON chat_messages
  FOR EACH ROW EXECUTE FUNCTION chat_messages_broadcast();

-- ─── Trigger: broadcast message updates (edit / soft-delete) ────────────────
CREATE OR REPLACE FUNCTION chat_messages_broadcast_update() RETURNS TRIGGER AS $$
BEGIN
  -- Only broadcast updates that change user-visible state.
  IF (NEW.deleted_at IS DISTINCT FROM OLD.deleted_at)
     OR (NEW.body != OLD.body)
     OR (NEW.edited_at IS DISTINCT FROM OLD.edited_at)
     OR (NEW.flag_status != OLD.flag_status)
  THEN
    IF NEW.scope = 'global' THEN
      PERFORM realtime.broadcast_changes('chat:global', 'message_updated', 'UPDATE', NEW.id::text, to_jsonb(OLD), to_jsonb(NEW), NULL);
    ELSIF NEW.scope = 'tournament' THEN
      PERFORM realtime.broadcast_changes('chat:tournament:' || NEW.room_id::text, 'message_updated', 'UPDATE', NEW.id::text, to_jsonb(OLD), to_jsonb(NEW), NULL);
    ELSIF NEW.scope = 'friends' THEN
      -- Friends scope: notify the author only. Followers reconcile the
      -- updated/deleted state by message id on next fetch. A future
      -- enhancement can fan out the update to followers explicitly;
      -- not required for Phase 1's deletion-propagation guarantee
      -- (Phase 5 admin delete also re-broadcasts via its own path).
      PERFORM realtime.broadcast_changes('chat:user:' || NEW.author_id::text || ':feed', 'message_updated', 'UPDATE', NEW.id::text, to_jsonb(OLD), to_jsonb(NEW), NULL);
    END IF;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER chat_messages_after_update
  AFTER UPDATE ON chat_messages
  FOR EACH ROW EXECUTE FUNCTION chat_messages_broadcast_update();

-- ─── Trigger: broadcast ban applied/revoked to affected user ────────────────
CREATE OR REPLACE FUNCTION chat_bans_broadcast() RETURNS TRIGGER AS $$
DECLARE
  event_name TEXT;
BEGIN
  IF TG_OP = 'INSERT' THEN
    event_name := 'ban_applied';
  ELSIF NEW.revoked_at IS NOT NULL AND OLD.revoked_at IS NULL THEN
    event_name := 'ban_revoked';
  ELSE
    RETURN NEW;
  END IF;

  PERFORM realtime.broadcast_changes(
    'chat:user:' || NEW.user_id::text || ':feed',
    event_name,
    TG_OP,
    NEW.id::text,
    CASE WHEN TG_OP = 'UPDATE' THEN to_jsonb(OLD) END,
    to_jsonb(NEW),
    NULL
  );
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER chat_bans_after_insert
  AFTER INSERT ON chat_bans
  FOR EACH ROW EXECUTE FUNCTION chat_bans_broadcast();

CREATE TRIGGER chat_bans_after_update
  AFTER UPDATE ON chat_bans
  FOR EACH ROW EXECUTE FUNCTION chat_bans_broadcast();
