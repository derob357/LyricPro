# Chat System — Phase 3: Friends Feed + Leaderboard Favorites — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add the asymmetric Friends feed — users favorite players from the leaderboard via a heart icon, and a new Friends tab in the chat surface streams messages from `{self} + favorited users` in real time.

**Architecture:** A new `favoritesRouter` exposes 5 procedures (add / remove / list / countForUser / followerCountForMe) backed by the `user_favorites` table from Phase 1. The Phase 1 broadcast trigger already fans `scope='friends'` messages out to each follower's `chat:user:<id>:feed` inbox topic — Phase 3 just wires the client to subscribe to that topic via the same `useChatChannel` hook from Phase 2, and the existing `chat.postMessage` / `fetchInitial` / `fetchOlder` / `fetchSince` queries get a per-scope visibility filter for friends. A new `<FavoriteButton>` component renders on every leaderboard row, with the 100-favorite cap enforced server-side.

**Tech Stack:** All of Phase 2's stack reused. Adds no new dependencies. The lucide `Heart` icon plus motion `framer-motion` (already in deps) for the favorite-toggle animation.

**Reference spec:** [docs/superpowers/specs/2026-05-24-chat-system-design.md](../specs/2026-05-24-chat-system-design.md). Phase 1: [2026-05-24-chat-phase1-foundation.md](./2026-05-24-chat-phase1-foundation.md). Phase 2: [2026-05-24-chat-phase2-global-chat.md](./2026-05-24-chat-phase2-global-chat.md).

---

## File structure

### Server

- Create: `server/routers/favorites.ts` — new tRPC sub-router with `add`, `remove`, `list`, `countForUser`, `followerCountForMe`.
- Create: `server/routers/favorites.test.ts` — DB integration tests (cap enforcement, self-favorite block, idempotent re-favorite, asymmetric semantics).
- Modify: `server/app-router.ts` — register `favorites: favoritesRouter` alongside the existing routers.
- Modify: `server/routers/chat.ts` — add the friends-scope visibility filter to `fetchInitial` / `fetchOlder` / `fetchSince` (messages where `author_id IN (favorites of viewer) OR author_id = viewer`); extend `unreadCounts` to compute the friends count from `chat_friends_read_state`.
- Modify: `server/routers/chat.endpoints.test.ts` — add cases for friends-scope read visibility (viewer sees own messages + favorited authors' messages, not other authors').

### Client

- Create: `client/src/components/FavoriteButton.tsx` — heart icon with optimistic toggle, cap-aware (server enforces; client surfaces the error toast).
- Modify: `client/src/pages/Leaderboards.tsx` — drop a `<FavoriteButton>` into each row between the name area and the score; visible only to authed users, hidden on own row and on guest rows (`entry.userId == null`).
- Modify: `client/src/components/chat/ChatTabs.tsx` — add a Friends tab; subscribes to `chat:user:<self>:feed`; posts with `scope: "friends"` (no roomId). When the user has 0 favorites, the tab shows an empty state with a CTA back to `/leaderboards`.
- Modify: `client/src/lib/chat/chatStore.ts` — split the active-topic message map so each topic (global / friends inbox / future tournament rooms) has its own keyed cache. (Already keyed by topic per Task 7 of Phase 2 — verify no change needed.)

### No client tests

The component changes are smoke-tested by the manual verification step (final task). The server logic is the load-bearing piece and gets full TDD coverage.

---

## Task 1: Server — favoritesRouter (add / remove / list / countForUser / followerCountForMe)

**Files:**
- Create: `server/routers/favorites.ts`
- Create: `server/routers/favorites.test.ts`
- Modify: `server/app-router.ts`

- [ ] **Step 1: Write failing tests**

Create `server/routers/favorites.test.ts`:

```ts
import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";

vi.mock("stripe", () => {
  const Stripe = vi.fn().mockImplementation(() => ({
    checkout: { sessions: { create: vi.fn() } },
    webhooks: { constructEvent: vi.fn() },
    subscriptions: { retrieve: vi.fn() },
    customers: { search: vi.fn().mockResolvedValue({ data: [] }) },
  }));
  return { default: Stripe };
});

import { appRouter } from "../app-router";
import { getDb } from "../db";
import { userFavorites, users } from "../../drizzle/schema";
import { eq, or, inArray } from "drizzle-orm";

const DB_URL =
  process.env.SUPABASE_SESSION_POOLER_STRING ??
  process.env.SUPABASE_DIRECT_CONNECTION_STRING ??
  process.env.DATABASE_URL;
const liveDescribe = DB_URL ? describe : describe.skip;

const stamp = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

liveDescribe("favoritesRouter", () => {
  let aliceId: number;
  let bobId: number;
  let carolId: number;

  beforeAll(async () => {
    const db = await getDb();
    const inserted = await db!.insert(users).values([
      { openId: `fav-alice-${stamp}`, email: `fav-alice-${stamp}@example.com`, loginMethod: "vitest", role: "user" },
      { openId: `fav-bob-${stamp}`, email: `fav-bob-${stamp}@example.com`, loginMethod: "vitest", role: "user" },
      { openId: `fav-carol-${stamp}`, email: `fav-carol-${stamp}@example.com`, loginMethod: "vitest", role: "user" },
    ]).returning();
    aliceId = inserted[0].id;
    bobId = inserted[1].id;
    carolId = inserted[2].id;
  });

  afterAll(async () => {
    const db = await getDb();
    await db!.delete(userFavorites).where(
      or(
        inArray(userFavorites.followerId, [aliceId, bobId, carolId]),
        inArray(userFavorites.favoriteId, [aliceId, bobId, carolId]),
      ),
    );
    await db!.delete(users).where(inArray(users.id, [aliceId, bobId, carolId]));
  });

  const callerFor = (id: number) =>
    appRouter.createCaller({
      user: { id, role: "user", email: `${id}@example.com` },
      req: { ip: "127.0.0.1" } as never,
      ip: "127.0.0.1",
      userAgent: "vitest",
    } as never);

  it("add inserts a row", async () => {
    const result = await callerFor(aliceId).favorites.add({ userId: bobId });
    expect(result.added).toBe(true);
    expect(result.totalFavorites).toBeGreaterThanOrEqual(1);
  });

  it("add is idempotent (re-favoriting returns added=false)", async () => {
    const result = await callerFor(aliceId).favorites.add({ userId: bobId });
    expect(result.added).toBe(false);
  });

  it("remove deletes the row and returns removed=true", async () => {
    const result = await callerFor(aliceId).favorites.remove({ userId: bobId });
    expect(result.removed).toBe(true);
    // Re-add for later tests
    await callerFor(aliceId).favorites.add({ userId: bobId });
  });

  it("remove on a non-favorited user returns removed=false", async () => {
    const result = await callerFor(aliceId).favorites.remove({ userId: carolId });
    expect(result.removed).toBe(false);
  });

  it("self-favorite is rejected", async () => {
    await expect(callerFor(aliceId).favorites.add({ userId: aliceId })).rejects.toThrow(/cannot favorite/i);
  });

  it("list returns the viewer's own favorites only", async () => {
    await callerFor(aliceId).favorites.add({ userId: carolId });
    const aliceList = await callerFor(aliceId).favorites.list();
    expect(aliceList.map((f) => f.favoriteId).sort()).toEqual([bobId, carolId].sort());

    const bobList = await callerFor(bobId).favorites.list();
    expect(bobList.length).toBe(0); // bob hasn't favorited anyone
  });

  it("countForUser is publicly readable", async () => {
    const aliceCount = await callerFor(bobId).favorites.countForUser({ userId: aliceId });
    expect(aliceCount.count).toBe(2); // alice favorited bob + carol
  });

  it("followerCountForMe returns who-favorited-me count", async () => {
    // bob has been favorited by alice
    const result = await callerFor(bobId).favorites.followerCountForMe();
    expect(result.count).toBeGreaterThanOrEqual(1);
  });

  it("100-favorite cap is enforced server-side", async () => {
    // Seed 100 dummy users alice has favorited
    const db = await getDb();
    const placeholders = [];
    for (let i = 0; i < 100; i++) {
      placeholders.push({
        openId: `fav-bulk-${stamp}-${i}`,
        email: `fav-bulk-${stamp}-${i}@example.com`,
        loginMethod: "vitest",
        role: "user" as const,
      });
    }
    const bulk = await db!.insert(users).values(placeholders).returning();
    // Bring alice up to 100 by favoriting each of the bulk users + already favorited 2 (bob, carol)
    // She's at 2; need 98 more to reach 100
    for (let i = 0; i < 98; i++) {
      await db!.insert(userFavorites).values({ followerId: aliceId, favoriteId: bulk[i].id });
    }
    // The 101st must fail
    await expect(
      callerFor(aliceId).favorites.add({ userId: bulk[98].id }),
    ).rejects.toThrow(/limit|cap|maximum/i);

    // Cleanup the bulk users + their favorites
    await db!.delete(userFavorites).where(eq(userFavorites.followerId, aliceId));
    await db!.delete(users).where(inArray(users.id, bulk.map((u) => u.id)));
    // Restore the baseline (alice favorites bob + carol)
    await callerFor(aliceId).favorites.add({ userId: bobId });
    await callerFor(aliceId).favorites.add({ userId: carolId });
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

```bash
set -a; source .env; set +a; pnpm test:server -- favorites.test
```

Expected: FAIL — `favoritesRouter` not registered.

- [ ] **Step 3: Implement `favoritesRouter`**

Create `server/routers/favorites.ts`:

```ts
// User-favorites tRPC router. Powers the leaderboard heart-toggle and the
// Friends chat tab. Asymmetric: A favoriting B does not imply B favoriting A.
// 100-favorite cap enforced here so users get a friendly error rather than a
// raw constraint violation (the DB has no cap; this is application-layer).
import { z } from "zod";
import { TRPCError } from "@trpc/server";
import { and, eq, sql } from "drizzle-orm";
import { router, protectedProcedure } from "../_core/trpc";
import { getDb } from "../db";
import { userFavorites } from "../../drizzle/schema";

const FAVORITES_CAP = 100;

export const favoritesRouter = router({
  add: protectedProcedure
    .input(z.object({ userId: z.number().int() }))
    .mutation(async ({ input, ctx }) => {
      if (input.userId === ctx.user.id) {
        throw new TRPCError({ code: "BAD_REQUEST", message: "You cannot favorite yourself." });
      }
      const db = await getDb();
      if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "DB unavailable" });

      // Check cap before insert. (DB has no cap; UX clarity wins here.)
      const [{ count }] = await db
        .select({ count: sql<number>`COUNT(*)::int` })
        .from(userFavorites)
        .where(eq(userFavorites.followerId, ctx.user.id));
      if (count >= FAVORITES_CAP) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: `You've reached your favorites limit (${FAVORITES_CAP}). Remove one to add another.`,
        });
      }

      // Idempotent insert — UNIQUE(follower_id, favorite_id) on the table
      // protects us from races. ON CONFLICT DO NOTHING lets us tell the
      // caller whether it was a new add or a no-op.
      const result = await db
        .insert(userFavorites)
        .values({ followerId: ctx.user.id, favoriteId: input.userId })
        .onConflictDoNothing()
        .returning({ id: userFavorites.id });

      const added = result.length > 0;
      return { added, totalFavorites: added ? count + 1 : count };
    }),

  remove: protectedProcedure
    .input(z.object({ userId: z.number().int() }))
    .mutation(async ({ input, ctx }) => {
      const db = await getDb();
      if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "DB unavailable" });
      const result = await db
        .delete(userFavorites)
        .where(
          and(
            eq(userFavorites.followerId, ctx.user.id),
            eq(userFavorites.favoriteId, input.userId),
          ),
        )
        .returning({ id: userFavorites.id });
      return { removed: result.length > 0 };
    }),

  list: protectedProcedure.query(async ({ ctx }) => {
    const db = await getDb();
    if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "DB unavailable" });
    const rows = await db
      .select()
      .from(userFavorites)
      .where(eq(userFavorites.followerId, ctx.user.id))
      .orderBy(sql`${userFavorites.createdAt} DESC`);
    return rows;
  }),

  countForUser: protectedProcedure
    .input(z.object({ userId: z.number().int() }))
    .query(async ({ input }) => {
      const db = await getDb();
      if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "DB unavailable" });
      const [{ count }] = await db
        .select({ count: sql<number>`COUNT(*)::int` })
        .from(userFavorites)
        .where(eq(userFavorites.followerId, input.userId));
      return { count };
    }),

  followerCountForMe: protectedProcedure.query(async ({ ctx }) => {
    const db = await getDb();
    if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "DB unavailable" });
    const [{ count }] = await db
      .select({ count: sql<number>`COUNT(*)::int` })
      .from(userFavorites)
      .where(eq(userFavorites.favoriteId, ctx.user.id));
    return { count };
  }),
});
```

- [ ] **Step 4: Register the router**

Edit `server/app-router.ts`. Add the import alongside the others:

```ts
import { favoritesRouter } from "./routers/favorites";
```

Inside the `router({ ... })` call, add the line near `chat: chatRouter`:

```ts
favorites: favoritesRouter,
```

- [ ] **Step 5: Run tests to verify they pass**

```bash
set -a; source .env; set +a; pnpm test:server -- favorites.test
```

Expected: 9 / 9 PASS.

- [ ] **Step 6: Run typecheck**

```bash
pnpm check
```

Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add server/routers/favorites.ts server/routers/favorites.test.ts server/app-router.ts
git commit -m "feat(chat): favoritesRouter — add/remove/list/countForUser/followerCountForMe (100 cap)"
```

---

## Task 2: Server — friends-scope visibility filter on fetch queries

**Files:**
- Modify: `server/routers/chat.ts`
- Modify: `server/routers/chat.endpoints.test.ts`

- [ ] **Step 1: Append failing tests**

Append to `server/routers/chat.endpoints.test.ts` (outside any existing `liveDescribe`):

```ts
liveDescribe("chat fetch — friends-scope visibility", () => {
  let viewerId: number;
  let favoritedId: number;
  let strangerId: number;

  beforeAll(async () => {
    const db = await getDb();
    const ts = `${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
    const seeded = await db!.insert(users).values([
      { openId: `friends-viewer-${ts}`, email: `friends-viewer-${ts}@example.com`, loginMethod: "vitest", role: "user" },
      { openId: `friends-fav-${ts}`, email: `friends-fav-${ts}@example.com`, loginMethod: "vitest", role: "user" },
      { openId: `friends-stranger-${ts}`, email: `friends-stranger-${ts}@example.com`, loginMethod: "vitest", role: "user" },
    ]).returning();
    viewerId = seeded[0].id;
    favoritedId = seeded[1].id;
    strangerId = seeded[2].id;

    // Viewer favorites favoritedId. Does NOT favorite strangerId.
    await db!.insert(userFavorites).values({ followerId: viewerId, favoriteId: favoritedId });

    // Three friends-scope messages: one from viewer, one from favoritedId, one from strangerId.
    await db!.insert(chatMessages).values([
      { scope: "friends", authorId: viewerId, body: "my own friends post" },
      { scope: "friends", authorId: favoritedId, body: "from someone I favorited" },
      { scope: "friends", authorId: strangerId, body: "from a stranger" },
    ]);
  });

  afterAll(async () => {
    const db = await getDb();
    await db!.delete(chatMessages).where(inArray(chatMessages.authorId, [viewerId, favoritedId, strangerId]));
    await db!.delete(userFavorites).where(eq(userFavorites.followerId, viewerId));
  });

  const callerFor = (id: number) =>
    appRouter.createCaller({
      user: { id, role: "user", email: `${id}@example.com` },
      req: { ip: "127.0.0.1" } as never,
      ip: "127.0.0.1",
      userAgent: "vitest",
    } as never);

  it("fetchInitial friends returns only own + favorited authors' messages", async () => {
    const result = await callerFor(viewerId).chat.fetchInitial({ scope: "friends", limit: 50 });
    const bodies = result.messages.map((m) => m.body);
    expect(bodies).toContain("my own friends post");
    expect(bodies).toContain("from someone I favorited");
    expect(bodies).not.toContain("from a stranger");
  });

  it("fetchOlder friends respects the visibility filter", async () => {
    const initial = await callerFor(viewerId).chat.fetchInitial({ scope: "friends", limit: 1 });
    if (initial.messages.length === 0) return; // no messages, nothing to paginate
    const older = await callerFor(viewerId).chat.fetchOlder({
      scope: "friends",
      beforeId: initial.messages[initial.messages.length - 1].id,
      limit: 50,
    });
    for (const m of older) {
      expect(m.authorId === viewerId || m.authorId === favoritedId).toBe(true);
    }
  });
});
```

Append `inArray` to the existing `drizzle-orm` import at the top of the file:

```ts
import { eq, and, isNull, inArray } from "drizzle-orm";
```
(If some of these already exist, just add `inArray`.)

- [ ] **Step 2: Verify tests fail**

```bash
set -a; source .env; set +a; pnpm test:server -- chat.endpoints.test
```

Expected: previous tests still PASS; 2 new tests FAIL because the friends visibility filter isn't applied yet.

- [ ] **Step 3: Add the friends visibility filter to all three fetch procedures**

Edit `server/routers/chat.ts`. In `fetchInitial`, `fetchOlder`, and `fetchSince`, add a friends-scope clause that limits authors to `{viewer} ∪ {favorites of viewer}`. The cleanest approach: import `userFavorites` and use a subquery.

At the top of `chat.ts`, add to the schema import:

```ts
import {
  chatMessages,
  chatBans,
  chatRoomMembers,
  chatFriendsReadState,
  chatAuditLog,
  userFavorites,
  type ChatMessage as ChatMessageRow,
} from "../../drizzle/schema";
```

Add this helper above the `router({...})` block:

```ts
import { inArray } from "drizzle-orm";

function friendsVisibilityClause(viewerId: number) {
  // author_id IN (SELECT favorite_id FROM user_favorites WHERE follower_id = viewer UNION ALL SELECT viewer)
  return sql`(
    ${chatMessages.authorId} = ${viewerId}
    OR ${chatMessages.authorId} IN (
      SELECT ${userFavorites.favoriteId} FROM ${userFavorites}
      WHERE ${userFavorites.followerId} = ${viewerId}
    )
  )`;
}
```

In each of `fetchInitial`, `fetchOlder`, `fetchSince`, modify the `where` array — change the friends-scope branch so the visibility clause is appended:

Find this pattern in each procedure:
```ts
      const where = [
        eq(chatMessages.scope, input.scope),
        isNull(chatMessages.deletedAt),
      ];
      if (input.scope !== "friends" && input.roomId != null) {
        where.push(eq(chatMessages.roomId, input.roomId));
      }
```

Replace it with:
```ts
      const where = [
        eq(chatMessages.scope, input.scope),
        isNull(chatMessages.deletedAt),
      ];
      if (input.scope === "friends") {
        where.push(friendsVisibilityClause(ctx.user.id));
      } else if (input.roomId != null) {
        where.push(eq(chatMessages.roomId, input.roomId));
      }
```

Apply identically to `fetchInitial`, `fetchOlder`, and `fetchSince` (three call sites).

- [ ] **Step 4: Run tests, watch them pass**

```bash
set -a; source .env; set +a; pnpm test:server -- chat.endpoints.test
```

Expected: previous tests still PASS; 2 new tests PASS.

- [ ] **Step 5: Commit**

```bash
git add server/routers/chat.ts server/routers/chat.endpoints.test.ts
git commit -m "feat(chat): friends-scope visibility filter on fetch queries"
```

---

## Task 3: Server — extend unreadCounts with friends count

**Files:**
- Modify: `server/routers/chat.ts`
- Modify: `server/routers/chat.endpoints.test.ts`

- [ ] **Step 1: Append failing test**

Append to `server/routers/chat.endpoints.test.ts` inside the existing `liveDescribe("chat.markRead + unreadCounts", () => { ... })` block, just before the closing `});`:

```ts
  it("unreadCounts.friends reflects messages from favorited authors and self", async () => {
    const db = await getDb();
    const ts = `${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
    const [favAuthor] = await db!.insert(users).values({
      openId: `unread-friends-author-${ts}`,
      email: `unread-friends-author-${ts}@example.com`,
      loginMethod: "vitest",
      role: "user",
    }).returning();

    try {
      // userId (already created in this describe) favorites favAuthor
      await db!.insert(userFavorites).values({ followerId: userId, favoriteId: favAuthor.id });
      // favAuthor posts in friends-scope
      await db!.insert(chatMessages).values({
        scope: "friends",
        authorId: favAuthor.id,
        body: "for the feed",
      });

      const caller = callerFor(userId);
      const counts = await caller.chat.unreadCounts();
      expect(counts.friends).toBeGreaterThanOrEqual(1);
    } finally {
      await db!.delete(chatMessages).where(eq(chatMessages.authorId, favAuthor.id));
      await db!.delete(userFavorites).where(eq(userFavorites.followerId, userId));
      await db!.delete(users).where(eq(users.id, favAuthor.id));
    }
  });
```

If `userFavorites` isn't already imported at the top of `chat.endpoints.test.ts`, add it:

```ts
import { chatMessages, chatBans, chatRoomMembers, chatAuditLog, userFavorites, users } from "../../drizzle/schema";
```

- [ ] **Step 2: Verify test fails**

```bash
set -a; source .env; set +a; pnpm test:server -- chat.endpoints.test
```

Expected: new test FAILs because `unreadCounts.friends` is hard-coded to 0.

- [ ] **Step 3: Update `unreadCounts` to compute the friends count**

Edit `server/routers/chat.ts`. Replace the existing `unreadCounts` implementation with:

```ts
  unreadCounts: protectedProcedure.query(async ({ ctx }) => {
    const db = await getDb();
    if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "DB unavailable" });

    // Global — messages with id > last_read_seq for (user, room=1)
    const [globalRow] = await db
      .select({ lastSeq: chatRoomMembers.lastReadSeq })
      .from(chatRoomMembers)
      .where(and(eq(chatRoomMembers.userId, ctx.user.id), eq(chatRoomMembers.roomId, 1)));
    const globalLastSeq = globalRow?.lastSeq ?? 0;

    const globalRes = await db.execute(sql`
      SELECT COUNT(*)::int AS count
      FROM chat_messages
      WHERE scope = 'global'
        AND room_id = 1
        AND id > ${globalLastSeq}
        AND deleted_at IS NULL
        AND NOT (posted_while_shadow_banned AND author_id != ${ctx.user.id})
    `);
    const globalCount = ((globalRes as unknown as { rows?: Array<{ count: number }> }).rows
      ?? (Array.isArray(globalRes) ? (globalRes as unknown as Array<{ count: number }>) : []))[0]?.count ?? 0;

    // Friends — messages in scope='friends' with author IN {self ∪ favorites(self)}, id > last_read_seq
    const [friendsRow] = await db
      .select({ lastSeq: chatFriendsReadState.lastReadSeq })
      .from(chatFriendsReadState)
      .where(eq(chatFriendsReadState.userId, ctx.user.id));
    const friendsLastSeq = friendsRow?.lastSeq ?? 0;

    const friendsRes = await db.execute(sql`
      SELECT COUNT(*)::int AS count
      FROM chat_messages
      WHERE scope = 'friends'
        AND id > ${friendsLastSeq}
        AND deleted_at IS NULL
        AND NOT (posted_while_shadow_banned AND author_id != ${ctx.user.id})
        AND (
          author_id = ${ctx.user.id}
          OR author_id IN (
            SELECT favorite_id FROM user_favorites WHERE follower_id = ${ctx.user.id}
          )
        )
    `);
    const friendsCount = ((friendsRes as unknown as { rows?: Array<{ count: number }> }).rows
      ?? (Array.isArray(friendsRes) ? (friendsRes as unknown as Array<{ count: number }>) : []))[0]?.count ?? 0;

    return {
      global: globalCount,
      friends: friendsCount,
      tournaments: {} as Record<number, number>,  // Phase 4 fills this in
    };
  }),
```

- [ ] **Step 4: Run tests, watch them pass**

```bash
set -a; source .env; set +a; pnpm test:server -- chat.endpoints.test
```

Expected: all tests PASS.

- [ ] **Step 5: Commit**

```bash
git add server/routers/chat.ts server/routers/chat.endpoints.test.ts
git commit -m "feat(chat): unreadCounts.friends computed from chat_friends_read_state"
```

---

## Task 4: Client — FavoriteButton component

**Files:**
- Create: `client/src/components/FavoriteButton.tsx`

- [ ] **Step 1: Create the component**

Create `client/src/components/FavoriteButton.tsx`:

```tsx
import { useState } from "react";
import { Heart } from "lucide-react";
import { Button } from "@/components/ui/button";
import { trpc } from "@/lib/trpc";
import { toast } from "sonner";

interface Props {
  targetUserId: number;
  // Whether the viewer has this user favorited (initial state from a list query).
  initialFavorited: boolean;
  // Optional: tooltip / aria-label custom text.
  className?: string;
}

export function FavoriteButton({ targetUserId, initialFavorited, className }: Props) {
  const [favorited, setFavorited] = useState(initialFavorited);
  const utils = trpc.useUtils();
  const addMutation = trpc.favorites.add.useMutation();
  const removeMutation = trpc.favorites.remove.useMutation();
  const busy = addMutation.isPending || removeMutation.isPending;

  const handleToggle = async (e: React.MouseEvent) => {
    e.stopPropagation();
    e.preventDefault();
    if (busy) return;
    const nextFavorited = !favorited;
    setFavorited(nextFavorited); // optimistic
    try {
      if (nextFavorited) {
        await addMutation.mutateAsync({ userId: targetUserId });
      } else {
        await removeMutation.mutateAsync({ userId: targetUserId });
      }
      // Invalidate so list-based components refresh
      void utils.favorites.list.invalidate();
      void utils.chat.unreadCounts.invalidate();
    } catch (err) {
      setFavorited(!nextFavorited); // rollback
      toast.error(err instanceof Error ? err.message : "Couldn't update favorite");
    }
  };

  return (
    <Button
      type="button"
      variant="ghost"
      size="icon"
      onClick={handleToggle}
      aria-label={favorited ? "Unfavorite player" : "Favorite player"}
      aria-pressed={favorited}
      disabled={busy}
      className={`h-8 w-8 shrink-0 ${className ?? ""}`}
    >
      <Heart
        className={`h-4 w-4 transition-colors ${
          favorited ? "fill-rose-500 text-rose-500" : "text-muted-foreground"
        }`}
      />
    </Button>
  );
}
```

- [ ] **Step 2: Run typecheck**

```bash
pnpm check
```

Expected: PASS.

- [ ] **Step 3: Commit**

```bash
git add client/src/components/FavoriteButton.tsx
git commit -m "feat(chat): FavoriteButton with optimistic toggle + error rollback"
```

---

## Task 5: Client — wire FavoriteButton onto leaderboard rows

**Files:**
- Modify: `client/src/pages/Leaderboards.tsx`

- [ ] **Step 1: Fetch the viewer's favorites list**

Edit `client/src/pages/Leaderboards.tsx`. Near the existing `const { user, isAuthenticated } = useAuth();` line, add:

```tsx
import { FavoriteButton } from "@/components/FavoriteButton";

// inside the component, after useAuth():
const favoritesList = trpc.favorites.list.useQuery(undefined, {
  enabled: isAuthenticated,
  staleTime: 60_000,
});
const favoritedIds = new Set<number>(
  (favoritesList.data ?? []).map((f) => f.favoriteId),
);
```

- [ ] **Step 2: Drop the button into each row**

In the existing row JSX (the `motion.div` per entry), insert a `<FavoriteButton>` between the name block and the score block. The condition: visible only when authed, target is NOT a guest (`entry.userId != null`), and NOT the viewer's own row.

Replace the row JSX section starting at the score block. Find this:

```tsx
                      <div className="text-right shrink-0">
                        <div className={`font-display font-bold text-lg ${
                          idx === 0 ? "text-yellow-400" : isMe ? "text-primary" : "text-foreground"
                        }`}>
                          {entry.score.toLocaleString()}
                        </div>
                        <div className="text-muted-foreground text-xs">pts</div>
                      </div>
```

…and add the button immediately BEFORE that block (still inside the same `motion.div`):

```tsx
                      {isAuthenticated && entry.userId != null && !isMe && (
                        <FavoriteButton
                          targetUserId={entry.userId}
                          initialFavorited={favoritedIds.has(entry.userId)}
                          className="opacity-70 hover:opacity-100"
                        />
                      )}
                      <div className="text-right shrink-0">
                        <div className={`font-display font-bold text-lg ${
                          idx === 0 ? "text-yellow-400" : isMe ? "text-primary" : "text-foreground"
                        }`}>
                          {entry.score.toLocaleString()}
                        </div>
                        <div className="text-muted-foreground text-xs">pts</div>
                      </div>
```

- [ ] **Step 3: Run typecheck + client tests**

```bash
pnpm check
pnpm test:client
```

Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git add client/src/pages/Leaderboards.tsx
git commit -m "feat(chat): leaderboard rows show FavoriteButton for authed-on-authed views"
```

---

## Task 6: Client — Friends tab in ChatTabs

**Files:**
- Modify: `client/src/components/chat/ChatTabs.tsx`

- [ ] **Step 1: Extend `ChatTabs` to support the Friends tab**

Edit `client/src/components/chat/ChatTabs.tsx`. Make these changes:

1. Change the tab type union and state default to support `"friends"`:

```tsx
const [tab, setTab] = useState<"global" | "friends">("global");
```

2. Compute the active topic per tab. The Friends tab uses the viewer's personal inbox channel; the Global tab uses `chat:global`.

```tsx
const GLOBAL_TOPIC = "chat:global";
const friendsTopic = user ? `chat:user:${user.id}:feed` : null;
const activeTopic = tab === "global" ? GLOBAL_TOPIC : friendsTopic;
```

3. Change the `useChatChannel(...)` call to use `activeTopic`:

```tsx
useChatChannel(activeTopic);
```

4. Add a SECOND `trpc.chat.fetchInitial.useQuery(...)` call for friends scope, gated on the tab being active. Hydrate the friends-topic store the same way as global.

```tsx
const friendsInitial = trpc.chat.fetchInitial.useQuery(
  { scope: "friends", limit: 50 },
  { enabled: tab === "friends" && !!user, staleTime: 60_000 },
);

useEffect(() => {
  if (!friendsInitial.data?.messages || !friendsTopic) return;
  for (const m of friendsInitial.data.messages) {
    upsertMessage(friendsTopic, {
      id: Number(m.id),
      scope: m.scope as "global" | "tournament" | "friends",
      roomId: m.roomId,
      authorId: m.authorId,
      body: m.body,
      postedWhileShadowBanned: m.postedWhileShadowBanned,
      flagStatus: m.flagStatus,
      editedAt: m.editedAt as unknown as string | null,
      deletedAt: m.deletedAt as unknown as string | null,
      deletedBy: m.deletedBy,
      deletedReason: m.deletedReason,
      createdAt: m.createdAt as unknown as string,
    });
  }
}, [friendsInitial.data, friendsTopic]);
```

5. Compute the displayed messages based on the active tab:

```tsx
const globalMessages = useChatMessages(GLOBAL_TOPIC);
const friendsMessages = useChatMessages(friendsTopic ?? "");
// The friends inbox channel also delivers moderation events (ban_applied
// etc.) and the user's own friends posts — but the chatStore only carries
// what useChatChannel inserted via 'message_inserted' / 'message_updated'.
// Filter to scope='friends' here as a safety check.
const friendsForDisplay = friendsMessages.filter((m) => m.scope === "friends");
```

6. Update the `handleSend` to route by scope:

```tsx
const handleSend = async (body: string) => {
  try {
    const result = await postMutation.mutateAsync(
      tab === "global"
        ? { scope: "global", roomId: GLOBAL_ROOM_ID, body }
        : { scope: "friends", body },
    );
    const targetTopic = tab === "global" ? GLOBAL_TOPIC : friendsTopic!;
    upsertMessage(targetTopic, {
      id: Number(result.id),
      scope: tab,
      roomId: tab === "global" ? GLOBAL_ROOM_ID : null,
      authorId: user!.id,
      body,
      postedWhileShadowBanned: Boolean(result.postedWhileShadowBanned),
      flagStatus: "clean",
      editedAt: null,
      deletedAt: null,
      deletedBy: null,
      deletedReason: null,
      createdAt: new Date().toISOString(),
    });
  } catch (err) {
    toast.error(err instanceof Error ? err.message : "Failed to send message");
  }
};
```

7. Replace the `TabsList` to include both tabs (and bump grid-cols to 2):

```tsx
<TabsList className="grid grid-cols-2 mx-3 mt-3">
  <TabsTrigger value="global">Global</TabsTrigger>
  <TabsTrigger value="friends">Friends</TabsTrigger>
</TabsList>
```

8. Duplicate the existing `TabsContent value="global"` block for `value="friends"`, swapping in `friendsForDisplay`. Add an empty-state branch when the user has 0 favorites — fetch the viewer's favorites count and show a CTA:

```tsx
const myFavoritesCount = trpc.favorites.list.useQuery(undefined, {
  enabled: !!user,
  staleTime: 60_000,
});
const friendsEmpty = (myFavoritesCount.data?.length ?? 0) === 0;
```

```tsx
<TabsContent value="friends" className="flex flex-col flex-1 min-h-0 mt-2">
  {friendsEmpty ? (
    <div className="flex flex-1 flex-col items-center justify-center text-center px-6 gap-2">
      <p className="text-sm text-muted-foreground">
        Favorite players on the leaderboard to start chatting.
      </p>
      <a
        href="/leaderboards"
        className="text-sm text-primary underline-offset-2 hover:underline"
      >
        Browse leaderboard
      </a>
    </div>
  ) : (
    <>
      <ChatMessageList
        messages={friendsForDisplay}
        viewerId={user?.id ?? null}
        viewerRole={user?.role ?? null}
        onAdminDelete={handleAdminDelete}
        onAdminBan={handleAdminBan}
      />
      <ChatComposer
        onSend={handleSend}
        disabledReason={user ? null : "Sign in to chat"}
      />
    </>
  )}
</TabsContent>
```

- [ ] **Step 2: Run typecheck + client tests**

```bash
pnpm check
pnpm test:client
```

Expected: PASS. If `useChatMessages("")` complains about empty string as topic, change the call to `useChatMessages(friendsTopic ?? GLOBAL_TOPIC)` — but the chatStore will return empty for an unknown topic, so the empty-string case is benign.

- [ ] **Step 3: Commit**

```bash
git add client/src/components/chat/ChatTabs.tsx
git commit -m "feat(chat): Friends tab in ChatTabs with empty-state CTA + inbox-channel subscription"
```

---

## Task 7: End-to-end manual verification

**Files:** none.

- [ ] **Step 1: Build + dev server**

```bash
pnpm build && pnpm dev
```

Expected: clean build, dev server boots.

- [ ] **Step 2: Verify the leaderboard heart**

Open the dev URL in a browser as an authed user. Navigate to `/leaderboards`. Each row (except your own and any guest rows) should show an outline heart icon. Click one — heart fills rose; the change persists after refresh. Click again — unfavorites cleanly.

- [ ] **Step 3: Verify the Friends tab — empty state**

Sign in as a fresh user with 0 favorites. Open chat (header icon → desktop slide-over OR mobile `/chat`). Click the **Friends** tab. You should see the empty-state copy: "Favorite players on the leaderboard to start chatting." with a link to `/leaderboards`.

- [ ] **Step 4: Verify the Friends tab — populated**

From the same browser, navigate to the leaderboard and favorite at least one other authed user. Open a second browser as that favorited user. Have them post a Friends message (note: posting Friends works from any user; the visibility is what's filtered). Switch back to browser 1 and check the Friends tab — the message should appear within ~1 second via realtime, AND it should be visible (because you favorited the author).

- [ ] **Step 5: Verify the asymmetric semantic**

In browser 2 (the favorited user, who has NOT favorited you back), open the Friends tab. Your message from browser 1 should appear (you = author, they're a follower of you because… wait, NO. The asymmetric rule is the inverse — browser 2 only sees their own messages plus messages from authors browser 2 has favorited. They have NOT favorited browser 1, so your message should NOT appear in their Friends feed). Confirm.

- [ ] **Step 6: Verify the 100-favorite cap**

Programmatically (via the DB or by scripting `favorites.add` calls) bring your favorites count to 100. Attempt to favorite a 101st user — the heart button should flash an error toast: "You've reached your favorites limit (100). Remove one to add another."

- [ ] **Step 7: Verify the unread badge counts friends**

With unread friends messages in the inbox, the persistent-header chat icon should show a numeric badge that includes the friends count. Click into the Friends tab — the count should drop after a few seconds (note: `chat.markRead` for the friends feed will land in a follow-up; for Phase 3 the count is read but not auto-cleared by viewing — that's a Phase 6 polish item if needed).

There is no commit for this task — it's the verification gate.

---

## Phase 3 done. Phase 4 preview

Phase 3 ships:
- Heart icon on every leaderboard row
- 5 `favorites.*` procedures with the 100-cap enforced
- Friends tab in the chat surface
- Asymmetric friends-feed visibility
- Friends unread count reflected in the header badge

Phase 4 will add **Tournaments**:
- Admin `/admin/tournaments` CRUD page
- Public `/tournaments` discovery
- GN-paid entry flow (`tournaments.payEntry`) — atomic with the existing GN ledger
- Tournament tab in `ChatTabs` (sub-dropdown if user is in >1 tournament)
- Tournament-room chat reuses the same Phase 2 surface; the inbox-channel pattern doesn't apply to tournaments (they have a real `chat_rooms.id` and a `chat:tournament:<id>` channel — straightforward subscribe).
- Cancellation refund flow.
