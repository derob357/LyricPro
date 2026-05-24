# Multi-Room Chat with Favorites, Tournaments, and Admin Moderation — Design

**Date**: 2026-05-24
**Status**: Drafted, awaiting review
**Goal**: Add a multi-room chat surface to LyricPro with three tabs — **Global**, **Friends** (asymmetric feed driven by favoriting players from the leaderboard), and **Tournament** (multiple named, GN-paid or admin-invited rosters) — plus an admin moderation system that can delete/edit any message, ban or mute (visible or shadow) any player at global or per-room scope, manage tournament rosters, and edit anyone's favorites list.

Built additively on the existing stack (tRPC + Drizzle + Postgres + Supabase + React/Capacitor); no existing tables are modified. Real-time delivery uses **Supabase Realtime Broadcast-from-Database** (DB triggers fan out per-room broadcasts) rather than `postgres_changes`, per current Supabase guidance for chat workloads.

---

## 1. Goals & non-goals

### In scope

1. Three chat tabs — Global, Friends, Tournament — with a single shared `<ChatTabs>` component rendered as a slide-over on desktop (≥768px) and a dedicated `/chat` page on mobile (<768px / Capacitor).
2. Asymmetric favorite/unfavorite from the leaderboard; cap of 100 favorites per user; powers the Friends feed.
3. Friends feed semantics — A's tab shows messages from A + everyone A favorited; A's posts are delivered to A's own feed plus the feeds of every user who favorited A. No reciprocity required.
4. Multiple named tournaments with `starts_at` / `ends_at`, GN entry cost, optional capacity, optional link to existing `prize_pools`. Admin can also comp-invite users.
5. GN entry flow — atomic transaction spends Golden Notes via the existing `spend_tournament` ledger reason, inserts roster row, opens chat-room membership.
6. Admin moderation — delete or edit any message; ban (global or per-room, temp or permanent); mute (visible default, shadow-ban as explicit escalation); manage any user's favorites; manage tournament rosters; view immutable audit log.
7. Sliding 14-day retention per Global / Friends room; tournament rooms extend through `ends_at + 30 days`.
8. Defense-in-depth ban enforcement — RLS on `realtime.messages` at channel join, plus explicit ban check at every `chat.postMessage` / `chat.fetch*` tRPC call.
9. Rate limiting via Upstash Redis token bucket in Vercel Edge Middleware (5 tokens / 10s, max 10) — per-user.
10. Tier 1 profanity filter (`obscenity` npm package); Tier 2 Claude Haiku 4.5 escalation gated behind an env flag.
11. Server-tracked `last_read_seq` per (user, room) and per-user for Friends feed → unread badges on each tab and aggregate badge on the `PersistentHeader` chat icon.
12. Mobile keyboard avoidance via `@capacitor/keyboard`, `100dvh` viewport, safe-area insets, `use-stick-to-bottom` for auto-scroll behaviour.
13. Immutable `chat_audit_log` for every admin action; required reason field; captures `ip` and `user_agent`.
14. Nightly Vercel Cron job — retention sweep + GDPR-safe purge of soft-deleted messages older than 30 days.

### Out of scope (explicit non-goals)

- **System push notifications** when the app is backgrounded — separate, larger effort; in-app foreground toasts only for v1.
- **User-level block list** (user blocks user) — admin bans cover the worst case.
- **Stripe cash checkout** for tournament entry — GN-only for v1.
- **Moderator role tier** between `user` and `admin` — all admins are equal; add later if delegated moderation becomes a need.
- **Full-text search across chat history** — defer.
- **Reactions, threads, typing indicators, read receipts** — defer.
- **File / image / voice attachments** — defer.
- **Guest chat participation** — chat is sign-in-only. Guests can play games and appear on the leaderboard, but cannot read or post chat, and cannot be favorited (no stable identity).
- **Multi-tenant rooms** beyond Global + Tournament — no DMs, no private channels.
- **IP-based bans** — research showed they miss CGNAT and shared dorms; account-age + activity heuristics in flag review do better.
- **Auto-ban from profanity filter** — humans always decide; filter only flags.
- **Live tournament prize distribution** — chat shows a read-only prize pool display via FK to existing `prize_pools`; payout flow lives elsewhere.

---

## 2. Architecture

```
                ┌──────────────────────────────────────────────────────┐
                │  React client (web + Capacitor)                      │
                │                                                       │
                │  • One Supabase realtime client at app root           │
                │  • Subscribes to 2–4 channels per session:            │
                │      - chat:global                                     │
                │      - chat:tournament:<id> (0..n)                    │
                │      - chat:user:<self>:feed   (friends inbox + mod)  │
                │      - chat:moderation         (admins only)          │
                │  • Posts via tRPC; never inserts via supabase-js      │
                └────────────┬────────────────────────────┬────────────┘
                tRPC writes  │                            │  WS subscribe
                             ▼                            ▼
              ┌──────────────────────────────┐    ┌──────────────────────┐
              │  Vercel API (tRPC)            │───▶│  Supabase             │
              │  • chatRouter                 │    │  • Postgres            │
              │  • adminChatRouter            │    │  • Realtime gateway    │
              │  • tournamentRouter           │    │  • RLS on              │
              │  • favoritesRouter            │    │    realtime.messages   │
              │                                │    │                       │
              │  Per-call checks:              │    │  Channel join is the  │
              │   1. Auth (Supabase JWT)       │    │  one expensive check; │
              │   2. Rate-limit (Upstash)      │    │  publish/receive after│
              │   3. Ban/mute look-up          │    │  is cheap.            │
              │   4. Profanity (Tier 1)        │    └────────┬─────────────┘
              └──────────────┬────────────────┘             │
                             │ INSERT chat_messages          │ broadcast
                             ▼                               ▼
                ┌───────────────────────────────┐    ┌──────────────────────┐
                │  chat_messages                │    │  Per-room topic      │
                │  + AFTER INSERT trigger       │───▶│  chat:global         │
                │  → realtime.broadcast_changes │    │  chat:tournament:<id>│
                │  → for friends scope: fan out │    │  chat:user:<id>:feed │
                │    to each follower's inbox   │    │                       │
                └───────────────────────────────┘    └──────────────────────┘

                ┌───────────────────────────────────────────────────────┐
                │  Vercel Cron (nightly)                                 │
                │  • retentionSweep — DELETE messages older than         │
                │      room.retention_days                               │
                │  • softDeletePurge — hard-delete tombstones older      │
                │      than 30 days; clear body, keep id/author/ts       │
                └───────────────────────────────────────────────────────┘
```

**Key implementation invariants** (each one corresponds to a known production footgun surfaced by research):

| Invariant | Why |
|---|---|
| Realtime client lives **client-only**, never instantiated server-side | Vercel serverless re-imports re-subscribe → `subscribe can only be called once per channel instance` (supabase-js #1440) |
| Ordering by **server-assigned `chat_messages.id`** (`bigserial`), not client clocks | Realtime gives no delivery / ordering guarantee across reconnects |
| Reconnect backfills via **tRPC `chat.fetchSince({ lastSeenSeq })`** | Gap-fills missed messages without re-streaming history |
| **JWT refresh wired explicitly** via `onAuthStateChange('TOKEN_REFRESHED', …) → supabase.realtime.setAuth(token)` | WS otherwise keeps the old token and silently stops delivering after expiry |
| Ban check at **subscribe (RLS) AND publish (tRPC) AND read (tRPC)** | Open sockets bypass subscribe-time RLS; direct API calls bypass UI guards |
| **Private channels with Realtime Authorization** — RLS on `realtime.messages` evaluated **once at JOIN**, not per row | Cheap per-row delivery; expensive policies only run at connect time |
| **Rate-limit at Vercel Edge Middleware** (Upstash token bucket), not in-process | In-process buckets break under serverless (no shared memory across lambdas) |
| Profanity / moderation **never auto-bans**, only flags | Humans decide; avoids algorithmic-bias liability |

---

## 3. Data model

Nine new tables; no existing schema modified. All tables follow the existing `createdAtColumn()` / `updatedAtColumn()` helpers in `drizzle/schema.ts` for naming.

### 3.1 `chat_rooms`

Rooms with fixed identity. Friends feed has no row here — it's a per-author broadcast pattern, not a room.

```sql
CREATE TYPE chat_room_kind AS ENUM ('global', 'tournament');

CREATE TABLE chat_rooms (
  id              SERIAL PRIMARY KEY,
  kind            chat_room_kind NOT NULL,
  tournament_id   INTEGER REFERENCES tournaments(id) ON DELETE CASCADE,
  retention_days  INTEGER NOT NULL DEFAULT 14,
  "createdAt"     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  "updatedAt"     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT chat_rooms_tournament_required CHECK (
    (kind = 'tournament' AND tournament_id IS NOT NULL) OR
    (kind = 'global' AND tournament_id IS NULL)
  )
);
CREATE UNIQUE INDEX chat_rooms_global_singleton
  ON chat_rooms ((1))
  WHERE kind = 'global';  -- enforces exactly one Global room
CREATE UNIQUE INDEX chat_rooms_tournament_uniq
  ON chat_rooms (tournament_id)
  WHERE kind = 'tournament';
```

Seed: one row with `kind='global'`, `retention_days=14`.

### 3.2 `chat_messages`

```sql
CREATE TYPE chat_scope AS ENUM ('global', 'tournament', 'friends');
CREATE TYPE chat_flag_status AS ENUM ('clean', 'flagged', 'flagged_high_confidence', 'reviewed_clean');

CREATE TABLE chat_messages (
  id                            BIGSERIAL PRIMARY KEY,  -- doubles as global ordering sequence
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

### 3.3 `user_favorites`

```sql
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
```

100-favorite cap is enforced in the `favorites.add` tRPC mutation, not by a DB trigger — gives a friendly error path.

### 3.4 `tournaments`

```sql
CREATE TYPE tournament_status AS ENUM ('draft', 'open', 'in_progress', 'completed', 'cancelled');

CREATE TABLE tournaments (
  id              SERIAL PRIMARY KEY,
  name            VARCHAR(128) NOT NULL,
  description     TEXT,
  entry_cost_gn   INTEGER NOT NULL DEFAULT 0,
  capacity        INTEGER,  -- NULL = unlimited
  starts_at       TIMESTAMPTZ NOT NULL,
  ends_at         TIMESTAMPTZ NOT NULL,
  chat_room_id    INTEGER REFERENCES chat_rooms(id),
  status          tournament_status NOT NULL DEFAULT 'draft',
  prize_pool_id   INTEGER REFERENCES prize_pools(id),
  created_by      INTEGER NOT NULL REFERENCES users(id),
  "createdAt"     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  "updatedAt"     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CHECK (ends_at > starts_at),
  CHECK (entry_cost_gn >= 0),
  CHECK (capacity IS NULL OR capacity > 0)
);
CREATE INDEX tournaments_status_starts_at ON tournaments (status, starts_at);
```

Tournament creation also inserts the matching `chat_rooms` row in the same transaction and updates `chat_room_id`.

### 3.5 `tournament_members`

```sql
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
CREATE INDEX tournament_members_user ON tournament_members (user_id) WHERE left_at IS NULL;
```

### 3.6 `chat_bans`

```sql
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
```

### 3.7 `chat_audit_log`

```sql
CREATE TABLE chat_audit_log (
  id                    BIGSERIAL PRIMARY KEY,
  actor_id              INTEGER NOT NULL REFERENCES users(id),
  actor_role            VARCHAR(32) NOT NULL,  -- snapshot at action time
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
CREATE INDEX chat_audit_log_target_user ON chat_audit_log (target_user_id, "createdAt" DESC) WHERE target_user_id IS NOT NULL;
CREATE INDEX chat_audit_log_action ON chat_audit_log (action, "createdAt" DESC);
```

**Immutability** — append-only enforced at the database layer (REVOKE UPDATE, DELETE on table; deny-change trigger because Supabase `service_role` bypasses RLS). Mirrors the pattern in `audit.admin_actions` from the 2026-05-14 spec.

### 3.8 `chat_room_members`

Tracks `last_read_seq` per `(user, room)` for Global + Tournament rooms.

```sql
CREATE TABLE chat_room_members (
  user_id                  INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  room_id                  INTEGER NOT NULL REFERENCES chat_rooms(id) ON DELETE CASCADE,
  last_read_seq            BIGINT NOT NULL DEFAULT 0,
  last_read_at             TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  notifications_enabled    BOOLEAN NOT NULL DEFAULT TRUE,
  PRIMARY KEY (user_id, room_id)
);
```

A row is auto-created on first read of a room (`chat.fetchOlder` upserts a zero-seq row if missing).

### 3.9 `chat_friends_read_state`

Friends feed has no room, so its read state needs a per-user table.

```sql
CREATE TABLE chat_friends_read_state (
  user_id          INTEGER PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  last_read_seq    BIGINT NOT NULL DEFAULT 0,
  last_read_at     TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
```

---

## 4. Realtime delivery

### 4.1 Channel topology

| Channel | Subscribers | Carries |
|---|---|---|
| `chat:global` | All authed users not globally-banned | New messages in the Global room; moderation events scoped to Global |
| `chat:tournament:<id>` | All `tournament_members` (where `left_at IS NULL`) of that tournament, not banned from that room | New messages in the tournament's room; moderation events scoped to that room |
| `chat:user:<X>:feed` | Only the user with `auth.uid() = X` | Friends-feed messages from people X has favorited; moderation events targeting X (ban applied, message deleted, etc.) |
| `chat:moderation` | Admins only | Flag-status updates, recently-flagged messages, recently-applied bans (powers the `/admin/chat` activity view) |

Each authed user has 2–4 simultaneous channel subscriptions. RLS on `realtime.messages` enforces ownership / membership at join.

### 4.2 RLS on `realtime.messages` (channel-join authorization)

Realtime Authorization evaluates this once per JWT lifetime per channel — cheap. Indexes on every column referenced by the policy are mandatory.

```sql
-- Pseudocode — see implementation plan for full SQL.
-- Topic format: extract the channel kind & id from realtime.topic
-- Allow JOIN if:
--   - topic = 'chat:global'                  AND user not globally-banned
--   - topic = 'chat:tournament:<id>'         AND user IN tournament_members(<id>) AND not banned from that room
--   - topic = 'chat:user:<X>:feed'           AND auth.uid() = <X> AND not globally-banned
--   - topic = 'chat:moderation'              AND users.role = 'admin'
```

### 4.3 Broadcast-from-Database triggers

One `AFTER INSERT` trigger on `chat_messages`. Trigger logic:

- `scope='global'`     → `PERFORM realtime.broadcast_changes('chat:global', 'message', NEW)`
- `scope='tournament'` → `PERFORM realtime.broadcast_changes('chat:tournament:' || NEW.room_id, 'message', NEW)`
- `scope='friends'`    → loop: for each follower in `SELECT follower_id FROM user_favorites WHERE favorite_id = NEW.author_id`, broadcast to `chat:user:<follower>:feed`; also broadcast to author's own `chat:user:<author>:feed`

For shadow-banned posts, the trigger broadcasts only to the author's own inbox (and admins via `chat:moderation`) so the author sees their own message but no one else does.

A second trigger on `chat_messages` `AFTER UPDATE OF deleted_at, edited_at, body` broadcasts a `message_updated` event on the same topic — clients reconcile by id.

A third trigger on `chat_bans` `AFTER INSERT OR UPDATE` broadcasts a `ban_applied` / `ban_revoked` event to `chat:user:<user_id>:feed` so the affected user's client locks/unlocks the composer immediately.

### 4.4 Client subscription pattern

```ts
// Sketch — full implementation in Phase 1 plan
const supabase = useSupabaseClient();

useEffect(() => {
  if (!authedUser) return;

  const channels: RealtimeChannel[] = [];

  // Global
  channels.push(
    supabase.channel('chat:global', { config: { private: true } })
      .on('broadcast', { event: '*' }, handleEvent)
      .subscribe()
  );

  // Personal feed + moderation events
  channels.push(
    supabase.channel(`chat:user:${authedUser.id}:feed`, { config: { private: true } })
      .on('broadcast', { event: '*' }, handleEvent)
      .subscribe()
  );

  // Each tournament the user is in
  for (const t of myTournaments) {
    channels.push(
      supabase.channel(`chat:tournament:${t.id}`, { config: { private: true } })
        .on('broadcast', { event: '*' }, handleEvent)
        .subscribe()
    );
  }

  // Admin-only
  if (authedUser.role === 'admin') {
    channels.push(
      supabase.channel('chat:moderation', { config: { private: true } })
        .on('broadcast', { event: '*' }, handleEvent)
        .subscribe()
    );
  }

  // Manual JWT refresh wiring — the WS doesn't pick this up on its own
  const sub = supabase.auth.onAuthStateChange((event, session) => {
    if (event === 'TOKEN_REFRESHED' && session) {
      supabase.realtime.setAuth(session.access_token);
    }
  });

  return () => {
    channels.forEach((c) => supabase.removeChannel(c));
    sub.data.subscription.unsubscribe();
  };
}, [authedUser?.id, myTournaments]);
```

On reconnect: client compares `lastSeenSeq` per channel and calls `chat.fetchSince` to backfill any gaps.

---

## 5. tRPC API surface

### 5.1 `chatRouter` (authed user)

```ts
chat: router({
  // Read
  fetchInitial: protectedProcedure
    .input(z.object({
      scope: z.enum(['global', 'tournament', 'friends']),
      roomId: z.number().int().optional(),  // required when scope ∈ {global, tournament}
      limit: z.number().int().min(1).max(100).default(50),
    }))
    .query(...),  // returns { messages: ChatMessage[], lastSeenSeq: number }

  fetchOlder: protectedProcedure
    .input(z.object({
      scope: z.enum(['global', 'tournament', 'friends']),
      roomId: z.number().int().optional(),
      beforeId: z.number().int(),
      limit: z.number().int().min(1).max(100).default(50),
    }))
    .query(...),

  fetchSince: protectedProcedure
    .input(z.object({
      scope: z.enum(['global', 'tournament', 'friends']),
      roomId: z.number().int().optional(),
      lastSeenSeq: z.number().int(),
    }))
    .query(...),  // gap-fill after reconnect

  // Write
  postMessage: protectedProcedure
    .input(z.object({
      scope: z.enum(['global', 'tournament', 'friends']),
      roomId: z.number().int().optional(),
      body: z.string().min(1).max(1000),
    }))
    .mutation(...),  // ban check → rate-limit (already enforced at edge) → profanity → insert

  // Read state
  markRead: protectedProcedure
    .input(z.object({
      scope: z.enum(['global', 'tournament', 'friends']),
      roomId: z.number().int().optional(),
      seq: z.number().int(),
    }))
    .mutation(...),

  // Unread counts (single call returns all surfaces)
  unreadCounts: protectedProcedure.query(...),  // { global: 3, friends: 0, tournaments: { 7: 12 } }
})
```

### 5.2 `favoritesRouter` (authed user)

```ts
favorites: router({
  add: protectedProcedure
    .input(z.object({ userId: z.number().int() }))
    .mutation(...),  // CHECK self-favorite, cap of 100, returns updated count

  remove: protectedProcedure
    .input(z.object({ userId: z.number().int() }))
    .mutation(...),

  list: protectedProcedure.query(...),  // own list

  countForUser: protectedProcedure
    .input(z.object({ userId: z.number().int() }))
    .query(...),  // public count

  followerCountForMe: protectedProcedure.query(...),  // private (only own)
})
```

### 5.3 `tournamentRouter` (authed user)

```ts
tournaments: router({
  listOpen: protectedProcedure.query(...),
  get: protectedProcedure.input(z.object({ id: z.number().int() })).query(...),
  myMemberships: protectedProcedure.query(...),
  payEntry: protectedProcedure
    .input(z.object({ tournamentId: z.number().int() }))
    .mutation(...),  // atomic: GN spend + roster insert + chat_room_members insert + audit log
})
```

### 5.4 `adminChatRouter` (admin only)

```ts
adminChat: router({
  // Moderation
  deleteMessage: adminProcedure
    .input(z.object({ messageId: z.number(), reason: z.string().min(1) }))
    .mutation(...),

  editMessage: adminProcedure
    .input(z.object({ messageId: z.number(), newBody: z.string().min(1).max(1000), reason: z.string().min(1) }))
    .mutation(...),

  ban: adminProcedure
    .input(z.object({
      userId: z.number(),
      scope: z.enum(['global', 'room']),
      roomId: z.number().int().optional(),
      expiresAt: z.string().datetime().optional(),  // null = permanent
      reason: z.string().min(1),
    }))
    .mutation(...),

  mute: adminProcedure
    .input(z.object({
      userId: z.number(),
      scope: z.enum(['global', 'room']),
      roomId: z.number().int().optional(),
      flavor: z.enum(['visible', 'shadow']).default('visible'),
      expiresAt: z.string().datetime().optional(),
      reason: z.string().min(1),
    }))
    .mutation(...),

  revoke: adminProcedure
    .input(z.object({ banId: z.number(), reason: z.string().min(1) }))
    .mutation(...),

  // Tournament management
  createTournament: adminProcedure.input(...).mutation(...),
  updateTournament: adminProcedure.input(...).mutation(...),
  cancelTournament: adminProcedure.input(z.object({ id: z.number(), reason: z.string().min(1) })).mutation(...),
  addMember: adminProcedure.input(z.object({ tournamentId: z.number(), userId: z.number(), method: z.enum(['admin_invited', 'comp']) })).mutation(...),
  removeMember: adminProcedure.input(z.object({ tournamentId: z.number(), userId: z.number(), refundGn: z.boolean(), reason: z.string().min(1) })).mutation(...),

  // Favorites override
  addFavoriteFor: adminProcedure.input(z.object({ ownerId: z.number(), favoriteId: z.number(), reason: z.string().min(1) })).mutation(...),
  removeFavoriteFor: adminProcedure.input(z.object({ ownerId: z.number(), favoriteId: z.number(), reason: z.string().min(1) })).mutation(...),

  // Review surfaces
  flaggedMessages: adminProcedure.query(...),
  recentBans: adminProcedure.query(...),
  auditLog: adminProcedure.input(z.object({ /* filters */ })).query(...),
  userLookup: adminProcedure.input(z.object({ query: z.string() })).query(...),  // returns user + favorites + recent messages + ban history
})
```

Every mutation that modifies state writes a `chat_audit_log` row in the same transaction as the state change.

---

## 6. Friends-feed mechanics

### 6.1 Read query

```sql
SELECT * FROM chat_messages
WHERE scope = 'friends'
  AND deleted_at IS NULL
  AND (
    posted_while_shadow_banned = FALSE
    OR author_id = $viewer_id
    OR EXISTS (SELECT 1 FROM users WHERE id = $viewer_id AND role = 'admin')
  )
  AND author_id IN (
    SELECT favorite_id FROM user_favorites WHERE follower_id = $viewer_id
    UNION ALL
    SELECT $viewer_id
  )
ORDER BY id DESC
LIMIT 50;
```

Index `chat_messages_friends_author_id_id_desc` makes this an index-only scan.

### 6.2 Write fan-out (the trigger)

When a `scope='friends'` row is inserted, the trigger:

```text
1. If posted_while_shadow_banned:
     broadcast only to chat:user:<author>:feed
     also broadcast to chat:moderation (admins see all)
   Return.

2. Otherwise:
   broadcast to chat:user:<author>:feed
   for each follower in SELECT follower_id FROM user_favorites WHERE favorite_id = author:
     broadcast to chat:user:<follower>:feed
```

Cost: one broadcast per intended recipient. With a 100-favorite cap on the writer side and no cap on followers, the worst case for fan-out is the followers-of-A count. The fan-out runs synchronously inside the `AFTER INSERT` trigger, so a writer with `N` followers pays `O(N)` broadcast cost per post.

**Scale notes:**
- Acceptable at LyricPro scale (typical follower counts well under 100).
- If a single user accrues thousands of followers, move the trigger to call a `pg_notify` channel and let a small worker do the broadcast loop async — keeps the writer's transaction snappy.
- A hard "max followers" cap is **not** introduced in v1 because it'd be a hostile UX without evidence of a real problem; revisit if observed.

### 6.3 Privacy model

| Surface | Who can read |
|---|---|
| Own favorites list | The user; admin |
| "Favorites count" on a public profile ("12 favorites") | Any authed user |
| "Who favorited me" list | Admin only |
| "Followers count" ("23 people favorited you") | The user themselves; admin |

`favorites.followerCountForMe` is auth-scoped; there is no public-followers query.

### 6.4 Edge cases

| Case | Behavior |
|---|---|
| User globally banned | Existing messages remain readable; cannot post; cannot read history (ban check at read). Followers still have them favorited; admin may clear on permanent ban. |
| User deletes account | `ON DELETE CASCADE` removes both `follower_id` and `favorite_id` rows. Their messages are soft-deleted with reason `account_deleted`; purged after 30 days, leaving tombstones (`id`/`author_id`/`createdAt` retained). |
| Admin removes X from A's favorites | Equivalent to A unfavoriting X; `chat_audit_log` records `action='favorite_removed'`, `target_user_id=A`, `metadata.affected_user=X`. |
| Shadow-muted author | Posts insert with `posted_while_shadow_banned=true`; RLS hides them from non-author non-admin viewers; trigger only broadcasts to author + admins. |
| Author globally banned mid-session | `chat_bans` INSERT trigger broadcasts `ban_applied` to `chat:user:<author>:feed`; client locks composer immediately. |

---

## 7. Tournaments + GN entry

### 7.1 Lifecycle

```text
   draft ──admin open──► open ──admin start──► in_progress ──admin complete──► completed
                          │                          │
                          └──────── admin cancel ────┴────────► cancelled (any prior state)
```

| Status | Visible to non-admin | Roster mutable | Chat |
|---|---|---|---|
| `draft` | No | Admin only | Closed |
| `open` | Yes (`/tournaments`) | Paid entries + admin invites | Open to members |
| `in_progress` | Yes | Admin only (remove/comp) | Open to members |
| `completed` | Yes (archive) | No | **Read-only**, purged 30 days after `ends_at` |
| `cancelled` | Yes (archive) | No | Read-only; paid members refunded |

**Locked fields once status leaves `draft`**: `entry_cost_gn`, `capacity`, `starts_at`, `ends_at`. Name and description remain editable.

### 7.2 GN entry transaction

`tournaments.payEntry({ tournamentId })`:

```text
BEGIN;
  -- 1. Lock the tournament row
  SELECT * FROM tournaments WHERE id = $tournamentId FOR UPDATE;

  -- 2. Status check
  IF status != 'open' THEN RAISE 'TOURNAMENT_CLOSED'; END IF;

  -- 3. Capacity check
  IF capacity IS NOT NULL AND
     (SELECT COUNT(*) FROM tournament_members
      WHERE tournament_id = $tournamentId AND left_at IS NULL) >= capacity
  THEN RAISE 'TOURNAMENT_FULL'; END IF;

  -- 4. Duplicate check
  IF EXISTS (SELECT 1 FROM tournament_members
             WHERE tournament_id = $tournamentId AND user_id = $userId AND left_at IS NULL)
  THEN RAISE 'ALREADY_MEMBER'; END IF;

  -- 5. Ban check
  IF EXISTS (active global ban on $userId) THEN RAISE 'BANNED_FROM_CHAT'; END IF;

  -- 6. Spend GN — uses existing ledger function; reason='spend_tournament'
  PERFORM golden_notes.spend($userId, entry_cost_gn, 'spend_tournament', tournamentId);
  -- (Failure surfaces as 'INSUFFICIENT_FUNDS' from the GN ledger)

  -- 7. Insert roster
  INSERT INTO tournament_members (tournament_id, user_id, entry_method, gn_spent)
  VALUES ($tournamentId, $userId, 'paid', entry_cost_gn);

  -- 8. Open chat membership
  INSERT INTO chat_room_members (user_id, room_id) VALUES ($userId, chat_room_id)
  ON CONFLICT DO NOTHING;

  -- 9. Audit log
  INSERT INTO chat_audit_log (actor_id, actor_role, action, target_user_id, target_tournament_id, reason)
  VALUES ($userId, 'user', 'tournament_join_paid', $userId, $tournamentId, 'paid entry');
COMMIT;
```

The `golden_notes.spend(...)` function signature is to be **verified during the Phase 4 implementation plan** — the existing `spend_tournament` reason is documented in code comments but the exact callable interface needs reading.

### 7.3 Cancellation refund

Admin `cancelTournament({ id, reason })`:

```text
BEGIN;
  UPDATE tournaments SET status = 'cancelled' WHERE id = $id;

  -- Refund every paid member (skip admin_invited and comp)
  FOR each member IN (SELECT * FROM tournament_members
                      WHERE tournament_id = $id AND entry_method = 'paid' AND left_at IS NULL)
  LOOP
    PERFORM golden_notes.credit(member.user_id, member.gn_spent, 'refund_tournament_cancelled', $id);
    INSERT INTO chat_audit_log (...) VALUES (...);  -- one row per refund
  END LOOP;

  INSERT INTO chat_audit_log (action='tournament_cancel', ...);
COMMIT;
```

`golden_notes.credit(...)` reason `refund_tournament_cancelled` — **verify during plan** (add to ledger reason enum if not present).

### 7.4 Admin remove-member

`adminChat.removeMember({ tournamentId, userId, refundGn, reason })`:
- Sets `left_at = NOW()`.
- If `refundGn` and original `entry_method = 'paid'`: credit `gn_spent` back via `refund_admin_removed`.
- Removes `chat_room_members` row.
- Writes audit log.

---

## 8. Moderation

### 8.1 Enforcement at three layers

| Layer | Check |
|---|---|
| **Subscribe (RLS on `realtime.messages`)** | Look up `chat_bans` rows with `revoked_at IS NULL AND (expires_at IS NULL OR expires_at > NOW())`. If `action='ban'` and (`scope='global'` or `scope='room' AND room_id matches`), deny JOIN. |
| **Publish (`chat.postMessage` mutation)** | Same lookup. If `action='ban'`, return `BANNED`. If `action='mute_visible'`, return `MUTED`. If `action='mute_shadow'`, insert with `posted_while_shadow_banned=true` instead. |
| **Read (`chat.fetchOlder` / `fetchSince` / `fetchInitial`)** | Same lookup (only the global-ban case blocks reads — per-room bans don't block reads of other rooms). |

### 8.2 Profanity filter

**Tier 1 (`obscenity`, in-process, ~1ms):**

```text
const result = obscenityMatcher.match(body);
if (result.length === 0):
  flag_status = 'clean'
elif (highConfidenceHit):
  reject mutation with PROFANITY_BLOCKED
else:
  flag_status = 'flagged'
  insert message
  push to chat:moderation channel for admin review
```

**Tier 2 (Claude Haiku 4.5, env-gated `CHAT_PROFANITY_TIER2=1`, async after insert):**

```text
if (flag_status === 'flagged' && TIER2_ENABLED):
  enqueue async job:
    classification = await claude.haiku.classify(body, ...)
    UPDATE chat_messages SET flag_status = ('reviewed_clean' | 'flagged_high_confidence')
```

Tier 2 never blocks the user-visible message — it only updates flag status retrospectively.

### 8.3 Soft-delete + GDPR purge

Admin delete sets `deleted_at`, `deleted_by`, `deleted_reason`. Body retained. Non-admins see a tombstone; admins see the original.

Nightly Vercel Cron `purgeSoftDeleted`:

```sql
UPDATE chat_messages
SET body = '[purged]',
    deleted_reason = COALESCE(deleted_reason, '') || ' [body purged at retention]'
WHERE deleted_at < NOW() - INTERVAL '30 days'
  AND body != '[purged]';
```

GDPR erasure path: `adminChat.purgeUserMessages({ userId, reason })` runs the same op immediately for one user's messages, plus a final tombstone-only retention.

### 8.4 Retention sweep

Nightly Vercel Cron `retentionSweep`:

```sql
-- Global + Friends (14-day window per their room.retention_days)
DELETE FROM chat_messages
WHERE scope IN ('global', 'friends')
  AND "createdAt" < NOW() - INTERVAL '14 days'
  AND deleted_at IS NULL;

-- Tournament rooms: extend until ends_at + 30 days
DELETE FROM chat_messages
WHERE scope = 'tournament'
  AND room_id IN (
    SELECT chat_room_id FROM tournaments
    WHERE ends_at + INTERVAL '30 days' < NOW() AND status IN ('completed', 'cancelled')
  );
```

Audit log is NOT subject to retention sweep — retained 2 years.

### 8.5 Mute flavors

| Flavor | UI to muted user | Realtime delivery to others | Use when |
|---|---|---|---|
| **`mute_visible`** (default) | Composer disabled, "You can't post here" | Posts blocked at publish layer — never inserted | Standard enforcement; matches user mental model |
| **`mute_shadow`** (explicit escalation) | Composer normal; user sees own messages | Inserted with `posted_while_shadow_banned=true`; RLS hides from non-author non-admin; trigger only broadcasts to author + admins | Repeat offender / known sockpuppeteer; ethically heavier |

The admin UI explicitly surfaces "Mute visible" vs "Mute (shadow)" as two distinct actions to make the choice deliberate.

### 8.6 Rate limiting

Vercel Edge Middleware runs **before** the tRPC handler for every `chat.postMessage` request:

```ts
import { Ratelimit } from '@upstash/ratelimit';
import { Redis } from '@upstash/redis';

const limiter = new Ratelimit({
  redis: Redis.fromEnv(),
  limiter: Ratelimit.tokenBucket(5, '10 s', 10),  // 5 refills per 10s, bucket size 10
  prefix: 'chat:post',
});

// In middleware:
const { success, reset } = await limiter.limit(userId);
if (!success) return new Response('rate-limited', { status: 429, headers: { 'Retry-After': String(reset) } });
```

Admin actions are exempt (different middleware or higher-tier bucket).

---

## 9. Mobile (Capacitor) considerations

Per the research findings (full source list in section 13):

1. **Install `@capacitor/keyboard`**. `capacitor.config.ts`:
   ```ts
   plugins: {
     Keyboard: {
       resize: 'native',
       resizeOnFullScreen: true,
     },
   }
   ```
2. **Chat container uses `100dvh`** (not `vh`). Composer container uses `padding-bottom: calc(env(safe-area-inset-bottom) + var(--kb-height, 0px))`.
3. **Set a `--kb-height` CSS var** in `:root` via `keyboardWillShow` / `keyboardDidHide` listeners — Android 15 has known edge-to-edge keyboard bugs that the `resize` plugin alone doesn't fully fix.
4. **`viewport-fit=cover`** in the `<meta name="viewport">` so `env(safe-area-inset-*)` returns real values.
5. **Use `use-stick-to-bottom`** (npm) for auto-scroll. Threshold ~100px; show "N new messages" pill when not near bottom; debounce iOS momentum-scroll events ~150ms.
6. **Code-split the `/chat` route** — Capacitor low-end Android devices choke on large bundles.
7. **One Supabase realtime client at the app root**; subscribe-per-room inside `useEffect`; **always** return cleanup via `supabase.removeChannel(ch)`. Hot-reload during dev otherwise leaks subscriptions.
8. **`npx cap sync`** after adding any new Capacitor plugin (don't forget; it's a known footgun).

---

## 10. Implementation phasing

Six phases. Each is shipped as its own implementation plan via the writing-plans skill, dispatched into subagent-driven execution per the global default.

| Phase | Title | User-facing? | What ships |
|---|---|---|---|
| 1 | Foundation | No | All 9 tables. RLS on `chat_messages`, `chat_bans`, `realtime.messages`. DB triggers (broadcast fan-out, ban-applied event). Upstash Redis + Edge Middleware rate limiter. Vercel Cron (retention sweep + GDPR purge). `chatRouter` skeleton with auth/ban checks. Realtime client at app root + JWT refresh wiring. Capacitor Keyboard plugin + `100dvh` + safe-area + `--kb-height`. Test harness for end-to-end realtime path. |
| 2 | Global chat + minimal moderation | Yes | One Global room. `chat.postMessage` / `fetchOlder` / `fetchSince` / `fetchInitial` / `markRead` / `unreadCounts`. Slide-over (desktop) + `/chat` page (mobile) with Global tab only. Unread badge in `PersistentHeader`. Admin delete + global ban surfaced as per-message "•••" menu (no admin dashboard yet; audit log writes silently). Tier 1 profanity filter (`obscenity`). |
| 3 | Friends feed | Yes | `user_favorites` + favorites mutations. Leaderboard heart button with 100-cap. Friends tab. Inbox fan-out trigger. Profile favorites count surface. |
| 4 | Tournaments | Yes | `tournaments` + `tournament_members` tables. Admin `/admin/tournaments` CRUD + roster editor. Public `/tournaments` discovery. GN entry flow (`payEntry`). Tournament tab + sub-dropdown when in >1. Lifecycle transitions + cancellation refund. |
| 5 | Full moderation tools | Yes | Mutes (visible default, shadow escalation). `/admin/chat` dashboard (activity, bans, audit log, user lookup, tournament management already in P4). Edit-message with `previous_body` snapshots. Manage anyone's favorites override. Flag review queue. Ban revocation UI. |
| 6 | Polish | Yes | Tier 2 profanity (Haiku, env-gated). Foreground toast on inactive-tab messages. Member list modal in tournament chat. Tournament prize-pool surface. 100-favorite cap UX polish. Mobile UX nits surfaced in testing. |

Rough effort: P1 ~5d, P2 ~3d, P3 ~2d, P4 ~4d, P5 ~3d, P6 ~2d → ~3 weeks elapsed end-to-end with no surprises.

---

## 11. Open questions / verify-during-plan

These are decisions deferred to the relevant implementation plan, not to the user:

1. **Exact callable interface for `golden_notes.spend(...)` and `golden_notes.credit(...)`** — the `spend_tournament` reason is documented in comments at `drizzle/schema.ts:848`, but the function signature (SQL function vs application-layer helper) needs to be confirmed by reading `server/routers/monetization.ts` and the GN ledger source. **Verify in Phase 4 plan.**
2. **Add `refund_tournament_cancelled` and `refund_admin_removed`** to the GN ledger reason enum if not present. **Verify in Phase 4 plan.**
3. **Existing audit-log table shape** — `audit.admin_actions` from the 2026-05-14 spec. Decide whether `chat_audit_log` is a separate table or rows in `audit.admin_actions` with `action LIKE 'chat:%'`. **Recommended:** separate table because chat actions are much higher volume than other admin actions and shouldn't dilute the admin-action query plans. **Verify in Phase 1 plan.**
4. **Realtime extension version** on the Supabase project — `realtime.broadcast_changes()` requires a recent version. Check + upgrade if needed. **Verify in Phase 1 plan.**
5. **Upstash Redis account** — does the project already have one? Memory doesn't say. If not, provision in Phase 1; if yes, reuse. **Verify in Phase 1 plan.**
6. **`obscenity` allowlist tuning** — out-of-the-box dictionary may flag music/lyric-related words ("hell," "damn"). Tune the allowlist during Phase 2 against a corpus of expected messages.

---

## 12. Decisions log

User-facing decisions confirmed during brainstorming:

| Decision | Value | Captured at |
|---|---|---|
| Friends-tab visibility model | Asymmetric personal feed (A's feed = A + people A favorited) | Q1 |
| Tab name | "Friends" (not "Team" — collides with in-game team mode) | Q1 |
| Guest chat access | None — chat is sign-in-only | Q2 |
| Tournament structure | Multiple named, with start/end dates | Q3 |
| Tournament entry payment | Golden Notes only (auto-add on payment); Stripe checkout deferred | Q4 |
| Message retention | Sliding 14-day window for Global/Friends; tournament extends to `ends_at + 30 days` | Q5 |
| Ban scope | Both per-room and global; admin picks per action | Q6 |
| Chat surface | Responsive: dedicated `/chat` page on mobile; slide-over on desktop | Q7 |
| Mute flavors | Both visible (default) and shadow (escalation) | Q8 (Section 4a) |

---

## 13. Research sources

Realtime architecture (Supabase Realtime chat patterns, 2025–2026):
- [Realtime: Broadcast from Database](https://supabase.com/blog/realtime-broadcast-from-database)
- [Subscribing to Database Changes](https://supabase.com/docs/guides/realtime/subscribing-to-database-changes)
- [Realtime Authorization](https://supabase.com/docs/guides/realtime/authorization)
- [supabase-js #1440 — Vercel subscribe error](https://github.com/supabase/supabase-js/issues/1440)
- [Discussion #37002 — manual realtime token refresh](https://github.com/orgs/supabase/discussions/37002)
- [RLS Performance Best Practices](https://supabase.com/docs/guides/troubleshooting/rls-performance-and-best-practices-Z5Jjwv)
- [Ably vs Supabase Realtime (2026)](https://ably.com/compare/ably-vs-supabase)

Moderation patterns:
- [Stream Shadow Ban](https://getstream.io/blog/feature-announcement-shadow-ban/)
- [Upstash Ratelimit](https://github.com/upstash/ratelimit-js)
- [obscenity npm](https://www.npmjs.com/package/obscenity)
- [Anthropic content moderation use case](https://docs.anthropic.com/en/docs/about-claude/use-case-guides/content-moderation)
- [Sendbird moderation log](https://sendbird.com/docs/advanced-moderation/guide/v1/moderation-log)
- [GDPR log deletion essentials](https://logcentral.io/en/blog/gdpr-log-deletion-essentials)

Mobile (Capacitor):
- [Keyboard Capacitor Plugin API](https://capacitorjs.com/docs/apis/keyboard)
- [Android 15 keyboard overlap (#8166)](https://github.com/ionic-team/capacitor/issues/8166)
- [Keyboard hiding input on Android (#8108)](https://github.com/ionic-team/capacitor/issues/8108)
- [visualViewport bug on Android <15 (#8181)](https://github.com/ionic-team/capacitor/issues/8181)
- [shadcn AI Conversation (use-stick-to-bottom)](https://www.shadcn.io/ai/conversation)
- [Stream Unread Counts pattern](https://getstream.io/chat/docs/react/unread/)
- [Supabase Realtime Chat UI reference](https://supabase.com/ui/docs/nextjs/realtime-chat)
- [iOS safe areas in Capacitor WebView](https://www.tutorialpedia.org/blog/ios-webview-with-capacitor-set-safe-areas/)
