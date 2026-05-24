# Chat System — Phase 1: Foundation — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship the infrastructure layer for the multi-room chat system — database schema, RLS, broadcast-from-database triggers, immutable audit log, rate-limit wrapper, ban-check helper, retention/purge cron jobs, client-side Realtime client wiring with JWT refresh, and Capacitor keyboard scaffolding — without exposing any user-facing chat endpoints. Phase 2 will turn this foundation into the working Global chat.

**Architecture:** Postgres holds all chat state under `public.chat_*` tables. Supabase Realtime Broadcast-from-Database fans out per-room events via AFTER-INSERT triggers calling `realtime.broadcast_changes()`. Private channels with RLS on `realtime.messages` enforce membership at JOIN. Audit log is hard-immutable (revoke + deny-change trigger). Vercel Cron purges old + soft-deleted rows. Client subscribes to channels via `@supabase/supabase-js` from React; JWT refresh is wired explicitly to `supabase.realtime.setAuth(...)`.

**Tech Stack:** Drizzle (Postgres), Supabase Realtime, `@upstash/ratelimit` + `@upstash/redis`, Vercel Cron, `@capacitor/keyboard`, Vitest, tRPC. Reuses the existing project's tRPC + auth + Drizzle conventions.

**Reference spec:** [docs/superpowers/specs/2026-05-24-chat-system-design.md](../specs/2026-05-24-chat-system-design.md)

---

## File structure (created or modified by this phase)

### Created

- `drizzle/0013_chat_foundation.sql` — single migration containing all 9 tables, indexes, RLS policies, triggers, and immutability enforcement
- `server/_core/chatBans.ts` — `getActiveBan(userId, scope, roomId?)` helper; used by every chat tRPC procedure
- `server/_core/chatBans.test.ts` — unit + DB integration tests
- `server/_core/chatRateLimit.ts` — Upstash token-bucket wrapper, env-gated (no-op if `UPSTASH_REDIS_REST_URL` unset)
- `server/_core/chatRateLimit.test.ts` — mocked-Redis unit tests
- `server/_core/chatAudit.ts` — `recordChatAction({ tx, ctx, action, ... })` writes to `chat_audit_log`
- `server/_core/chatAudit.test.ts` — verifies row shape + immutability
- `server/routers/chat.ts` — placeholder `chatRouter` with shared `requireNotBannedFromChat` middleware; no endpoints yet (Phase 2 adds them)
- `server/routers/chat.test.ts` — covers ban middleware in isolation
- `api/cron/chat-retention-sweep.ts` — Vercel Cron handler: deletes Global/Friends messages older than 14 days; tournament messages older than `ends_at + 30 days` when completed/cancelled
- `api/cron/chat-purge-soft-deleted.ts` — Vercel Cron handler: GDPR-safe body purge for messages soft-deleted >30 days ago
- `client/src/lib/supabase/realtimeClient.ts` — wraps the existing `client/src/lib/supabase.ts` singleton; exports `useRealtimeAuth()` hook for JWT refresh wiring
- `client/src/lib/capacitor/useKeyboardHeight.ts` — listens to `keyboardWillShow` / `keyboardDidHide`, sets `--kb-height` CSS var on `:root`
- `client/src/lib/capacitor/keyboardHeight.test.ts` — tests the CSS-var update under both listener events

### Modified

- `drizzle/schema.ts` — append 9 new table definitions matching the migration
- `drizzle/relations.ts` — add relation declarations for the new tables (only where they cross-reference each other)
- `server/app-router.ts` — import and register `chatRouter` (will be empty router until Phase 2 adds endpoints)
- `package.json` — add `@upstash/ratelimit`, `@upstash/redis`, `@capacitor/keyboard` dependencies
- `vercel.json` — add `crons` section for the two new handlers
- `capacitor.config.ts` — change `Keyboard.resize` from `"body"` to `"native"` per research recommendation; add `resizeOnFullScreen: true` (already present) and `Keyboard` listener-friendly defaults
- `client/index.html` — add `viewport-fit=cover` to the viewport meta tag so `env(safe-area-inset-*)` returns real values
- `client/src/index.css` — add `:root { --kb-height: 0px; }` and a `.chat-safe-area-bottom { padding-bottom: calc(env(safe-area-inset-bottom) + var(--kb-height, 0px)); }` utility class
- `client/src/App.tsx` — call `useRealtimeAuth()` near the root so JWT refresh is wired once per session

---

## Task 1: Install dependencies

**Files:**
- Modify: `package.json`

- [ ] **Step 1: Install runtime dependencies**

Run:
```bash
pnpm add @upstash/ratelimit @upstash/redis @capacitor/keyboard
```

- [ ] **Step 2: Verify versions and lock file**

Run:
```bash
pnpm list @upstash/ratelimit @upstash/redis @capacitor/keyboard
git status
```
Expected: three packages present in `dependencies` (not `devDependencies`); `package.json` and `pnpm-lock.yaml` modified.

- [ ] **Step 3: Commit**

```bash
git add package.json pnpm-lock.yaml
git commit -m "feat(chat): install upstash ratelimit + capacitor keyboard deps"
```

---

## Task 2: Migration 0013 — schema DDL (chat_rooms + chat_messages)

**Files:**
- Create: `drizzle/0013_chat_foundation.sql`
- Modify: `drizzle/schema.ts`

- [ ] **Step 1: Write the migration header + first two tables**

Create `drizzle/0013_chat_foundation.sql` with:

```sql
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
```

- [ ] **Step 2: Append Drizzle definitions to `drizzle/schema.ts`**

Add at the bottom of `drizzle/schema.ts`, just before the existing exports section (search for the last `pgTable` definition; insert immediately after):

```ts
// ─── Chat: rooms + messages ────────────────────────────────────────────────
export const chatRoomKindEnum = pgEnum("chat_room_kind", ["global", "tournament"]);
export const chatScopeEnum = pgEnum("chat_scope", ["global", "tournament", "friends"]);
export const chatFlagStatusEnum = pgEnum("chat_flag_status", [
  "clean",
  "flagged",
  "flagged_high_confidence",
  "reviewed_clean",
]);

export const chatRooms = pgTable("chat_rooms", {
  id: serial("id").primaryKey(),
  kind: chatRoomKindEnum("kind").notNull(),
  tournamentId: integer("tournament_id"), // FK added by migration once tournaments table exists
  retentionDays: integer("retention_days").notNull().default(14),
  createdAt: createdAtColumn(),
  updatedAt: updatedAtColumn(),
});

export type ChatRoom = typeof chatRooms.$inferSelect;

export const chatMessages = pgTable("chat_messages", {
  id: bigserial("id", { mode: "number" }).primaryKey(),
  scope: chatScopeEnum("scope").notNull(),
  roomId: integer("room_id").references(() => chatRooms.id, { onDelete: "cascade" }),
  authorId: integer("author_id")
    .notNull()
    .references(() => users.id, { onDelete: "set null" }),
  body: varchar("body", { length: 1000 }).notNull(),
  postedWhileShadowBanned: boolean("posted_while_shadow_banned").notNull().default(false),
  flagStatus: chatFlagStatusEnum("flag_status").notNull().default("clean"),
  flagReason: text("flag_reason"),
  editedAt: timestamp("edited_at", { withTimezone: true }),
  editedBy: integer("edited_by").references(() => users.id),
  deletedAt: timestamp("deleted_at", { withTimezone: true }),
  deletedBy: integer("deleted_by").references(() => users.id),
  deletedReason: text("deleted_reason"),
  createdAt: createdAtColumn(),
});

export type ChatMessage = typeof chatMessages.$inferSelect;
export type InsertChatMessage = typeof chatMessages.$inferInsert;
```

Imports at top of `drizzle/schema.ts` may need `bigserial` added if not already present — grep for `bigserial` to confirm; add to the existing `drizzle-orm/pg-core` import line if missing.

- [ ] **Step 3: Run typecheck**

Run:
```bash
pnpm check
```
Expected: PASS, no new errors.

- [ ] **Step 4: Commit**

```bash
git add drizzle/0013_chat_foundation.sql drizzle/schema.ts
git commit -m "feat(chat): migration 0013 — chat_rooms + chat_messages tables"
```

---

## Task 3: Migration 0013 — user_favorites + tournaments + tournament_members

**Files:**
- Modify: `drizzle/0013_chat_foundation.sql`
- Modify: `drizzle/schema.ts`

- [ ] **Step 1: Append DDL to migration**

Append to `drizzle/0013_chat_foundation.sql`:

```sql
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
```

- [ ] **Step 2: Append Drizzle definitions to `drizzle/schema.ts`**

Append after the `chatMessages` block from Task 2:

```ts
// ─── Chat: user favorites ──────────────────────────────────────────────────
export const userFavorites = pgTable("user_favorites", {
  id: serial("id").primaryKey(),
  followerId: integer("follower_id")
    .notNull()
    .references(() => users.id, { onDelete: "cascade" }),
  favoriteId: integer("favorite_id")
    .notNull()
    .references(() => users.id, { onDelete: "cascade" }),
  createdAt: createdAtColumn(),
});

export type UserFavorite = typeof userFavorites.$inferSelect;

// ─── Chat: tournaments ─────────────────────────────────────────────────────
export const tournamentStatusEnum = pgEnum("tournament_status", [
  "draft",
  "open",
  "in_progress",
  "completed",
  "cancelled",
]);

export const tournaments = pgTable("tournaments", {
  id: serial("id").primaryKey(),
  name: varchar("name", { length: 128 }).notNull(),
  description: text("description"),
  entryCostGn: integer("entry_cost_gn").notNull().default(0),
  capacity: integer("capacity"),
  startsAt: timestamp("starts_at", { withTimezone: true }).notNull(),
  endsAt: timestamp("ends_at", { withTimezone: true }).notNull(),
  chatRoomId: integer("chat_room_id").references(() => chatRooms.id),
  status: tournamentStatusEnum("status").notNull().default("draft"),
  prizePoolId: integer("prize_pool_id").references(() => prizePools.id),
  createdBy: integer("created_by")
    .notNull()
    .references(() => users.id),
  createdAt: createdAtColumn(),
  updatedAt: updatedAtColumn(),
});

export type Tournament = typeof tournaments.$inferSelect;
export type InsertTournament = typeof tournaments.$inferInsert;

// ─── Chat: tournament members ──────────────────────────────────────────────
export const tournamentEntryMethodEnum = pgEnum("tournament_entry_method", [
  "paid",
  "admin_invited",
  "comp",
]);

export const tournamentMembers = pgTable(
  "tournament_members",
  {
    tournamentId: integer("tournament_id")
      .notNull()
      .references(() => tournaments.id, { onDelete: "cascade" }),
    userId: integer("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    entryMethod: tournamentEntryMethodEnum("entry_method").notNull(),
    gnSpent: integer("gn_spent").notNull().default(0),
    joinedAt: timestamp("joined_at", { withTimezone: true }).notNull().defaultNow(),
    leftAt: timestamp("left_at", { withTimezone: true }),
  },
  (t) => ({
    pk: primaryKey({ columns: [t.tournamentId, t.userId] }),
  }),
);

export type TournamentMember = typeof tournamentMembers.$inferSelect;
```

- [ ] **Step 3: Run typecheck**

Run:
```bash
pnpm check
```
Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git add drizzle/0013_chat_foundation.sql drizzle/schema.ts
git commit -m "feat(chat): migration 0013 — user_favorites + tournaments + tournament_members"
```

---

## Task 4: Migration 0013 — chat_bans + chat_audit_log (with immutability) + chat_room_members + chat_friends_read_state

**Files:**
- Modify: `drizzle/0013_chat_foundation.sql`
- Modify: `drizzle/schema.ts`

- [ ] **Step 1: Append DDL**

Append to `drizzle/0013_chat_foundation.sql`:

```sql
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
```

- [ ] **Step 2: Append Drizzle definitions**

Append to `drizzle/schema.ts`:

```ts
// ─── Chat: bans ────────────────────────────────────────────────────────────
export const chatBanScopeEnum = pgEnum("chat_ban_scope", ["global", "room"]);
export const chatBanActionEnum = pgEnum("chat_ban_action", [
  "ban",
  "mute_visible",
  "mute_shadow",
]);

export const chatBans = pgTable("chat_bans", {
  id: serial("id").primaryKey(),
  userId: integer("user_id")
    .notNull()
    .references(() => users.id, { onDelete: "cascade" }),
  scope: chatBanScopeEnum("scope").notNull(),
  roomId: integer("room_id").references(() => chatRooms.id, { onDelete: "cascade" }),
  action: chatBanActionEnum("action").notNull(),
  reason: text("reason").notNull(),
  createdBy: integer("created_by")
    .notNull()
    .references(() => users.id),
  createdAt: createdAtColumn(),
  expiresAt: timestamp("expires_at", { withTimezone: true }),
  revokedAt: timestamp("revoked_at", { withTimezone: true }),
  revokedBy: integer("revoked_by").references(() => users.id),
});

export type ChatBan = typeof chatBans.$inferSelect;

// ─── Chat: audit log (append-only — never UPDATE or DELETE through Drizzle) ──
export const chatAuditLog = pgTable("chat_audit_log", {
  id: bigserial("id", { mode: "number" }).primaryKey(),
  actorId: integer("actor_id")
    .notNull()
    .references(() => users.id),
  actorRole: varchar("actor_role", { length: 32 }).notNull(),
  action: varchar("action", { length: 64 }).notNull(),
  targetUserId: integer("target_user_id").references(() => users.id),
  targetMessageId: integer("target_message_id"),
  targetTournamentId: integer("target_tournament_id").references(() => tournaments.id),
  scope: varchar("scope", { length: 32 }),
  roomId: integer("room_id").references(() => chatRooms.id),
  reason: text("reason"),
  metadata: jsonb("metadata"),
  ip: varchar("ip", { length: 64 }),
  userAgent: text("user_agent"),
  createdAt: createdAtColumn(),
});

export type ChatAuditLogEntry = typeof chatAuditLog.$inferSelect;

// ─── Chat: room membership + read state ────────────────────────────────────
export const chatRoomMembers = pgTable(
  "chat_room_members",
  {
    userId: integer("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    roomId: integer("room_id")
      .notNull()
      .references(() => chatRooms.id, { onDelete: "cascade" }),
    lastReadSeq: bigint("last_read_seq", { mode: "number" }).notNull().default(0),
    lastReadAt: timestamp("last_read_at", { withTimezone: true }).notNull().defaultNow(),
    notificationsEnabled: boolean("notifications_enabled").notNull().default(true),
  },
  (t) => ({ pk: primaryKey({ columns: [t.userId, t.roomId] }) }),
);

export const chatFriendsReadState = pgTable("chat_friends_read_state", {
  userId: integer("user_id")
    .primaryKey()
    .references(() => users.id, { onDelete: "cascade" }),
  lastReadSeq: bigint("last_read_seq", { mode: "number" }).notNull().default(0),
  lastReadAt: timestamp("last_read_at", { withTimezone: true }).notNull().defaultNow(),
});
```

- [ ] **Step 3: Run typecheck**

Run:
```bash
pnpm check
```
Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git add drizzle/0013_chat_foundation.sql drizzle/schema.ts
git commit -m "feat(chat): migration 0013 — bans, audit log (immutable), read-state tables"
```

---

## Task 5: Migration 0013 — RLS policies on chat_messages, chat_bans, realtime.messages

**Files:**
- Modify: `drizzle/0013_chat_foundation.sql`

- [ ] **Step 1: Append RLS DDL**

Append to `drizzle/0013_chat_foundation.sql`:

```sql
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
-- Maps Supabase auth.uid() to public.users.id. Existing app already does this
-- mapping in TypeScript; we replicate the lookup here for RLS.
CREATE OR REPLACE FUNCTION current_chat_user_id()
RETURNS INTEGER AS $$
  SELECT id FROM users WHERE supabase_user_id = auth.uid()::text LIMIT 1;
$$ LANGUAGE SQL STABLE;

-- NOTE: if `users.supabase_user_id` is not the actual column name, replace
-- with whatever the existing mapping uses. Verify against drizzle/schema.ts
-- before running the migration.

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
```

- [ ] **Step 2: Verify the `supabase_user_id` column name assumption**

Run:
```bash
grep -n "supabase_user_id\|supabaseUserId\|supabase_uid\|supabaseUid" drizzle/schema.ts | head -5
```

If the column has a different name in the existing `users` table, edit the `current_chat_user_id()` function in the migration to match. Document the actual name as a comment above the function.

If the existing app maps Supabase JWT to `users.id` via a different mechanism (e.g., a separate `supabase_auth` table or a `metadata` JSONB column), the migration's `current_chat_user_id()` function must be rewritten to match that mapping. Read `server/_core/supabase-auth.ts` if unsure.

- [ ] **Step 3: Commit**

```bash
git add drizzle/0013_chat_foundation.sql
git commit -m "feat(chat): migration 0013 — RLS on chat_messages, chat_bans, realtime.messages"
```

---

## Task 6: Migration 0013 — broadcast-from-DB triggers

**Files:**
- Modify: `drizzle/0013_chat_foundation.sql`

- [ ] **Step 1: Append trigger DDL**

Append to `drizzle/0013_chat_foundation.sql`:

```sql
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
```

- [ ] **Step 2: Commit**

```bash
git add drizzle/0013_chat_foundation.sql
git commit -m "feat(chat): migration 0013 — broadcast-from-DB triggers for messages and bans"
```

---

## Task 7: Apply migration to dev DB and verify

**Files:**
- (DB only)

- [ ] **Step 1: Verify Drizzle generates migration without conflicts**

Run:
```bash
pnpm drizzle-kit generate
```

The existing migration `0013_chat_foundation.sql` is hand-written, so the generated file should match — or Drizzle should report "no changes." If Drizzle emits a new auto-generated file that conflicts, **delete the auto-generated file** and keep the hand-written one. Confirm by reading the schema diff in the auto-generated file matches what we wrote.

- [ ] **Step 2: Apply the migration**

Per the project's single-Supabase topology (`reference_single_supabase_topology.md` in memory — local `.env` Supabase URL points to the same project Vercel uses for prod), this WILL apply to production. Before running, confirm with the user that the migration is safe to apply now.

Once confirmed:

```bash
pnpm drizzle-kit migrate
```

- [ ] **Step 3: Verify all 9 tables exist + the global chat room is seeded**

Run via `psql` or Supabase SQL editor:

```sql
SELECT table_name FROM information_schema.tables
WHERE table_schema = 'public' AND table_name LIKE 'chat_%' OR table_name LIKE 'tournament%' OR table_name = 'user_favorites'
ORDER BY table_name;
-- Expected: chat_audit_log, chat_bans, chat_friends_read_state, chat_messages, chat_room_members,
--           chat_rooms, tournament_members, tournaments, user_favorites

SELECT id, kind, retention_days FROM chat_rooms;
-- Expected: one row, kind='global', retention_days=14
```

- [ ] **Step 4: Verify audit-log immutability**

Run:
```sql
-- Should raise: 'chat_audit_log rows are immutable'
UPDATE chat_audit_log SET reason = 'x' WHERE id IS NOT NULL;
DELETE FROM chat_audit_log WHERE id IS NOT NULL;
```

If either succeeds, the deny-change trigger isn't installed — re-run the migration or apply the trigger DDL manually.

- [ ] **Step 5: Document the verification in the commit message**

No code commit; this task is "applied + verified." Note in the dispatch reply: "Migration 0013 applied to project DB. All 9 tables present. Audit log immutability verified."

---

## Task 8: Server helper — `chatBans.ts` (active ban lookup)

**Files:**
- Create: `server/_core/chatBans.ts`
- Create: `server/_core/chatBans.test.ts`

- [ ] **Step 1: Write failing tests**

Create `server/_core/chatBans.test.ts`:

```ts
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { getDb } from "../db";
import { chatBans, users } from "../../drizzle/schema";
import { eq } from "drizzle-orm";
import { getActiveBan, type BanCheckScope } from "./chatBans";

const DB_URL =
  process.env.SUPABASE_SESSION_POOLER_STRING ??
  process.env.SUPABASE_DIRECT_CONNECTION_STRING ??
  process.env.DATABASE_URL;
const liveDescribe = DB_URL ? describe : describe.skip;

liveDescribe("getActiveBan", () => {
  let testUserId: number;
  let adminId: number;

  beforeAll(async () => {
    const db = await getDb();
    if (!db) throw new Error("DB not available");
    // Seed: create one regular user + one admin.
    const [u] = await db.insert(users).values({
      email: "chatbans-test@example.com",
      role: "user",
    }).returning();
    testUserId = u.id;
    const [a] = await db.insert(users).values({
      email: "chatbans-admin@example.com",
      role: "admin",
    }).returning();
    adminId = a.id;
  });

  afterAll(async () => {
    const db = await getDb();
    if (!db) return;
    await db.delete(users).where(eq(users.id, testUserId));
    await db.delete(users).where(eq(users.id, adminId));
  });

  it("returns null when no bans exist", async () => {
    const result = await getActiveBan(testUserId, { kind: "global" });
    expect(result).toBeNull();
  });

  it("returns the active global ban", async () => {
    const db = await getDb();
    const [ban] = await db!.insert(chatBans).values({
      userId: testUserId,
      scope: "global",
      action: "ban",
      reason: "test",
      createdBy: adminId,
    }).returning();
    try {
      const result = await getActiveBan(testUserId, { kind: "global" });
      expect(result?.id).toBe(ban.id);
      expect(result?.action).toBe("ban");
    } finally {
      await db!.delete(chatBans).where(eq(chatBans.id, ban.id));
    }
  });

  it("ignores expired bans", async () => {
    const db = await getDb();
    const yesterday = new Date(Date.now() - 24 * 60 * 60 * 1000);
    const [ban] = await db!.insert(chatBans).values({
      userId: testUserId,
      scope: "global",
      action: "ban",
      reason: "expired",
      createdBy: adminId,
      expiresAt: yesterday,
    }).returning();
    try {
      const result = await getActiveBan(testUserId, { kind: "global" });
      expect(result).toBeNull();
    } finally {
      await db!.delete(chatBans).where(eq(chatBans.id, ban.id));
    }
  });

  it("ignores revoked bans", async () => {
    const db = await getDb();
    const [ban] = await db!.insert(chatBans).values({
      userId: testUserId,
      scope: "global",
      action: "ban",
      reason: "revoked",
      createdBy: adminId,
      revokedAt: new Date(),
      revokedBy: adminId,
    }).returning();
    try {
      const result = await getActiveBan(testUserId, { kind: "global" });
      expect(result).toBeNull();
    } finally {
      await db!.delete(chatBans).where(eq(chatBans.id, ban.id));
    }
  });

  it("scopes per-room ban to the correct room", async () => {
    const db = await getDb();
    const [ban] = await db!.insert(chatBans).values({
      userId: testUserId,
      scope: "room",
      roomId: 1,        // assumes global room id=1 from seed
      action: "ban",
      reason: "room ban",
      createdBy: adminId,
    }).returning();
    try {
      const inRoom = await getActiveBan(testUserId, { kind: "room", roomId: 1 });
      expect(inRoom?.id).toBe(ban.id);
      const otherRoom = await getActiveBan(testUserId, { kind: "room", roomId: 999 });
      expect(otherRoom).toBeNull();
      const globalCheck = await getActiveBan(testUserId, { kind: "global" });
      expect(globalCheck).toBeNull();
    } finally {
      await db!.delete(chatBans).where(eq(chatBans.id, ban.id));
    }
  });

  it("returns visible mute as a separate flavor", async () => {
    const db = await getDb();
    const [ban] = await db!.insert(chatBans).values({
      userId: testUserId,
      scope: "global",
      action: "mute_visible",
      reason: "muted",
      createdBy: adminId,
    }).returning();
    try {
      const result = await getActiveBan(testUserId, { kind: "global" });
      expect(result?.action).toBe("mute_visible");
    } finally {
      await db!.delete(chatBans).where(eq(chatBans.id, ban.id));
    }
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run:
```bash
pnpm test:server -- chatBans.test
```
Expected: FAIL — `getActiveBan` not exported.

- [ ] **Step 3: Implement `chatBans.ts`**

Create `server/_core/chatBans.ts`:

```ts
// Looks up whether a user has an active ban or mute. Returns the most
// recently created active row, or null. Called by every chat tRPC procedure
// before the actual operation. Defense in depth — same check is also enforced
// by RLS at channel join (see migration 0013).
import { sql, and, eq, or, isNull, gt } from "drizzle-orm";
import { getDb } from "../db";
import { chatBans, type ChatBan } from "../../drizzle/schema";

export type BanCheckScope =
  | { kind: "global" }
  | { kind: "room"; roomId: number };

/**
 * Returns the most recent active ban OR mute for the user, considering the
 * requested scope. A global ban matches any scope query. A per-room ban only
 * matches when the scope is `room` and the roomId matches.
 *
 * "Active" = revoked_at IS NULL AND (expires_at IS NULL OR expires_at > NOW()).
 */
export async function getActiveBan(
  userId: number,
  scope: BanCheckScope,
): Promise<ChatBan | null> {
  const db = await getDb();
  if (!db) throw new Error("DB unavailable");

  const scopeCondition =
    scope.kind === "global"
      ? eq(chatBans.scope, "global")
      : or(
          eq(chatBans.scope, "global"),
          and(eq(chatBans.scope, "room"), eq(chatBans.roomId, scope.roomId)),
        );

  const rows = await db
    .select()
    .from(chatBans)
    .where(
      and(
        eq(chatBans.userId, userId),
        isNull(chatBans.revokedAt),
        or(isNull(chatBans.expiresAt), gt(chatBans.expiresAt, sql`NOW()`)),
        scopeCondition,
      ),
    )
    .orderBy(sql`${chatBans.createdAt} DESC`)
    .limit(1);

  return rows[0] ?? null;
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run:
```bash
pnpm test:server -- chatBans.test
```
Expected: PASS for all 6 cases (or SKIP if no DB_URL). If skipped locally, run on CI where DB_URL is set.

- [ ] **Step 5: Run typecheck**

Run:
```bash
pnpm check
```
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add server/_core/chatBans.ts server/_core/chatBans.test.ts
git commit -m "feat(chat): server helper — active-ban lookup with scope handling"
```

---

## Task 9: Server helper — `chatRateLimit.ts` (Upstash wrapper)

**Files:**
- Create: `server/_core/chatRateLimit.ts`
- Create: `server/_core/chatRateLimit.test.ts`

- [ ] **Step 1: Write failing tests**

Create `server/_core/chatRateLimit.test.ts`:

```ts
import { describe, it, expect, vi, beforeEach } from "vitest";
import { TRPCError } from "@trpc/server";

// Mock Upstash BEFORE importing the module under test
vi.mock("@upstash/redis", () => ({
  Redis: { fromEnv: vi.fn(() => ({ /* stub */ })) },
}));

const limitMock = vi.fn();
vi.mock("@upstash/ratelimit", () => ({
  Ratelimit: vi.fn().mockImplementation(() => ({ limit: limitMock })),
  // Re-export tokenBucket as a passthrough constant so the module under test
  // can still call Ratelimit.tokenBucket(...)
}));

import { enforceChatRateLimit, __resetForTest } from "./chatRateLimit";

beforeEach(() => {
  limitMock.mockReset();
  __resetForTest();
});

describe("enforceChatRateLimit", () => {
  it("is a no-op when UPSTASH env vars are unset", async () => {
    const prev = process.env.UPSTASH_REDIS_REST_URL;
    delete process.env.UPSTASH_REDIS_REST_URL;
    try {
      await expect(enforceChatRateLimit("user-123")).resolves.toBeUndefined();
      expect(limitMock).not.toHaveBeenCalled();
    } finally {
      if (prev) process.env.UPSTASH_REDIS_REST_URL = prev;
    }
  });

  it("calls the limiter with the userId as key when env is set", async () => {
    process.env.UPSTASH_REDIS_REST_URL = "https://example.upstash.io";
    process.env.UPSTASH_REDIS_REST_TOKEN = "dummy";
    limitMock.mockResolvedValueOnce({ success: true, reset: 0 });
    await enforceChatRateLimit("user-42");
    expect(limitMock).toHaveBeenCalledWith("user-42");
  });

  it("throws TOO_MANY_REQUESTS when limit exceeded", async () => {
    process.env.UPSTASH_REDIS_REST_URL = "https://example.upstash.io";
    process.env.UPSTASH_REDIS_REST_TOKEN = "dummy";
    limitMock.mockResolvedValueOnce({
      success: false,
      reset: Math.floor(Date.now() / 1000) + 4,
    });
    await expect(enforceChatRateLimit("user-99")).rejects.toThrowError(TRPCError);
  });
});
```

- [ ] **Step 2: Run tests, watch them fail**

Run:
```bash
pnpm test:server -- chatRateLimit.test
```
Expected: FAIL — module not found.

- [ ] **Step 3: Implement `chatRateLimit.ts`**

Create `server/_core/chatRateLimit.ts`:

```ts
// Per-user chat post rate limiter. Backed by Upstash Redis when env is
// configured; no-op otherwise (lets dev run without a Redis dependency).
// In prod, this should be promoted to Vercel Edge Middleware in Phase 2 so
// rate-limit denials don't even hit a Lambda invocation. For Phase 1 the
// wrapper exists and is unit-tested; the call site lands in Phase 2.
import { TRPCError } from "@trpc/server";
import { Ratelimit } from "@upstash/ratelimit";
import { Redis } from "@upstash/redis";

let _limiter: Ratelimit | null = null;
let _initialized = false;

function getLimiter(): Ratelimit | null {
  if (_initialized) return _limiter;
  _initialized = true;

  if (!process.env.UPSTASH_REDIS_REST_URL || !process.env.UPSTASH_REDIS_REST_TOKEN) {
    return null;
  }

  _limiter = new Ratelimit({
    redis: Redis.fromEnv(),
    limiter: Ratelimit.tokenBucket(5, "10 s", 10),
    prefix: "chat:post",
    analytics: false,
  });
  return _limiter;
}

export async function enforceChatRateLimit(userKey: string): Promise<void> {
  const limiter = getLimiter();
  if (!limiter) return; // no-op when not configured

  const { success, reset } = await limiter.limit(userKey);
  if (!success) {
    const retryAfter = Math.max(1, Math.ceil(reset - Date.now() / 1000));
    throw new TRPCError({
      code: "TOO_MANY_REQUESTS",
      message: `Slow down — try again in ${retryAfter}s.`,
    });
  }
}

// Test-only — resets cached limiter so env-var swaps in tests take effect.
export function __resetForTest(): void {
  _limiter = null;
  _initialized = false;
}
```

- [ ] **Step 4: Run tests, watch them pass**

Run:
```bash
pnpm test:server -- chatRateLimit.test
```
Expected: PASS for all 3 cases.

- [ ] **Step 5: Run typecheck**

Run:
```bash
pnpm check
```
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add server/_core/chatRateLimit.ts server/_core/chatRateLimit.test.ts
git commit -m "feat(chat): server helper — Upstash-backed rate limit wrapper (env-gated)"
```

---

## Task 10: Server helper — `chatAudit.ts` (recordChatAction)

**Files:**
- Create: `server/_core/chatAudit.ts`
- Create: `server/_core/chatAudit.test.ts`

- [ ] **Step 1: Write failing tests**

Create `server/_core/chatAudit.test.ts`:

```ts
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { getDb } from "../db";
import { chatAuditLog, users } from "../../drizzle/schema";
import { eq, sql } from "drizzle-orm";
import { recordChatAction } from "./chatAudit";

const DB_URL =
  process.env.SUPABASE_SESSION_POOLER_STRING ??
  process.env.SUPABASE_DIRECT_CONNECTION_STRING ??
  process.env.DATABASE_URL;
const liveDescribe = DB_URL ? describe : describe.skip;

liveDescribe("recordChatAction", () => {
  let adminId: number;
  let targetId: number;

  beforeAll(async () => {
    const db = await getDb();
    const [a] = await db!.insert(users).values({
      email: "audit-admin@example.com",
      role: "admin",
    }).returning();
    adminId = a.id;
    const [t] = await db!.insert(users).values({
      email: "audit-target@example.com",
      role: "user",
    }).returning();
    targetId = t.id;
  });

  afterAll(async () => {
    const db = await getDb();
    await db!.delete(chatAuditLog).where(eq(chatAuditLog.actorId, adminId));
    await db!.delete(users).where(eq(users.id, adminId));
    await db!.delete(users).where(eq(users.id, targetId));
  });

  it("writes a row with all required fields", async () => {
    const db = await getDb();
    await db!.transaction(async (tx) => {
      await recordChatAction({
        tx,
        actorId: adminId,
        actorRole: "admin",
        action: "ban",
        targetUserId: targetId,
        scope: "global",
        reason: "test ban",
        metadata: { test: true },
        ip: "127.0.0.1",
        userAgent: "vitest",
      });
    });

    const rows = await db!
      .select()
      .from(chatAuditLog)
      .where(eq(chatAuditLog.actorId, adminId));

    expect(rows.length).toBe(1);
    expect(rows[0].action).toBe("ban");
    expect(rows[0].targetUserId).toBe(targetId);
    expect(rows[0].reason).toBe("test ban");
    expect(rows[0].metadata).toEqual({ test: true });
  });

  it("UPDATE on chat_audit_log is rejected at the DB level (immutability)", async () => {
    const db = await getDb();
    await expect(
      db!.execute(sql`UPDATE chat_audit_log SET reason = 'tampered' WHERE actor_id = ${adminId}`),
    ).rejects.toThrow(/immutable|append-only/i);
  });

  it("DELETE on chat_audit_log is rejected at the DB level", async () => {
    const db = await getDb();
    await expect(
      db!.execute(sql`DELETE FROM chat_audit_log WHERE actor_id = ${adminId}`),
    ).rejects.toThrow(/immutable|append-only/i);
  });
});
```

- [ ] **Step 2: Run tests, watch them fail**

Run:
```bash
pnpm test:server -- chatAudit.test
```
Expected: FAIL — `recordChatAction` not exported.

- [ ] **Step 3: Implement `chatAudit.ts`**

Create `server/_core/chatAudit.ts`:

```ts
// Records a chat moderation / admin action in the immutable chat_audit_log.
// Always called inside the same transaction as the state change, so the
// audit row + state change succeed or fail atomically.
import { chatAuditLog } from "../../drizzle/schema";

export type ChatAuditAction =
  | "message_delete"
  | "message_edit"
  | "ban"
  | "unban"
  | "mute_visible"
  | "mute_shadow"
  | "unmute"
  | "tournament_create"
  | "tournament_update"
  | "tournament_cancel"
  | "tournament_add_member"
  | "tournament_remove_member"
  | "tournament_join_paid"
  | "favorite_added"
  | "favorite_removed";

interface RecordParams {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  tx: any;  // Drizzle transaction handle
  actorId: number;
  actorRole: string;
  action: ChatAuditAction;
  targetUserId?: number;
  targetMessageId?: number;
  targetTournamentId?: number;
  scope?: string;
  roomId?: number;
  reason?: string;
  metadata?: Record<string, unknown>;
  ip?: string;
  userAgent?: string;
}

export async function recordChatAction(p: RecordParams): Promise<void> {
  await p.tx.insert(chatAuditLog).values({
    actorId: p.actorId,
    actorRole: p.actorRole,
    action: p.action,
    targetUserId: p.targetUserId ?? null,
    targetMessageId: p.targetMessageId ?? null,
    targetTournamentId: p.targetTournamentId ?? null,
    scope: p.scope ?? null,
    roomId: p.roomId ?? null,
    reason: p.reason ?? null,
    metadata: p.metadata ?? null,
    ip: p.ip ?? null,
    userAgent: p.userAgent ?? null,
  });
}
```

- [ ] **Step 4: Run tests, watch them pass**

Run:
```bash
pnpm test:server -- chatAudit.test
```
Expected: PASS — 3 of 3 cases.

- [ ] **Step 5: Run typecheck**

Run:
```bash
pnpm check
```
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add server/_core/chatAudit.ts server/_core/chatAudit.test.ts
git commit -m "feat(chat): server helper — recordChatAction + audit immutability tests"
```

---

## Task 11: tRPC router skeleton — `chatRouter` with ban-check middleware

**Files:**
- Create: `server/routers/chat.ts`
- Create: `server/routers/chat.test.ts`
- Modify: `server/app-router.ts`

- [ ] **Step 1: Write failing tests**

Create `server/routers/chat.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { appRouter } from "../app-router";
import { chatRouter } from "./chat";

describe("chatRouter", () => {
  it("is registered on appRouter under the 'chat' namespace", () => {
    // appRouter is the t.router output; structural type — check presence by
    // existence of a known procedure once Phase 2 adds them. For Phase 1
    // we just confirm the namespace exists.
    expect(appRouter._def.record).toHaveProperty("chat");
  });

  it("exports an empty router (no procedures yet — Phase 2 adds endpoints)", () => {
    expect(Object.keys(chatRouter._def.record)).toEqual([]);
  });
});
```

- [ ] **Step 2: Run tests, watch them fail**

Run:
```bash
pnpm test:server -- chat.test
```
Expected: FAIL — `./chat` module not found.

- [ ] **Step 3: Implement `chat.ts`**

Create `server/routers/chat.ts`:

```ts
// Chat tRPC router. Phase 1 lands the skeleton + the shared ban-check
// middleware so the ban-enforcement contract is testable. Endpoints
// (fetch / post / markRead / unreadCounts) arrive in Phase 2 along with
// the Global chat UI.
import { TRPCError } from "@trpc/server";
import { router, protectedProcedure } from "../_core/trpc";
import { getActiveBan } from "../_core/chatBans";

/**
 * Adds "user is not globally banned from chat" as a precondition to any
 * procedure that composes it. Per-room ban enforcement is layered on top
 * inside individual procedures (since the room id is procedure-specific).
 */
export const requireNotGloballyChatBanned = protectedProcedure.use(async (opts) => {
  const ban = await getActiveBan(opts.ctx.user.id, { kind: "global" });
  if (ban && ban.action === "ban") {
    throw new TRPCError({
      code: "FORBIDDEN",
      message: "You are banned from chat.",
    });
  }
  return opts.next();
});

export const chatRouter = router({
  // Phase 2: fetchInitial, fetchOlder, fetchSince, postMessage, markRead, unreadCounts
});
```

- [ ] **Step 4: Register in `server/app-router.ts`**

Edit `server/app-router.ts`:

1. Add import near the other router imports:
   ```ts
   import { chatRouter } from "./routers/chat";
   ```
2. Inside the `router({ ... })` call (where `system`, `auth`, `game`, etc. are listed), add:
   ```ts
   chat: chatRouter,
   ```
   Place the entry alphabetically near `avatars`, `banners`, etc.

- [ ] **Step 5: Run tests, watch them pass**

Run:
```bash
pnpm test:server -- chat.test
```
Expected: PASS — both cases.

- [ ] **Step 6: Run typecheck**

Run:
```bash
pnpm check
```
Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add server/routers/chat.ts server/routers/chat.test.ts server/app-router.ts
git commit -m "feat(chat): tRPC chatRouter skeleton + global-ban precondition middleware"
```

---

## Task 12: Vercel Cron handler — retention sweep

**Files:**
- Create: `api/cron/chat-retention-sweep.ts`
- Modify: `vercel.json`

- [ ] **Step 1: Create the cron handler**

Create `api/cron/chat-retention-sweep.ts`:

```ts
// Nightly retention sweep. Hard-deletes chat_messages that are past their
// room's retention window. Tournament rooms get an extended grace period
// of `tournaments.ends_at + 30 days` for completed/cancelled status only;
// active tournaments retain their messages indefinitely.
//
// Triggered by Vercel Cron — see vercel.json.
// Auth: the CRON_SECRET env var must match the Authorization header.
import type { VercelRequest, VercelResponse } from "@vercel/node";
import { getDb } from "../../server/db";
import { sql } from "drizzle-orm";

export default async function handler(req: VercelRequest, res: VercelResponse): Promise<void> {
  // Vercel Cron sends the secret in `Authorization: Bearer <CRON_SECRET>`.
  const expected = process.env.CRON_SECRET;
  const provided = req.headers.authorization?.replace(/^Bearer\s+/i, "");
  if (!expected || provided !== expected) {
    res.status(401).json({ ok: false, error: "unauthorized" });
    return;
  }

  const db = await getDb();
  if (!db) {
    res.status(500).json({ ok: false, error: "db unavailable" });
    return;
  }

  // Global + Friends — uniform 14-day window.
  const globalFriendsDeleted = await db.execute(sql`
    DELETE FROM chat_messages
    WHERE scope IN ('global', 'friends')
      AND "createdAt" < NOW() - INTERVAL '14 days'
      AND deleted_at IS NULL
    RETURNING id
  `);

  // Tournament rooms — purge only completed/cancelled tournaments past their
  // 30-day grace period. Active tournaments retain messages indefinitely.
  const tournamentDeleted = await db.execute(sql`
    DELETE FROM chat_messages
    WHERE scope = 'tournament'
      AND room_id IN (
        SELECT chat_room_id FROM tournaments
        WHERE status IN ('completed', 'cancelled')
          AND ends_at + INTERVAL '30 days' < NOW()
      )
    RETURNING id
  `);

  const counts = {
    globalFriends: Array.isArray(globalFriendsDeleted)
      ? globalFriendsDeleted.length
      : (globalFriendsDeleted as { rowCount?: number }).rowCount ?? 0,
    tournament: Array.isArray(tournamentDeleted)
      ? tournamentDeleted.length
      : (tournamentDeleted as { rowCount?: number }).rowCount ?? 0,
  };

  res.status(200).json({ ok: true, deleted: counts });
}

export const config = { maxDuration: 60 };
```

- [ ] **Step 2: Register the cron in `vercel.json`**

Edit `vercel.json` — add a top-level `crons` array (or extend the existing one):

```json
{
  "$schema": "https://openapi.vercel.sh/vercel.json",
  "buildCommand": "...",
  "...": "...",
  "crons": [
    {
      "path": "/api/cron/chat-retention-sweep",
      "schedule": "0 3 * * *"
    }
  ]
}
```

Schedule `0 3 * * *` = 3:00 AM UTC daily. Confirm the existing `vercel.json` doesn't already have a `crons` field; if it does, merge into it. Preserve all existing top-level keys exactly as-is.

- [ ] **Step 3: Document the CRON_SECRET env var**

Add a line to the project's env-var documentation (if a `.env.example` or `README` env-var section exists) noting the new requirement:

```
CRON_SECRET=<random-32-byte-hex>   # required by Vercel Cron handlers under /api/cron/
```

If the project doesn't have an `.env.example`, skip this step — just note in the dispatch reply that the user must add `CRON_SECRET` to Vercel project env vars before the cron will actually run.

- [ ] **Step 4: Commit**

```bash
git add api/cron/chat-retention-sweep.ts vercel.json
git commit -m "feat(chat): nightly cron — retention sweep for global/friends/tournament messages"
```

---

## Task 13: Vercel Cron handler — purge soft-deleted (GDPR)

**Files:**
- Create: `api/cron/chat-purge-soft-deleted.ts`
- Modify: `vercel.json`

- [ ] **Step 1: Create the cron handler**

Create `api/cron/chat-purge-soft-deleted.ts`:

```ts
// Nightly GDPR-safe purge. For messages soft-deleted more than 30 days ago,
// hard-clear the `body` text and mark the deleted_reason. The id, author_id,
// and createdAt are retained so any cross-references (audit log, future
// thread features) don't break.
//
// Triggered by Vercel Cron — see vercel.json.
import type { VercelRequest, VercelResponse } from "@vercel/node";
import { getDb } from "../../server/db";
import { sql } from "drizzle-orm";

export default async function handler(req: VercelRequest, res: VercelResponse): Promise<void> {
  const expected = process.env.CRON_SECRET;
  const provided = req.headers.authorization?.replace(/^Bearer\s+/i, "");
  if (!expected || provided !== expected) {
    res.status(401).json({ ok: false, error: "unauthorized" });
    return;
  }

  const db = await getDb();
  if (!db) {
    res.status(500).json({ ok: false, error: "db unavailable" });
    return;
  }

  const result = await db.execute(sql`
    UPDATE chat_messages
    SET body = '[purged]',
        deleted_reason = COALESCE(deleted_reason, '') || ' [body purged at retention]'
    WHERE deleted_at IS NOT NULL
      AND deleted_at < NOW() - INTERVAL '30 days'
      AND body != '[purged]'
    RETURNING id
  `);

  const count = Array.isArray(result)
    ? result.length
    : (result as { rowCount?: number }).rowCount ?? 0;

  res.status(200).json({ ok: true, purged: count });
}

export const config = { maxDuration: 60 };
```

- [ ] **Step 2: Add to `vercel.json` crons array**

Extend the `crons` array:

```json
{
  "crons": [
    { "path": "/api/cron/chat-retention-sweep", "schedule": "0 3 * * *" },
    { "path": "/api/cron/chat-purge-soft-deleted", "schedule": "30 3 * * *" }
  ]
}
```

Schedule `30 3 * * *` = 3:30 AM UTC daily (offset 30 min after the sweep so they don't contend on the same connection).

- [ ] **Step 3: Commit**

```bash
git add api/cron/chat-purge-soft-deleted.ts vercel.json
git commit -m "feat(chat): nightly cron — GDPR-safe purge of soft-deleted message bodies"
```

---

## Task 14: Client — Supabase Realtime auth wiring

**Files:**
- Create: `client/src/lib/supabase/realtimeClient.ts`
- Modify: `client/src/App.tsx`

- [ ] **Step 1: Create the realtime auth hook**

Create `client/src/lib/supabase/realtimeClient.ts`:

```ts
// Wires the Supabase access token into the Realtime websocket every time
// auth refreshes. Without this hook the WS keeps the original token and
// silently stops delivering once it expires (supabase discussion #37002).
//
// Mount this hook once at the React root — see client/src/App.tsx.
import { useEffect } from "react";
import { supabase } from "../supabase";

export function useRealtimeAuth(): void {
  useEffect(() => {
    // Sync the current session immediately on mount.
    supabase.auth.getSession().then(({ data }) => {
      if (data.session?.access_token) {
        supabase.realtime.setAuth(data.session.access_token);
      }
    });

    // Re-sync on every auth event (TOKEN_REFRESHED is the critical one;
    // SIGNED_IN and SIGNED_OUT bracket the session lifecycle).
    const { data: sub } = supabase.auth.onAuthStateChange((event, session) => {
      if (event === "TOKEN_REFRESHED" || event === "SIGNED_IN") {
        if (session?.access_token) {
          supabase.realtime.setAuth(session.access_token);
        }
      } else if (event === "SIGNED_OUT") {
        // Clear so the WS doesn't keep a stale token after logout.
        supabase.realtime.setAuth(null as unknown as string);
      }
    });

    return () => {
      sub.subscription.unsubscribe();
    };
  }, []);
}
```

- [ ] **Step 2: Mount the hook in `App.tsx`**

Edit `client/src/App.tsx`. Near the top of the root component, after other top-level hooks (e.g., `useAuth()` or theme setup), add:

```tsx
import { useRealtimeAuth } from "./lib/supabase/realtimeClient";

// Inside the App function component:
useRealtimeAuth();
```

If the App component is wrapped in providers (QueryClientProvider, AuthProvider, etc.), the hook MUST be called inside a component that is descended from the auth provider — otherwise `supabase.auth.getSession()` works but the event subscription will fire before the rest of the app has the session. Verify by grepping for where `useAuth()` is called — `useRealtimeAuth()` belongs at the same nesting level.

- [ ] **Step 3: Run client tests + typecheck**

Run:
```bash
pnpm test:client
pnpm check
```
Expected: PASS for both. No existing test exercises this hook; we'll add an integration test in Phase 2 once channels are actually subscribed.

- [ ] **Step 4: Commit**

```bash
git add client/src/lib/supabase/realtimeClient.ts client/src/App.tsx
git commit -m "feat(chat): client — wire JWT refresh into Supabase Realtime WS"
```

---

## Task 15: Client — Capacitor keyboard height + safe-area CSS scaffolding

**Files:**
- Create: `client/src/lib/capacitor/useKeyboardHeight.ts`
- Create: `client/src/lib/capacitor/keyboardHeight.test.ts`
- Modify: `client/src/App.tsx`
- Modify: `client/index.html`
- Modify: `client/src/index.css`
- Modify: `capacitor.config.ts`

- [ ] **Step 1: Update `capacitor.config.ts`**

Edit `capacitor.config.ts`. Change the existing `Keyboard` plugin config:

```ts
plugins: {
  // ... other plugins unchanged
  Keyboard: {
    resize: "native",         // research recommendation: WebView shrinks natively
    resizeOnFullScreen: true, // already true; keep it
  },
}
```

(Was: `resize: "body"`.) Then run:
```bash
npx cap sync
```
…to propagate the change to the iOS / Android projects. If `cap sync` reports errors about missing platforms, skip that step — it'll be re-run when the mobile builds happen.

- [ ] **Step 2: Add `viewport-fit=cover` to `client/index.html`**

Edit the existing viewport meta tag:
```html
<meta name="viewport" content="width=device-width, initial-scale=1.0, maximum-scale=1, viewport-fit=cover" />
```
(Add `, viewport-fit=cover` to the existing `content` attribute.)

- [ ] **Step 3: Add CSS scaffolding to `client/src/index.css`**

Append to `client/src/index.css`:

```css
:root {
  /* Updated by useKeyboardHeight on @capacitor/keyboard events. */
  --kb-height: 0px;
}

/* Utility for any input bar that should clear the on-screen keyboard
   AND the home indicator / gesture bar. */
.chat-safe-area-bottom {
  padding-bottom: calc(env(safe-area-inset-bottom, 0px) + var(--kb-height, 0px));
}

/* Chat container utility — use 100dvh so the viewport accounts for the
   keyboard. Capacitor's `resize: 'native'` already shrinks the WebView,
   but combining 100dvh with the inset utility makes the layout robust
   on Android 15+ where edge-to-edge has known issues. */
.chat-viewport-height {
  height: 100dvh;
}
```

- [ ] **Step 4: Write failing tests for the hook**

Create `client/src/lib/capacitor/keyboardHeight.test.ts`:

```ts
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { renderHook } from "@testing-library/react";

const willShowListeners: Array<(info: { keyboardHeight: number }) => void> = [];
const didHideListeners: Array<() => void> = [];

vi.mock("@capacitor/keyboard", () => ({
  Keyboard: {
    addListener: vi.fn((event: string, cb: (info: { keyboardHeight: number }) => void) => {
      if (event === "keyboardWillShow") willShowListeners.push(cb);
      if (event === "keyboardDidHide") didHideListeners.push(cb as () => void);
      return Promise.resolve({ remove: vi.fn() });
    }),
    removeAllListeners: vi.fn(() => Promise.resolve()),
  },
}));

import { useKeyboardHeight } from "./useKeyboardHeight";

beforeEach(() => {
  willShowListeners.length = 0;
  didHideListeners.length = 0;
  document.documentElement.style.removeProperty("--kb-height");
});

afterEach(() => {
  document.documentElement.style.removeProperty("--kb-height");
});

describe("useKeyboardHeight", () => {
  it("sets --kb-height on keyboardWillShow", () => {
    renderHook(() => useKeyboardHeight());
    expect(willShowListeners).toHaveLength(1);
    willShowListeners[0]({ keyboardHeight: 320 });
    expect(document.documentElement.style.getPropertyValue("--kb-height")).toBe("320px");
  });

  it("resets --kb-height to 0 on keyboardDidHide", () => {
    renderHook(() => useKeyboardHeight());
    willShowListeners[0]({ keyboardHeight: 320 });
    didHideListeners[0]();
    expect(document.documentElement.style.getPropertyValue("--kb-height")).toBe("0px");
  });
});
```

- [ ] **Step 5: Run tests, watch them fail**

Run:
```bash
pnpm test:client -- keyboardHeight
```
Expected: FAIL — `./useKeyboardHeight` not found.

- [ ] **Step 6: Implement the hook**

Create `client/src/lib/capacitor/useKeyboardHeight.ts`:

```ts
// Listens to @capacitor/keyboard events and reflects the on-screen
// keyboard height into a CSS variable (--kb-height) on the document root.
//
// Why a CSS var rather than a context: layout-critical, hot-path
// computation. A CSS-var update doesn't re-render any React tree, and
// any element using calc(env(...) + var(--kb-height)) updates atomically
// without prop drilling.
//
// Mount once at the App root. Safe to call on web — Capacitor Keyboard
// is a no-op outside the native shell.
import { useEffect } from "react";
import { Keyboard } from "@capacitor/keyboard";

export function useKeyboardHeight(): void {
  useEffect(() => {
    const willShowSub = Keyboard.addListener("keyboardWillShow", (info) => {
      document.documentElement.style.setProperty("--kb-height", `${info.keyboardHeight}px`);
    });
    const didHideSub = Keyboard.addListener("keyboardDidHide", () => {
      document.documentElement.style.setProperty("--kb-height", "0px");
    });

    return () => {
      void willShowSub.then((sub) => sub.remove());
      void didHideSub.then((sub) => sub.remove());
    };
  }, []);
}
```

- [ ] **Step 7: Run tests, watch them pass**

Run:
```bash
pnpm test:client -- keyboardHeight
```
Expected: PASS — both cases.

- [ ] **Step 8: Mount the hook in `App.tsx`**

Edit `client/src/App.tsx`. Next to the `useRealtimeAuth()` call from Task 14, add:

```tsx
import { useKeyboardHeight } from "./lib/capacitor/useKeyboardHeight";

// Inside the App component:
useKeyboardHeight();
```

- [ ] **Step 9: Run typecheck + full client test suite**

Run:
```bash
pnpm check
pnpm test:client
```
Expected: PASS.

- [ ] **Step 10: Commit**

```bash
git add capacitor.config.ts client/index.html client/src/index.css \
        client/src/lib/capacitor/useKeyboardHeight.ts \
        client/src/lib/capacitor/keyboardHeight.test.ts \
        client/src/App.tsx
git commit -m "feat(chat): capacitor keyboard height CSS var + safe-area scaffolding"
```

---

## Task 16: End-to-end realtime-path smoke test

**Files:**
- Create: `server/_core/chatRealtime.test.ts`

- [ ] **Step 1: Write the smoke test**

Create `server/_core/chatRealtime.test.ts`:

```ts
// Smoke test for the broadcast-from-DB trigger pipeline. Verifies that
// inserting a row into chat_messages causes the trigger to run without
// erroring and the row lands. Doesn't verify the broadcast actually
// reaches a websocket client — that's Phase 2's job once a real channel
// subscription exists.
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { getDb } from "../db";
import { chatMessages, chatRooms, users } from "../../drizzle/schema";
import { eq, sql } from "drizzle-orm";

const DB_URL =
  process.env.SUPABASE_SESSION_POOLER_STRING ??
  process.env.SUPABASE_DIRECT_CONNECTION_STRING ??
  process.env.DATABASE_URL;
const liveDescribe = DB_URL ? describe : describe.skip;

liveDescribe("chat realtime trigger pipeline", () => {
  let testUserId: number;
  let globalRoomId: number;

  beforeAll(async () => {
    const db = await getDb();
    const [u] = await db!.insert(users).values({
      email: "realtime-smoke@example.com",
      role: "user",
    }).returning();
    testUserId = u.id;

    const [room] = await db!
      .select()
      .from(chatRooms)
      .where(eq(chatRooms.kind, "global"))
      .limit(1);
    if (!room) throw new Error("Global chat_rooms row missing — migration 0013 not seeded.");
    globalRoomId = room.id;
  });

  afterAll(async () => {
    const db = await getDb();
    await db!.delete(chatMessages).where(eq(chatMessages.authorId, testUserId));
    await db!.delete(users).where(eq(users.id, testUserId));
  });

  it("INSERT into chat_messages succeeds without trigger error", async () => {
    const db = await getDb();
    const [msg] = await db!
      .insert(chatMessages)
      .values({
        scope: "global",
        roomId: globalRoomId,
        authorId: testUserId,
        body: "smoke test message",
      })
      .returning();

    expect(msg).toBeDefined();
    expect(msg.id).toBeGreaterThan(0);
    expect(msg.scope).toBe("global");
  });

  it("UPDATE that doesn't change tracked columns does not error", async () => {
    const db = await getDb();
    // The update-trigger checks specific columns; a no-op-ish update
    // should still RETURN NEW without crashing.
    await db!.execute(sql`UPDATE chat_messages SET "createdAt" = "createdAt" WHERE author_id = ${testUserId}`);
  });

  it("UPDATE that soft-deletes broadcasts (no client check; trigger must not raise)", async () => {
    const db = await getDb();
    await db!
      .update(chatMessages)
      .set({ deletedAt: new Date(), deletedReason: "smoke" })
      .where(eq(chatMessages.authorId, testUserId));
  });
});
```

- [ ] **Step 2: Run the smoke test**

Run:
```bash
pnpm test:server -- chatRealtime
```
Expected: PASS — 3 of 3 cases. If the test reports `realtime.broadcast_changes` doesn't exist, the Supabase project Realtime extension is too old; upgrade via the Supabase dashboard (Database → Extensions → realtime). Document the version requirement in the dispatch reply.

- [ ] **Step 3: Run the full server suite to catch regressions**

Run:
```bash
pnpm test:server
```
Expected: PASS for everything new and unchanged. No regressions in `liveRoom.test`, `schema-column-names.test`, etc.

- [ ] **Step 4: Commit**

```bash
git add server/_core/chatRealtime.test.ts
git commit -m "test(chat): end-to-end smoke test for broadcast-from-DB trigger pipeline"
```

---

## Phase 1 done. Phase 2 preview

Phase 1 ships **no user-facing changes**. To verify it landed:

- All 9 tables exist (`SELECT * FROM information_schema.tables WHERE table_name LIKE 'chat_%' OR ...`).
- RLS policies are active (`SELECT * FROM pg_policies WHERE tablename LIKE 'chat_%'`).
- The two cron handlers respond to `curl -H "Authorization: Bearer $CRON_SECRET" https://<your-vercel-url>/api/cron/chat-retention-sweep` with `{ ok: true, ... }`.
- `useRealtimeAuth` and `useKeyboardHeight` are mounted at the root and don't error.

Phase 2 will:
- Add `chat.fetchInitial`, `fetchOlder`, `fetchSince`, `postMessage`, `markRead`, `unreadCounts` endpoints to `chatRouter`.
- Install `obscenity` for Tier 1 profanity filtering.
- Activate Upstash rate limiting via Vercel Edge Middleware now that an actual write endpoint exists.
- Build the chat surface — slide-over (desktop) + `/chat` page (mobile) with Global tab only.
- Add the per-message admin "•••" menu (delete / global-ban).
- Add unread badge to `PersistentHeader`.

That's the next plan; it'll be written when this one is verified done.
