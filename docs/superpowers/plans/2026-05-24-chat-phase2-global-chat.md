# Chat System — Phase 2: Global Chat + Minimal Moderation — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** First user-visible vertical slice — a Global chat tab accessible via a slide-over (desktop) or `/chat` route (mobile), with realtime delivery, optimistic posting, infinite scroll, unread badge in the persistent header, Tier 1 profanity filtering, rate limiting, and admin-only per-message delete + global-ban actions surfaced as a `•••` menu.

**Architecture:** tRPC mutations write to `chat_messages` (Phase 1 trigger fans out per-room broadcasts). React client subscribes to the `chat:global` Supabase Realtime channel via the singleton client at app root. Optimistic UI inserts the local message immediately; the realtime echo is deduped by `id`. Infinite scroll up paginates via `chat.fetchOlder({ beforeId })`. Reconnect backfill via `chat.fetchSince({ lastSeenSeq })`. Admin actions live in a sub-router under `chat.admin` and surface as a per-message `•••` menu when `user.role === 'admin'`. Full `/admin/chat` dashboard is deferred to Phase 5.

**Tech Stack:** Phase 1's foundation + `obscenity` (Tier 1 profanity, in-process), `use-stick-to-bottom` (auto-scroll), `@radix-ui/react-dropdown-menu` (already installed) for the admin menu, `@/components/ui/sheet` (slide-over), `@/components/ui/tabs` (tab strip — Global only for Phase 2; Friends and Tournament arrive in Phases 3 and 4), `sonner` (toasts).

**Reference spec:** [docs/superpowers/specs/2026-05-24-chat-system-design.md](../specs/2026-05-24-chat-system-design.md). Phase 1 plan: [2026-05-24-chat-phase1-foundation.md](./2026-05-24-chat-phase1-foundation.md).

---

## File structure (created or modified by this phase)

### Server

- Create: `server/_core/profanityFilter.ts` — wraps `obscenity`. Exports `assessProfanity(body)` returning `{ status: "clean" | "flagged", reason: string | null, block: boolean }`.
- Create: `server/_core/profanityFilter.test.ts`
- Modify: `server/routers/chat.ts` — add `postMessage`, `fetchInitial`, `fetchOlder`, `fetchSince`, `markRead`, `unreadCounts` procedures. Add `admin` sub-router with `deleteMessage`, `banAuthor`.
- Create: `server/routers/chat.endpoints.test.ts` — integration tests for the new procedures.

### Client (new)

- Create: `client/src/lib/chat/useChatChannel.ts` — hook that subscribes to a single `chat:<topic>` Realtime channel; pushes events into a Zustand-like store via callback. Lifecycle: subscribe on mount, cleanup on unmount.
- Create: `client/src/lib/chat/chatStore.ts` — minimal in-memory cache for the active channel's messages keyed by id. Used for optimistic dedup and infinite-scroll merging.
- Create: `client/src/components/chat/ChatMessage.tsx` — renders one message row.
- Create: `client/src/components/chat/ChatMessageList.tsx` — scrollable list with `use-stick-to-bottom`, infinite scroll up, "N new messages" pill.
- Create: `client/src/components/chat/ChatComposer.tsx` — text input + send button with rate-limit-aware disabled state.
- Create: `client/src/components/chat/ChatTabs.tsx` — tab strip; Phase 2 has only the Global tab. Friends/Tournament tabs will be added by Phase 3 and Phase 4 wrapped in their own feature flags.
- Create: `client/src/components/chat/ChatPanel.tsx` — responsive container that wraps `ChatTabs` in a `Sheet` on desktop and renders fullscreen on mobile.
- Create: `client/src/pages/Chat.tsx` — `/chat` route for mobile.
- Create: `client/src/lib/chat/useUnreadCounts.ts` — polls `chat.unreadCounts` on focus / visibility change.

### Client (modified)

- Modify: `client/src/App.tsx` — add `/chat` route, mount `<ChatPanel>` as a portal-mounted slide-over on desktop.
- Modify: `client/src/components/PersistentHeader.tsx` — add a Chat icon (lucide `MessageSquare`) with unread badge; clicking opens the slide-over (desktop) or navigates to `/chat` (mobile).

### Config

- Modify: `package.json` — add `obscenity`, `use-stick-to-bottom`.
- Modify: `vercel.json` — Upstash rate limiter activation note (no actual config change; CRON_SECRET and UPSTASH_* env vars must be set at the Vercel project level).

---

## Task 1: Install dependencies

**Files:**
- Modify: `package.json`

- [ ] **Step 1: Install runtime dependencies**

```bash
pnpm add obscenity use-stick-to-bottom
```

- [ ] **Step 2: Verify**

```bash
pnpm list obscenity use-stick-to-bottom
```

Both must appear under `dependencies` (not `devDependencies`).

- [ ] **Step 3: Commit**

```bash
git add package.json pnpm-lock.yaml
git commit -m "feat(chat): install obscenity + use-stick-to-bottom"
```

---

## Task 2: Server — profanity filter helper

**Files:**
- Create: `server/_core/profanityFilter.ts`
- Create: `server/_core/profanityFilter.test.ts`

- [ ] **Step 1: Write failing tests**

Create `server/_core/profanityFilter.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { assessProfanity } from "./profanityFilter";

describe("assessProfanity", () => {
  it("returns clean for benign text", () => {
    const result = assessProfanity("hello world");
    expect(result.status).toBe("clean");
    expect(result.block).toBe(false);
  });

  it("flags explicit profanity and blocks", () => {
    const result = assessProfanity("you fucking suck");
    expect(result.status).toBe("flagged");
    expect(result.block).toBe(true);
    expect(result.reason).toBeTruthy();
  });

  it("flags leetspeak variants", () => {
    const result = assessProfanity("f*ck this");
    expect(result.status).toBe("flagged");
    expect(result.block).toBe(true);
  });

  it("does not over-flag normal music vocabulary (allowlist sanity)", () => {
    // Words that overlap with music topics — should NOT be flagged
    for (const phrase of ["hell yeah this song slaps", "damn fine track", "killer beat"]) {
      const result = assessProfanity(phrase);
      expect(result.status).toBe("clean");
    }
  });

  it("handles empty / whitespace input gracefully", () => {
    expect(assessProfanity("").status).toBe("clean");
    expect(assessProfanity("   ").status).toBe("clean");
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

```bash
pnpm test:server -- profanityFilter.test
```

Expected: FAIL — module not found.

- [ ] **Step 3: Implement `profanityFilter.ts`**

Create `server/_core/profanityFilter.ts`:

```ts
// Tier-1 profanity filter. Uses `obscenity` (regex + leetspeak handling)
// to make a binary block/flag decision per message body. Tier-2 (Claude
// Haiku escalation for ambiguous cases) is gated behind an env flag and
// lands in Phase 6 — not used here.
//
// Output contract:
//   - `status: "clean"` — pass; insert with flag_status='clean'
//   - `status: "flagged"` and `block: true` — reject the insert; user sees
//     "Message contains blocked language. Please revise."
//   - `status: "flagged"` and `block: false` — currently not produced by
//     Tier 1; reserved for future tuning that lets borderline content
//     through with flag_status='flagged'.

import {
  RegExpMatcher,
  englishDataset,
  englishRecommendedTransformers,
} from "obscenity";

const matcher = new RegExpMatcher({
  ...englishDataset.build(),
  ...englishRecommendedTransformers,
});

const ALLOWLIST = new Set<string>([
  // Music vocabulary that the default obscenity dictionary would otherwise flag.
  "hell", "hells", "damn", "damned", "killer",
]);

export interface ProfanityAssessment {
  status: "clean" | "flagged";
  reason: string | null;
  block: boolean;
}

export function assessProfanity(body: string): ProfanityAssessment {
  const trimmed = body.trim();
  if (trimmed.length === 0) {
    return { status: "clean", reason: null, block: false };
  }

  const matches = matcher.getAllMatches(trimmed);
  if (matches.length === 0) {
    return { status: "clean", reason: null, block: false };
  }

  // Filter out hits whose underlying word is in the allowlist.
  const meaningful = matches.filter((m) => {
    const metadata = englishDataset.getPayloadWithPhraseMetadata(m);
    const word = metadata.phraseMetadata?.originalWord ?? "";
    return !ALLOWLIST.has(word.toLowerCase());
  });

  if (meaningful.length === 0) {
    return { status: "clean", reason: null, block: false };
  }

  return {
    status: "flagged",
    reason: `matched: ${meaningful.length} term(s)`,
    block: true,
  };
}
```

- [ ] **Step 4: Run tests to verify they pass**

```bash
pnpm test:server -- profanityFilter.test
```

Expected: PASS — 5 of 5 cases.

- [ ] **Step 5: Run typecheck**

```bash
pnpm check
```

Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add server/_core/profanityFilter.ts server/_core/profanityFilter.test.ts
git commit -m "feat(chat): tier-1 profanity filter wrapping obscenity"
```

---

## Task 3: Server — chat.postMessage mutation

**Files:**
- Modify: `server/routers/chat.ts`
- Create: `server/routers/chat.endpoints.test.ts`

- [ ] **Step 1: Write failing tests**

Create `server/routers/chat.endpoints.test.ts`:

```ts
import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";

// Mock Stripe so importing appRouter doesn't require STRIPE_SECRET_KEY.
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
import { chatMessages, chatBans, users } from "../../drizzle/schema";
import { eq } from "drizzle-orm";

const DB_URL =
  process.env.SUPABASE_SESSION_POOLER_STRING ??
  process.env.SUPABASE_DIRECT_CONNECTION_STRING ??
  process.env.DATABASE_URL;
const liveDescribe = DB_URL ? describe : describe.skip;

const stamp = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

liveDescribe("chat.postMessage", () => {
  let userId: number;
  let adminId: number;

  beforeAll(async () => {
    const db = await getDb();
    const [u] = await db!.insert(users).values({
      openId: `chat-endpoints-user-${stamp}`,
      email: `chat-endpoints-user-${stamp}@example.com`,
      loginMethod: "vitest",
      role: "user",
    }).returning();
    userId = u.id;
    const [a] = await db!.insert(users).values({
      openId: `chat-endpoints-admin-${stamp}`,
      email: `chat-endpoints-admin-${stamp}@example.com`,
      loginMethod: "vitest",
      role: "admin",
    }).returning();
    adminId = a.id;
  });

  afterAll(async () => {
    const db = await getDb();
    await db!.delete(chatMessages).where(eq(chatMessages.authorId, userId));
    await db!.delete(chatMessages).where(eq(chatMessages.authorId, adminId));
    await db!.delete(chatBans).where(eq(chatBans.userId, userId));
    // users + their audit-log rows are left behind (immutable + FK).
  });

  const callerFor = (id: number, role: "user" | "admin") =>
    appRouter.createCaller({
      user: { id, role, email: `${id}@example.com` },
      req: { ip: "127.0.0.1" } as never,
      requestId: stamp,
      ip: "127.0.0.1",
      userAgent: "vitest",
    } as never);

  it("inserts a clean message and returns the row", async () => {
    const caller = callerFor(userId, "user");
    const result = await caller.chat.postMessage({
      scope: "global",
      roomId: 1,
      body: "hello phase 2",
    });
    expect(result.id).toBeGreaterThan(0);
    expect(result.scope).toBe("global");
    expect(result.body).toBe("hello phase 2");
    expect(result.flag_status ?? result.flagStatus).toBe("clean");
  });

  it("rejects when user is globally banned", async () => {
    const db = await getDb();
    await db!.insert(chatBans).values({
      userId: userId,
      scope: "global",
      action: "ban",
      reason: "test",
      createdBy: adminId,
    });
    const caller = callerFor(userId, "user");
    await expect(
      caller.chat.postMessage({ scope: "global", roomId: 1, body: "should fail" }),
    ).rejects.toThrow(/banned/i);
  });

  it("rejects profanity at the publish layer", async () => {
    // Clear the ban from the previous test
    const db = await getDb();
    await db!.delete(chatBans).where(eq(chatBans.userId, userId));

    const caller = callerFor(userId, "user");
    await expect(
      caller.chat.postMessage({ scope: "global", roomId: 1, body: "fucking trash" }),
    ).rejects.toThrow(/blocked|profanity|revise/i);
  });

  it("treats visible mute as a hard rejection", async () => {
    const db = await getDb();
    await db!.delete(chatBans).where(eq(chatBans.userId, userId));
    await db!.insert(chatBans).values({
      userId: userId,
      scope: "global",
      action: "mute_visible",
      reason: "test",
      createdBy: adminId,
    });
    const caller = callerFor(userId, "user");
    await expect(
      caller.chat.postMessage({ scope: "global", roomId: 1, body: "muted post" }),
    ).rejects.toThrow(/can't post|muted/i);
  });

  it("treats shadow mute as an apparent success but flags the row", async () => {
    const db = await getDb();
    await db!.delete(chatBans).where(eq(chatBans.userId, userId));
    await db!.insert(chatBans).values({
      userId: userId,
      scope: "global",
      action: "mute_shadow",
      reason: "test",
      createdBy: adminId,
    });
    const caller = callerFor(userId, "user");
    const result = await caller.chat.postMessage({
      scope: "global",
      roomId: 1,
      body: "shadow-muted message",
    });
    expect(result.id).toBeGreaterThan(0);
    expect((result as { postedWhileShadowBanned?: boolean; posted_while_shadow_banned?: boolean }).postedWhileShadowBanned
        ?? (result as Record<string, unknown>).posted_while_shadow_banned).toBe(true);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

```bash
set -a; source .env; set +a; pnpm test:server -- chat.endpoints.test
```

Expected: FAIL — `chat.postMessage` doesn't exist yet.

- [ ] **Step 3: Implement `chat.postMessage`**

Edit `server/routers/chat.ts`. Replace the existing empty router body with:

```ts
// Chat tRPC router. Phase 1 landed the skeleton + ban-check middleware.
// Phase 2 adds the Global-tab user-facing endpoints + minimal admin moderation.
import { z } from "zod";
import { TRPCError } from "@trpc/server";
import { and, eq, sql, lt, gt, desc, isNull } from "drizzle-orm";
import { router, protectedProcedure, adminProcedure } from "../_core/trpc";
import { getDb } from "../db";
import {
  chatMessages,
  chatBans,
  chatRoomMembers,
  chatFriendsReadState,
  chatAuditLog,
  type ChatMessage as ChatMessageRow,
} from "../../drizzle/schema";
import { getActiveBan } from "../_core/chatBans";
import { enforceChatRateLimit } from "../_core/chatRateLimit";
import { assessProfanity } from "../_core/profanityFilter";
import { recordChatAction } from "../_core/chatAudit";

const ScopeEnum = z.enum(["global", "tournament", "friends"]);

async function ensureNotGloballyBanned(userId: number): Promise<void> {
  const ban = await getActiveBan(userId, { kind: "global" });
  if (!ban) return;
  if (ban.action === "ban") {
    throw new TRPCError({ code: "FORBIDDEN", message: "You are banned from chat." });
  }
  if (ban.action === "mute_visible") {
    throw new TRPCError({ code: "FORBIDDEN", message: "You can't post here." });
  }
  // mute_shadow falls through — caller handles it specially when inserting.
}

export const chatRouter = router({
  postMessage: protectedProcedure
    .input(
      z.object({
        scope: ScopeEnum,
        roomId: z.number().int().optional(),
        body: z.string().min(1).max(1000),
      }),
    )
    .mutation(async ({ input, ctx }) => {
      const db = await getDb();
      if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "DB unavailable" });

      // 1. Rate limit (no-op if UPSTASH env not set)
      await enforceChatRateLimit(`chat:post:${ctx.user.id}`);

      // 2. Ban/mute check (global + per-room)
      await ensureNotGloballyBanned(ctx.user.id);
      let shadowMuted = false;
      const globalBan = await getActiveBan(ctx.user.id, { kind: "global" });
      if (globalBan?.action === "mute_shadow") shadowMuted = true;

      if (input.scope === "tournament" || input.scope === "global") {
        if (input.roomId == null) {
          throw new TRPCError({ code: "BAD_REQUEST", message: "roomId required for this scope" });
        }
        const roomBan = await getActiveBan(ctx.user.id, { kind: "room", roomId: input.roomId });
        if (roomBan && roomBan.action === "ban") {
          throw new TRPCError({ code: "FORBIDDEN", message: "You are banned from this room." });
        }
        if (roomBan && roomBan.action === "mute_visible") {
          throw new TRPCError({ code: "FORBIDDEN", message: "You can't post here." });
        }
        if (roomBan && roomBan.action === "mute_shadow") shadowMuted = true;
      }

      // 3. Profanity (Tier 1)
      const profanity = assessProfanity(input.body);
      if (profanity.block) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: "Message contains blocked language. Please revise.",
        });
      }

      // 4. Insert
      const [inserted] = await db
        .insert(chatMessages)
        .values({
          scope: input.scope,
          roomId: input.scope === "friends" ? null : input.roomId!,
          authorId: ctx.user.id,
          body: input.body,
          postedWhileShadowBanned: shadowMuted,
          flagStatus: profanity.status === "flagged" ? "flagged" : "clean",
          flagReason: profanity.reason,
        })
        .returning();

      return inserted;
    }),
});
```

This is just the `postMessage` procedure for now; subsequent tasks add `fetchInitial`, `fetchOlder`, `fetchSince`, `markRead`, `unreadCounts`, and admin sub-router. The trailing closing brace + paren is intentional — the router body will be extended.

- [ ] **Step 4: Run tests to verify they pass**

```bash
set -a; source .env; set +a; pnpm test:server -- chat.endpoints.test
```

Expected: 5 / 5 PASS.

- [ ] **Step 5: Run typecheck**

```bash
pnpm check
```

Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add server/routers/chat.ts server/routers/chat.endpoints.test.ts
git commit -m "feat(chat): chat.postMessage with ban/mute/profanity/rate-limit guards"
```

---

## Task 4: Server — fetch queries (initial / older / since)

**Files:**
- Modify: `server/routers/chat.ts`
- Modify: `server/routers/chat.endpoints.test.ts`

- [ ] **Step 1: Append failing tests**

Append to `server/routers/chat.endpoints.test.ts` BEFORE the closing `});` of `liveDescribe`:

```ts
liveDescribe("chat fetch queries", () => {
  let readerId: number;
  let posterId: number;

  beforeAll(async () => {
    const db = await getDb();
    const ts = `${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
    const [r] = await db!.insert(users).values({
      openId: `chat-fetch-reader-${ts}`,
      email: `chat-fetch-reader-${ts}@example.com`,
      loginMethod: "vitest",
      role: "user",
    }).returning();
    readerId = r.id;
    const [p] = await db!.insert(users).values({
      openId: `chat-fetch-poster-${ts}`,
      email: `chat-fetch-poster-${ts}@example.com`,
      loginMethod: "vitest",
      role: "user",
    }).returning();
    posterId = p.id;

    // Seed 5 messages in the global room
    for (let i = 1; i <= 5; i++) {
      await db!.insert(chatMessages).values({
        scope: "global",
        roomId: 1,
        authorId: posterId,
        body: `fetch-test message ${i}`,
      });
    }
  });

  afterAll(async () => {
    const db = await getDb();
    await db!.delete(chatMessages).where(eq(chatMessages.authorId, posterId));
  });

  const callerFor = (id: number) =>
    appRouter.createCaller({
      user: { id, role: "user", email: `${id}@example.com` },
      req: { ip: "127.0.0.1" } as never,
      ip: "127.0.0.1",
      userAgent: "vitest",
    } as never);

  it("fetchInitial returns the most-recent messages (descending by id)", async () => {
    const caller = callerFor(readerId);
    const result = await caller.chat.fetchInitial({ scope: "global", roomId: 1, limit: 10 });
    expect(result.messages.length).toBeGreaterThanOrEqual(5);
    // Descending id (newest first)
    for (let i = 0; i < result.messages.length - 1; i++) {
      expect(result.messages[i].id).toBeGreaterThanOrEqual(result.messages[i + 1].id);
    }
    expect(result.lastSeenSeq).toBe(result.messages[0]?.id ?? 0);
  });

  it("fetchOlder paginates correctly with beforeId", async () => {
    const caller = callerFor(readerId);
    const first = await caller.chat.fetchInitial({ scope: "global", roomId: 1, limit: 2 });
    const second = await caller.chat.fetchOlder({
      scope: "global",
      roomId: 1,
      beforeId: first.messages[first.messages.length - 1].id,
      limit: 2,
    });
    expect(second.length).toBeGreaterThan(0);
    // All returned messages must have id < the oldest from `first`
    for (const m of second) {
      expect(m.id).toBeLessThan(first.messages[first.messages.length - 1].id);
    }
  });

  it("fetchSince returns only messages newer than lastSeenSeq", async () => {
    const caller = callerFor(readerId);
    const initial = await caller.chat.fetchInitial({ scope: "global", roomId: 1, limit: 1 });
    const newerOnly = await caller.chat.fetchSince({
      scope: "global",
      roomId: 1,
      lastSeenSeq: initial.messages[0]?.id ?? 0,
    });
    // Expect 0 because we just took the newest; nothing newer exists
    expect(newerOnly.length).toBe(0);

    // Post one more and re-check
    const posterCaller = callerFor(posterId);
    await posterCaller.chat.postMessage({ scope: "global", roomId: 1, body: "another one" });
    const afterPost = await caller.chat.fetchSince({
      scope: "global",
      roomId: 1,
      lastSeenSeq: initial.messages[0]?.id ?? 0,
    });
    expect(afterPost.length).toBeGreaterThanOrEqual(1);
  });
});
```

- [ ] **Step 2: Verify tests fail**

```bash
set -a; source .env; set +a; pnpm test:server -- chat.endpoints.test
```

Expected: previous 5 still PASS; new 3 FAIL because the queries don't exist.

- [ ] **Step 3: Add fetch procedures**

Edit `server/routers/chat.ts`. Inside the `router({ ... })` body, AFTER the `postMessage` procedure and BEFORE the closing brace, add:

```ts
  fetchInitial: protectedProcedure
    .input(
      z.object({
        scope: ScopeEnum,
        roomId: z.number().int().optional(),
        limit: z.number().int().min(1).max(100).default(50),
      }),
    )
    .query(async ({ input, ctx }) => {
      const db = await getDb();
      if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "DB unavailable" });
      await ensureNotGloballyBanned(ctx.user.id);

      const where = [
        eq(chatMessages.scope, input.scope),
        isNull(chatMessages.deletedAt),
      ];
      if (input.scope !== "friends" && input.roomId != null) {
        where.push(eq(chatMessages.roomId, input.roomId));
      }

      const messages = await db
        .select()
        .from(chatMessages)
        .where(and(...where))
        .orderBy(desc(chatMessages.id))
        .limit(input.limit);

      return {
        messages,
        lastSeenSeq: messages[0]?.id ?? 0,
      };
    }),

  fetchOlder: protectedProcedure
    .input(
      z.object({
        scope: ScopeEnum,
        roomId: z.number().int().optional(),
        beforeId: z.number().int(),
        limit: z.number().int().min(1).max(100).default(50),
      }),
    )
    .query(async ({ input, ctx }) => {
      const db = await getDb();
      if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "DB unavailable" });
      await ensureNotGloballyBanned(ctx.user.id);

      const where = [
        eq(chatMessages.scope, input.scope),
        isNull(chatMessages.deletedAt),
        lt(chatMessages.id, input.beforeId),
      ];
      if (input.scope !== "friends" && input.roomId != null) {
        where.push(eq(chatMessages.roomId, input.roomId));
      }

      const messages = await db
        .select()
        .from(chatMessages)
        .where(and(...where))
        .orderBy(desc(chatMessages.id))
        .limit(input.limit);

      return messages;
    }),

  fetchSince: protectedProcedure
    .input(
      z.object({
        scope: ScopeEnum,
        roomId: z.number().int().optional(),
        lastSeenSeq: z.number().int(),
      }),
    )
    .query(async ({ input, ctx }) => {
      const db = await getDb();
      if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "DB unavailable" });
      await ensureNotGloballyBanned(ctx.user.id);

      const where = [
        eq(chatMessages.scope, input.scope),
        isNull(chatMessages.deletedAt),
        gt(chatMessages.id, input.lastSeenSeq),
      ];
      if (input.scope !== "friends" && input.roomId != null) {
        where.push(eq(chatMessages.roomId, input.roomId));
      }

      const messages = await db
        .select()
        .from(chatMessages)
        .where(and(...where))
        .orderBy(desc(chatMessages.id))
        .limit(200);

      return messages;
    }),
```

- [ ] **Step 4: Run tests, watch them pass**

```bash
set -a; source .env; set +a; pnpm test:server -- chat.endpoints.test
```

Expected: 8 / 8 PASS (5 from Task 3 + 3 from this task).

- [ ] **Step 5: Run typecheck**

```bash
pnpm check
```

Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add server/routers/chat.ts server/routers/chat.endpoints.test.ts
git commit -m "feat(chat): chat.fetchInitial / fetchOlder / fetchSince queries"
```

---

## Task 5: Server — markRead + unreadCounts

**Files:**
- Modify: `server/routers/chat.ts`
- Modify: `server/routers/chat.endpoints.test.ts`

- [ ] **Step 1: Append failing tests**

Append to `server/routers/chat.endpoints.test.ts` (inside the file but outside any other `liveDescribe`):

```ts
liveDescribe("chat.markRead + unreadCounts", () => {
  let userId: number;

  beforeAll(async () => {
    const db = await getDb();
    const ts = `${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
    const [u] = await db!.insert(users).values({
      openId: `chat-markread-${ts}`,
      email: `chat-markread-${ts}@example.com`,
      loginMethod: "vitest",
      role: "user",
    }).returning();
    userId = u.id;
  });

  const callerFor = (id: number) =>
    appRouter.createCaller({
      user: { id, role: "user", email: `${id}@example.com` },
      req: { ip: "127.0.0.1" } as never,
      ip: "127.0.0.1",
      userAgent: "vitest",
    } as never);

  it("markRead upserts chat_room_members row", async () => {
    const caller = callerFor(userId);
    const result = await caller.chat.markRead({
      scope: "global",
      roomId: 1,
      seq: 9999999,
    });
    expect(result.success).toBe(true);

    // Verify the row exists with the right seq
    const db = await getDb();
    const rows = await db!
      .select()
      .from(chatRoomMembers)
      .where(and(eq(chatRoomMembers.userId, userId), eq(chatRoomMembers.roomId, 1)));
    expect(rows.length).toBe(1);
    expect(rows[0].lastReadSeq).toBe(9999999);
  });

  it("unreadCounts returns 0 when last_read_seq is at or past the latest", async () => {
    const caller = callerFor(userId);
    const counts = await caller.chat.unreadCounts();
    expect(counts.global).toBeDefined();
    expect(typeof counts.global).toBe("number");
    expect(counts.global).toBeGreaterThanOrEqual(0);
  });
});
```

Append at the top of the file (with other imports):
```ts
import { chatRoomMembers } from "../../drizzle/schema";
```
(if not already imported)

- [ ] **Step 2: Verify tests fail**

```bash
set -a; source .env; set +a; pnpm test:server -- chat.endpoints.test
```

Expected: previous tests PASS; new 2 FAIL.

- [ ] **Step 3: Add procedures**

Edit `server/routers/chat.ts`. Inside the `router({ ... })` body, AFTER `fetchSince`, add:

```ts
  markRead: protectedProcedure
    .input(
      z.object({
        scope: ScopeEnum,
        roomId: z.number().int().optional(),
        seq: z.number().int().min(0),
      }),
    )
    .mutation(async ({ input, ctx }) => {
      const db = await getDb();
      if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "DB unavailable" });

      if (input.scope === "friends") {
        await db
          .insert(chatFriendsReadState)
          .values({ userId: ctx.user.id, lastReadSeq: input.seq })
          .onConflictDoUpdate({
            target: chatFriendsReadState.userId,
            set: { lastReadSeq: input.seq, lastReadAt: new Date() },
          });
      } else {
        if (input.roomId == null) {
          throw new TRPCError({ code: "BAD_REQUEST", message: "roomId required for this scope" });
        }
        await db
          .insert(chatRoomMembers)
          .values({ userId: ctx.user.id, roomId: input.roomId, lastReadSeq: input.seq })
          .onConflictDoUpdate({
            target: [chatRoomMembers.userId, chatRoomMembers.roomId],
            set: { lastReadSeq: input.seq, lastReadAt: new Date() },
          });
      }

      return { success: true as const };
    }),

  unreadCounts: protectedProcedure.query(async ({ ctx }) => {
    const db = await getDb();
    if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "DB unavailable" });

    // Global: messages with id > last_read_seq for the (user, room=1) tuple.
    const [globalRow] = await db
      .select({ lastSeq: chatRoomMembers.lastReadSeq })
      .from(chatRoomMembers)
      .where(and(eq(chatRoomMembers.userId, ctx.user.id), eq(chatRoomMembers.roomId, 1)));
    const globalLastSeq = globalRow?.lastSeq ?? 0;

    const globalCountRows = await db.execute(sql`
      SELECT COUNT(*)::int AS count
      FROM chat_messages
      WHERE scope = 'global'
        AND room_id = 1
        AND id > ${globalLastSeq}
        AND deleted_at IS NULL
        AND NOT (posted_while_shadow_banned AND author_id != ${ctx.user.id})
    `);
    const globalRows = (globalCountRows as { rows?: Array<{ count: number }> }).rows
      ?? (Array.isArray(globalCountRows) ? (globalCountRows as Array<{ count: number }>) : []);

    return {
      global: globalRows[0]?.count ?? 0,
      friends: 0,         // Phase 3 will fill in
      tournaments: {} as Record<number, number>,  // Phase 4 will fill in
    };
  }),
```

- [ ] **Step 4: Run tests, watch them pass**

```bash
set -a; source .env; set +a; pnpm test:server -- chat.endpoints.test
```

Expected: 10 / 10 PASS.

- [ ] **Step 5: Commit**

```bash
git add server/routers/chat.ts server/routers/chat.endpoints.test.ts
git commit -m "feat(chat): chat.markRead + chat.unreadCounts (global only for phase 2)"
```

---

## Task 6: Server — admin sub-router (delete + ban)

**Files:**
- Modify: `server/routers/chat.ts`
- Modify: `server/routers/chat.endpoints.test.ts`

- [ ] **Step 1: Append failing tests**

Append to `server/routers/chat.endpoints.test.ts`:

```ts
liveDescribe("chat.admin actions", () => {
  let adminId: number;
  let posterId: number;
  let messageId: number;

  beforeAll(async () => {
    const db = await getDb();
    const ts = `${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
    const [a] = await db!.insert(users).values({
      openId: `chat-admin-action-${ts}`,
      email: `chat-admin-action-${ts}@example.com`,
      loginMethod: "vitest",
      role: "admin",
    }).returning();
    adminId = a.id;
    const [p] = await db!.insert(users).values({
      openId: `chat-admin-poster-${ts}`,
      email: `chat-admin-poster-${ts}@example.com`,
      loginMethod: "vitest",
      role: "user",
    }).returning();
    posterId = p.id;

    const [m] = await db!.insert(chatMessages).values({
      scope: "global",
      roomId: 1,
      authorId: posterId,
      body: "to be deleted",
    }).returning();
    messageId = m.id;
  });

  afterAll(async () => {
    const db = await getDb();
    await db!.delete(chatMessages).where(eq(chatMessages.authorId, posterId));
    await db!.delete(chatBans).where(eq(chatBans.userId, posterId));
  });

  const adminCaller = () =>
    appRouter.createCaller({
      user: { id: adminId, role: "admin", email: `admin@example.com` },
      req: { ip: "127.0.0.1" } as never,
      ip: "127.0.0.1",
      userAgent: "vitest",
    } as never);

  const userCaller = () =>
    appRouter.createCaller({
      user: { id: posterId, role: "user", email: `poster@example.com` },
      req: { ip: "127.0.0.1" } as never,
      ip: "127.0.0.1",
      userAgent: "vitest",
    } as never);

  it("admin.deleteMessage soft-deletes the row and writes an audit log entry", async () => {
    const caller = adminCaller();
    const result = await caller.chat.admin.deleteMessage({
      messageId,
      reason: "spam",
    });
    expect(result.success).toBe(true);

    const db = await getDb();
    const [row] = await db!.select().from(chatMessages).where(eq(chatMessages.id, messageId));
    expect(row.deletedAt).not.toBeNull();
    expect(row.deletedBy).toBe(adminId);
    expect(row.deletedReason).toBe("spam");

    const audit = await db!
      .select()
      .from(chatAuditLog)
      .where(and(eq(chatAuditLog.actorId, adminId), eq(chatAuditLog.action, "message_delete")));
    expect(audit.length).toBeGreaterThanOrEqual(1);
  });

  it("non-admin cannot call admin.deleteMessage", async () => {
    const caller = userCaller();
    await expect(
      // @ts-expect-error: non-admin caller should be denied at runtime
      caller.chat.admin.deleteMessage({ messageId, reason: "x" }),
    ).rejects.toThrow();
  });

  it("admin.banAuthor creates a chat_bans row and writes audit log", async () => {
    const caller = adminCaller();
    const result = await caller.chat.admin.banAuthor({
      userId: posterId,
      scope: "global",
      reason: "repeated spam",
    });
    expect(result.banId).toBeGreaterThan(0);

    const db = await getDb();
    const [ban] = await db!.select().from(chatBans).where(eq(chatBans.id, result.banId));
    expect(ban.action).toBe("ban");
    expect(ban.scope).toBe("global");
    expect(ban.createdBy).toBe(adminId);

    const audit = await db!
      .select()
      .from(chatAuditLog)
      .where(and(eq(chatAuditLog.actorId, adminId), eq(chatAuditLog.action, "ban")));
    expect(audit.length).toBeGreaterThanOrEqual(1);
  });
});
```

- [ ] **Step 2: Verify tests fail**

```bash
set -a; source .env; set +a; pnpm test:server -- chat.endpoints.test
```

Expected: previous 10 PASS; new 3 FAIL because `chat.admin` doesn't exist.

- [ ] **Step 3: Add admin sub-router**

Edit `server/routers/chat.ts`. Inside the top-level `router({ ... })` body, AFTER `unreadCounts`, add:

```ts
  admin: router({
    deleteMessage: adminProcedure
      .input(z.object({ messageId: z.number().int(), reason: z.string().min(1) }))
      .mutation(async ({ input, ctx }) => {
        const db = await getDb();
        if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "DB unavailable" });

        await db.transaction(async (tx) => {
          const [updated] = await tx
            .update(chatMessages)
            .set({
              deletedAt: new Date(),
              deletedBy: ctx.user.id,
              deletedReason: input.reason,
            })
            .where(eq(chatMessages.id, input.messageId))
            .returning();
          if (!updated) {
            throw new TRPCError({ code: "NOT_FOUND", message: "Message not found" });
          }
          await recordChatAction({
            tx,
            actorId: ctx.user.id,
            actorRole: "admin",
            action: "message_delete",
            targetMessageId: input.messageId,
            targetUserId: updated.authorId,
            scope: updated.scope,
            roomId: updated.roomId ?? undefined,
            reason: input.reason,
          });
        });

        return { success: true as const };
      }),

    banAuthor: adminProcedure
      .input(
        z.object({
          userId: z.number().int(),
          scope: z.enum(["global", "room"]),
          roomId: z.number().int().optional(),
          expiresAt: z.string().datetime().optional(),
          reason: z.string().min(1),
        }),
      )
      .mutation(async ({ input, ctx }) => {
        const db = await getDb();
        if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "DB unavailable" });
        if (input.scope === "room" && input.roomId == null) {
          throw new TRPCError({ code: "BAD_REQUEST", message: "roomId required for room-scope ban" });
        }

        const banId = await db.transaction(async (tx) => {
          const [ban] = await tx
            .insert(chatBans)
            .values({
              userId: input.userId,
              scope: input.scope,
              roomId: input.scope === "room" ? input.roomId! : null,
              action: "ban",
              reason: input.reason,
              createdBy: ctx.user.id,
              expiresAt: input.expiresAt ? new Date(input.expiresAt) : null,
            })
            .returning({ id: chatBans.id });
          await recordChatAction({
            tx,
            actorId: ctx.user.id,
            actorRole: "admin",
            action: "ban",
            targetUserId: input.userId,
            scope: input.scope,
            roomId: input.roomId ?? undefined,
            reason: input.reason,
            metadata: { expiresAt: input.expiresAt ?? null },
          });
          return ban.id;
        });

        return { banId };
      }),
  }),
```

- [ ] **Step 4: Run tests, watch them pass**

```bash
set -a; source .env; set +a; pnpm test:server -- chat.endpoints.test
```

Expected: 13 / 13 PASS.

- [ ] **Step 5: Commit**

```bash
git add server/routers/chat.ts server/routers/chat.endpoints.test.ts
git commit -m "feat(chat): admin sub-router — deleteMessage + banAuthor with audit log"
```

---

## Task 7: Client — chatStore + useChatChannel hook

**Files:**
- Create: `client/src/lib/chat/chatStore.ts`
- Create: `client/src/lib/chat/useChatChannel.ts`

- [ ] **Step 1: Create the store**

Create `client/src/lib/chat/chatStore.ts`:

```ts
// Minimal in-memory cache of messages per channel topic. Indexed by message
// id so realtime echoes can be deduped against optimistic inserts. NOT a
// React-Query cache — that lives separately for the initial / older fetch
// queries; this store only holds live-streamed messages within a session.
import { useSyncExternalStore } from "react";

export interface ChatMessageShape {
  id: number;
  scope: "global" | "tournament" | "friends";
  roomId: number | null;
  authorId: number;
  body: string;
  postedWhileShadowBanned: boolean;
  flagStatus: "clean" | "flagged" | "flagged_high_confidence" | "reviewed_clean";
  editedAt: string | null;
  deletedAt: string | null;
  deletedBy: number | null;
  deletedReason: string | null;
  createdAt: string;
}

type Topic = string;

const subscribers = new Map<Topic, Set<() => void>>();
const messages = new Map<Topic, Map<number, ChatMessageShape>>();

function notify(topic: Topic): void {
  for (const cb of subscribers.get(topic) ?? []) cb();
}

export function upsertMessage(topic: Topic, msg: ChatMessageShape): void {
  if (!messages.has(topic)) messages.set(topic, new Map());
  messages.get(topic)!.set(msg.id, msg);
  notify(topic);
}

export function applyMessageUpdate(topic: Topic, msg: ChatMessageShape): void {
  upsertMessage(topic, msg);
}

export function getMessages(topic: Topic): ChatMessageShape[] {
  const m = messages.get(topic);
  if (!m) return [];
  return [...m.values()].sort((a, b) => a.id - b.id);
}

export function subscribe(topic: Topic, cb: () => void): () => void {
  if (!subscribers.has(topic)) subscribers.set(topic, new Set());
  subscribers.get(topic)!.add(cb);
  return () => {
    subscribers.get(topic)?.delete(cb);
  };
}

export function useChatMessages(topic: Topic): ChatMessageShape[] {
  return useSyncExternalStore(
    (cb) => subscribe(topic, cb),
    () => getMessages(topic),
    () => getMessages(topic),
  );
}

export function clearTopic(topic: Topic): void {
  messages.delete(topic);
  notify(topic);
}
```

- [ ] **Step 2: Create the channel hook**

Create `client/src/lib/chat/useChatChannel.ts`:

```ts
// Subscribes the local Supabase Realtime client to one chat:* channel and
// dispatches incoming broadcasts into the chatStore. Cleans up on unmount.
// Reconnect-gap fill is the caller's responsibility (use the
// trpc.chat.fetchSince query keyed by lastSeenSeq).
import { useEffect } from "react";
import { supabase } from "@/lib/supabase";
import { upsertMessage, applyMessageUpdate, type ChatMessageShape } from "./chatStore";

type BroadcastPayload = {
  event?: string;
  payload?: { record?: Record<string, unknown>; old_record?: Record<string, unknown> };
};

function rowToShape(row: Record<string, unknown>): ChatMessageShape {
  return {
    id: Number(row.id),
    scope: row.scope as ChatMessageShape["scope"],
    roomId: row.room_id == null ? null : Number(row.room_id),
    authorId: Number(row.author_id),
    body: String(row.body),
    postedWhileShadowBanned: Boolean(row.posted_while_shadow_banned),
    flagStatus: row.flag_status as ChatMessageShape["flagStatus"],
    editedAt: row.edited_at == null ? null : String(row.edited_at),
    deletedAt: row.deleted_at == null ? null : String(row.deleted_at),
    deletedBy: row.deleted_by == null ? null : Number(row.deleted_by),
    deletedReason: row.deleted_reason == null ? null : String(row.deleted_reason),
    createdAt: String(row.createdAt ?? row.created_at),
  };
}

export function useChatChannel(topic: string | null): void {
  useEffect(() => {
    if (!topic) return;

    const ch = supabase.channel(topic, { config: { private: true } });

    ch.on("broadcast", { event: "message_inserted" }, ({ payload }: BroadcastPayload) => {
      const rec = payload?.record;
      if (rec) upsertMessage(topic, rowToShape(rec));
    });
    ch.on("broadcast", { event: "message_updated" }, ({ payload }: BroadcastPayload) => {
      const rec = payload?.record;
      if (rec) applyMessageUpdate(topic, rowToShape(rec));
    });

    ch.subscribe();

    return () => {
      void supabase.removeChannel(ch);
    };
  }, [topic]);
}
```

- [ ] **Step 3: Run typecheck**

```bash
pnpm check
```

Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git add client/src/lib/chat/chatStore.ts client/src/lib/chat/useChatChannel.ts
git commit -m "feat(chat): client chat store + useChatChannel realtime subscription hook"
```

---

## Task 8: Client — ChatMessage + ChatMessageList components

**Files:**
- Create: `client/src/components/chat/ChatMessage.tsx`
- Create: `client/src/components/chat/ChatMessageList.tsx`

- [ ] **Step 1: Create `ChatMessage.tsx`**

Create `client/src/components/chat/ChatMessage.tsx`:

```tsx
import { type ChatMessageShape } from "@/lib/chat/chatStore";
import { MoreHorizontal } from "lucide-react";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Button } from "@/components/ui/button";

interface Props {
  message: ChatMessageShape;
  viewerId: number | null;
  viewerRole: "user" | "admin" | null;
  onAdminDelete?: (messageId: number) => void;
  onAdminBan?: (authorId: number) => void;
}

export function ChatMessage({
  message,
  viewerId,
  viewerRole,
  onAdminDelete,
  onAdminBan,
}: Props) {
  const isMine = viewerId != null && message.authorId === viewerId;
  const isAdmin = viewerRole === "admin";
  const isDeleted = message.deletedAt != null;

  if (isDeleted && !isAdmin && !isMine) {
    return (
      <div className="flex items-center px-3 py-1 text-xs text-muted-foreground italic">
        Message removed by admin.
      </div>
    );
  }

  return (
    <div
      data-message-id={message.id}
      className={`group flex flex-col gap-0.5 px-3 py-1.5 hover:bg-muted/30 ${
        isMine ? "items-end" : "items-start"
      }`}
    >
      <div className="flex items-center gap-2 text-xs text-muted-foreground">
        <span>User #{message.authorId}</span>
        <span>{new Date(message.createdAt).toLocaleTimeString()}</span>
        {message.editedAt && <span>(edited)</span>}
        {isAdmin && (
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button
                variant="ghost"
                size="icon"
                className="h-5 w-5 opacity-0 group-hover:opacity-100"
                aria-label="Admin actions"
              >
                <MoreHorizontal className="h-3.5 w-3.5" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align={isMine ? "end" : "start"}>
              <DropdownMenuItem onClick={() => onAdminDelete?.(message.id)}>
                Delete message
              </DropdownMenuItem>
              <DropdownMenuItem
                onClick={() => onAdminBan?.(message.authorId)}
                className="text-destructive"
              >
                Ban author (global)
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        )}
      </div>
      <div
        className={`max-w-[80%] rounded-2xl px-3 py-1.5 text-sm ${
          isMine ? "bg-primary text-primary-foreground" : "bg-muted text-foreground"
        } ${isDeleted ? "italic opacity-60" : ""}`}
      >
        {isDeleted ? "[message removed by admin]" : message.body}
      </div>
    </div>
  );
}
```

- [ ] **Step 2: Create `ChatMessageList.tsx`**

Create `client/src/components/chat/ChatMessageList.tsx`:

```tsx
import { useEffect, useRef, useState } from "react";
import { StickToBottom } from "use-stick-to-bottom";
import { ChatMessage } from "./ChatMessage";
import { type ChatMessageShape } from "@/lib/chat/chatStore";
import { Button } from "@/components/ui/button";

interface Props {
  messages: ChatMessageShape[];
  viewerId: number | null;
  viewerRole: "user" | "admin" | null;
  onLoadOlder?: () => void;
  hasMoreOlder?: boolean;
  onAdminDelete?: (messageId: number) => void;
  onAdminBan?: (authorId: number) => void;
}

export function ChatMessageList({
  messages,
  viewerId,
  viewerRole,
  onLoadOlder,
  hasMoreOlder,
  onAdminDelete,
  onAdminBan,
}: Props) {
  const scrollableRef = useRef<HTMLDivElement | null>(null);
  const [showNewPill, setShowNewPill] = useState(false);
  const [unseenCount, setUnseenCount] = useState(0);
  const lastSeenIdRef = useRef<number>(0);

  useEffect(() => {
    if (messages.length === 0) return;
    const latestId = messages[messages.length - 1].id;
    if (lastSeenIdRef.current === 0) {
      lastSeenIdRef.current = latestId;
      return;
    }
    if (latestId > lastSeenIdRef.current) {
      const delta = messages.filter((m) => m.id > lastSeenIdRef.current).length;
      setUnseenCount((c) => c + delta);
      setShowNewPill(true);
      lastSeenIdRef.current = latestId;
    }
  }, [messages]);

  const handleScrollToBottom = () => {
    const el = scrollableRef.current;
    if (el) el.scrollTo({ top: el.scrollHeight, behavior: "smooth" });
    setShowNewPill(false);
    setUnseenCount(0);
  };

  return (
    <div className="relative flex-1 min-h-0">
      <StickToBottom className="h-full" resize="smooth" initial="smooth">
        <StickToBottom.Content
          className="flex flex-col py-2"
          // @ts-expect-error — `ref` is passed through to the scroll container
          ref={scrollableRef}
        >
          {hasMoreOlder && (
            <div className="flex justify-center py-2">
              <Button variant="outline" size="sm" onClick={onLoadOlder}>
                Load older messages
              </Button>
            </div>
          )}
          {messages.map((m) => (
            <ChatMessage
              key={m.id}
              message={m}
              viewerId={viewerId}
              viewerRole={viewerRole}
              onAdminDelete={onAdminDelete}
              onAdminBan={onAdminBan}
            />
          ))}
        </StickToBottom.Content>
      </StickToBottom>

      {showNewPill && (
        <button
          onClick={handleScrollToBottom}
          className="absolute bottom-3 left-1/2 -translate-x-1/2 rounded-full bg-primary px-4 py-1.5 text-sm text-primary-foreground shadow-md hover:bg-primary/90"
        >
          {unseenCount} new message{unseenCount === 1 ? "" : "s"} - jump to bottom
        </button>
      )}
    </div>
  );
}
```

- [ ] **Step 3: Run typecheck**

```bash
pnpm check
```

Expected: PASS. If `use-stick-to-bottom` complains about its `ref` prop, switch the JSX to use the lib's typed scrollable child (consult its README in `node_modules/use-stick-to-bottom/README.md` if needed). The `@ts-expect-error` line above is intentional and documents the workaround.

- [ ] **Step 4: Commit**

```bash
git add client/src/components/chat/ChatMessage.tsx client/src/components/chat/ChatMessageList.tsx
git commit -m "feat(chat): ChatMessage + ChatMessageList components"
```

---

## Task 9: Client — ChatComposer component

**Files:**
- Create: `client/src/components/chat/ChatComposer.tsx`

- [ ] **Step 1: Create `ChatComposer.tsx`**

Create `client/src/components/chat/ChatComposer.tsx`:

```tsx
import { useState, type FormEvent, type KeyboardEvent } from "react";
import { Send } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";

interface Props {
  onSend: (body: string) => Promise<void>;
  disabledReason?: string | null;
}

const MAX_LENGTH = 1000;

export function ChatComposer({ onSend, disabledReason }: Props) {
  const [draft, setDraft] = useState("");
  const [submitting, setSubmitting] = useState(false);

  const trimmed = draft.trim();
  const disabled = submitting || trimmed.length === 0 || disabledReason != null;

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (disabled) return;
    setSubmitting(true);
    try {
      await onSend(trimmed);
      setDraft("");
    } finally {
      setSubmitting(false);
    }
  };

  const handleKeyDown = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      void submit(e as unknown as FormEvent);
    }
  };

  return (
    <form
      onSubmit={submit}
      className="chat-safe-area-bottom flex items-end gap-2 border-t bg-background px-3 py-2"
    >
      <div className="flex-1">
        <Textarea
          value={draft}
          onChange={(e) => setDraft(e.target.value.slice(0, MAX_LENGTH))}
          onKeyDown={handleKeyDown}
          placeholder={disabledReason ?? "Message..."}
          disabled={disabledReason != null || submitting}
          rows={1}
          className="resize-none min-h-9 max-h-32"
        />
        <div className="flex justify-between text-xs text-muted-foreground pt-0.5">
          <span>{disabledReason}</span>
          <span>{draft.length}/{MAX_LENGTH}</span>
        </div>
      </div>
      <Button type="submit" size="icon" disabled={disabled} aria-label="Send">
        <Send className="h-4 w-4" />
      </Button>
    </form>
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
git add client/src/components/chat/ChatComposer.tsx
git commit -m "feat(chat): ChatComposer with character counter + Enter-to-send"
```

---

## Task 10: Client — ChatTabs (Global only) + ChatPanel container

**Files:**
- Create: `client/src/components/chat/ChatTabs.tsx`
- Create: `client/src/components/chat/ChatPanel.tsx`

- [ ] **Step 1: Create `ChatTabs.tsx`**

Create `client/src/components/chat/ChatTabs.tsx`:

```tsx
import { useEffect, useMemo, useState } from "react";
import { useAuth } from "@/_core/hooks/useAuth";
import { trpc } from "@/lib/trpc";
import { useChatChannel } from "@/lib/chat/useChatChannel";
import { useChatMessages, upsertMessage } from "@/lib/chat/chatStore";
import { ChatMessageList } from "./ChatMessageList";
import { ChatComposer } from "./ChatComposer";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { toast } from "sonner";

const GLOBAL_TOPIC = "chat:global";
const GLOBAL_ROOM_ID = 1;

export function ChatTabs() {
  const { user } = useAuth();
  const [tab, setTab] = useState<"global">("global");

  // Subscribe to the global realtime channel
  useChatChannel(tab === "global" ? GLOBAL_TOPIC : null);

  // Initial fetch (newest 50)
  const initial = trpc.chat.fetchInitial.useQuery(
    { scope: "global", roomId: GLOBAL_ROOM_ID, limit: 50 },
    { staleTime: 60_000 },
  );

  // Hydrate the store with the initial fetch results
  useEffect(() => {
    if (!initial.data?.messages) return;
    for (const m of initial.data.messages) {
      upsertMessage(GLOBAL_TOPIC, {
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
  }, [initial.data]);

  const messages = useChatMessages(GLOBAL_TOPIC);
  const ordered = useMemo(() => messages, [messages]);

  const postMutation = trpc.chat.postMessage.useMutation();
  const deleteMutation = trpc.chat.admin.deleteMessage.useMutation();
  const banMutation = trpc.chat.admin.banAuthor.useMutation();

  const handleSend = async (body: string) => {
    try {
      const result = await postMutation.mutateAsync({
        scope: "global",
        roomId: GLOBAL_ROOM_ID,
        body,
      });
      // Optimistic upsert; realtime echo will be deduped by id
      upsertMessage(GLOBAL_TOPIC, {
        id: Number(result.id),
        scope: "global",
        roomId: GLOBAL_ROOM_ID,
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

  const handleAdminDelete = async (messageId: number) => {
    const reason = prompt("Reason for deletion?");
    if (!reason) return;
    try {
      await deleteMutation.mutateAsync({ messageId, reason });
      toast.success("Message deleted");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Delete failed");
    }
  };

  const handleAdminBan = async (authorId: number) => {
    const reason = prompt(`Reason for banning user #${authorId} globally?`);
    if (!reason) return;
    try {
      await banMutation.mutateAsync({ userId: authorId, scope: "global", reason });
      toast.success(`User #${authorId} banned`);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Ban failed");
    }
  };

  return (
    <Tabs value={tab} onValueChange={(v) => setTab(v as "global")} className="flex flex-col h-full">
      <TabsList className="grid grid-cols-1 mx-3 mt-3">
        <TabsTrigger value="global">Global</TabsTrigger>
      </TabsList>
      <TabsContent value="global" className="flex flex-col flex-1 min-h-0 mt-2">
        <ChatMessageList
          messages={ordered}
          viewerId={user?.id ?? null}
          viewerRole={user?.role ?? null}
          onAdminDelete={handleAdminDelete}
          onAdminBan={handleAdminBan}
        />
        <ChatComposer
          onSend={handleSend}
          disabledReason={user ? null : "Sign in to chat"}
        />
      </TabsContent>
    </Tabs>
  );
}
```

- [ ] **Step 2: Create `ChatPanel.tsx`**

Create `client/src/components/chat/ChatPanel.tsx`:

```tsx
import { useEffect, useState } from "react";
import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { ChatTabs } from "./ChatTabs";

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

function useIsMobile(): boolean {
  const [mobile, setMobile] = useState(false);
  useEffect(() => {
    const mq = window.matchMedia("(max-width: 767px)");
    const update = () => setMobile(mq.matches);
    update();
    mq.addEventListener("change", update);
    return () => mq.removeEventListener("change", update);
  }, []);
  return mobile;
}

export function ChatPanel({ open, onOpenChange }: Props) {
  const mobile = useIsMobile();
  if (mobile) {
    // Mobile takes the full-page route at /chat — Panel is desktop-only.
    return null;
  }
  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent side="right" className="w-[440px] max-w-full p-0 flex flex-col">
        <SheetHeader className="border-b px-4 py-3">
          <SheetTitle>Chat</SheetTitle>
        </SheetHeader>
        <div className="flex-1 min-h-0">
          <ChatTabs />
        </div>
      </SheetContent>
    </Sheet>
  );
}
```

- [ ] **Step 3: Run typecheck + client tests**

```bash
pnpm check
pnpm test:client
```

Expected: PASS. The Textarea component may not exist at `@/components/ui/textarea` — grep `client/src/components/ui/textarea.tsx`. If missing, surface as NEEDS_CONTEXT (the shadcn `add textarea` command will install it).

- [ ] **Step 4: Commit**

```bash
git add client/src/components/chat/ChatTabs.tsx client/src/components/chat/ChatPanel.tsx
git commit -m "feat(chat): ChatTabs (global only) + responsive ChatPanel (sheet on desktop)"
```

---

## Task 11: Client — /chat route + PersistentHeader chat icon

**Files:**
- Create: `client/src/pages/Chat.tsx`
- Modify: `client/src/App.tsx`
- Modify: `client/src/components/PersistentHeader.tsx`

- [ ] **Step 1: Create the mobile /chat page**

Create `client/src/pages/Chat.tsx`:

```tsx
import { ChatTabs } from "@/components/chat/ChatTabs";

export default function ChatPage() {
  return (
    <div className="flex flex-col chat-viewport-height">
      <ChatTabs />
    </div>
  );
}
```

- [ ] **Step 2: Register the /chat route in App.tsx**

Edit `client/src/App.tsx`. Find the existing `<Switch>` block with the project's routes. Add this route alongside the others (alphabetical or grouped by feature is fine; match the existing convention):

```tsx
import ChatPage from "@/pages/Chat";

// Inside the <Switch>:
<Route path="/chat" component={ChatPage} />
```

Also, add a `ChatPanel` instance at the App-level so it can be opened from the persistent header:

```tsx
import { ChatPanel } from "@/components/chat/ChatPanel";
import { useState } from "react";

// Inside App component:
const [chatOpen, setChatOpen] = useState(false);
// ...somewhere in the JSX (alongside the Toaster):
<ChatPanel open={chatOpen} onOpenChange={setChatOpen} />
```

The persistent header (next step) needs to TOGGLE `chatOpen`. Pass `setChatOpen` down via React context or lift the trigger up — simplest: create a tiny `client/src/lib/chat/chatPanelStore.ts` (4 lines, a `useSyncExternalStore` boolean) and have both App.tsx and PersistentHeader read/write it. Below is that store.

- [ ] **Step 3: Create the chatPanelStore**

Create `client/src/lib/chat/chatPanelStore.ts`:

```ts
import { useSyncExternalStore } from "react";

let open = false;
const listeners = new Set<() => void>();

export function isChatPanelOpen(): boolean {
  return open;
}

export function setChatPanelOpen(next: boolean): void {
  if (open === next) return;
  open = next;
  for (const l of listeners) l();
}

export function useChatPanelOpen(): [boolean, (next: boolean) => void] {
  const value = useSyncExternalStore(
    (cb) => {
      listeners.add(cb);
      return () => listeners.delete(cb);
    },
    isChatPanelOpen,
    isChatPanelOpen,
  );
  return [value, setChatPanelOpen];
}
```

Wire App.tsx to use this:
```tsx
import { useChatPanelOpen } from "@/lib/chat/chatPanelStore";
// inside App:
const [chatOpen, setChatOpen] = useChatPanelOpen();
// ...
<ChatPanel open={chatOpen} onOpenChange={setChatOpen} />
```

- [ ] **Step 4: Add the chat icon to PersistentHeader**

Edit `client/src/components/PersistentHeader.tsx`. Add an icon button next to the user avatar. Use `MessageSquare` from `lucide-react`. Wire it:

```tsx
import { MessageSquare } from "lucide-react";
import { useLocation } from "wouter";
import { trpc } from "@/lib/trpc";
import { useChatPanelOpen } from "@/lib/chat/chatPanelStore";

// Inside the component, before the return JSX:
const [, setChatOpen] = useChatPanelOpen();
const [, navigate] = useLocation();
const unread = trpc.chat.unreadCounts.useQuery(undefined, {
  refetchOnWindowFocus: true,
  staleTime: 30_000,
});
const totalUnread = (unread.data?.global ?? 0)
  + (unread.data?.friends ?? 0)
  + Object.values(unread.data?.tournaments ?? {}).reduce((a, b) => a + b, 0);
const isMobile = typeof window !== "undefined" && window.matchMedia("(max-width: 767px)").matches;
const handleChatClick = () => {
  if (isMobile) navigate("/chat");
  else setChatOpen(true);
};
```

Then inside the JSX where the avatar lives, add (place to the LEFT of the avatar, with `gap-2`):
```tsx
<button
  onClick={handleChatClick}
  className="relative flex items-center justify-center h-9 w-9 rounded-full hover:bg-muted"
  aria-label="Open chat"
>
  <MessageSquare className="h-4 w-4" />
  {totalUnread > 0 && (
    <span className="absolute -top-1 -right-1 min-w-[18px] h-[18px] rounded-full bg-primary text-primary-foreground text-[10px] font-semibold flex items-center justify-center px-1">
      {totalUnread > 99 ? "99+" : totalUnread}
    </span>
  )}
</button>
```

If the PersistentHeader is rendered for unauthenticated users, gate the icon on `useAuth().isAuthenticated` — `unreadCounts` is a `protectedProcedure` and will error for anonymous users.

- [ ] **Step 5: Run typecheck + client tests**

```bash
pnpm check
pnpm test:client
```

Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add client/src/App.tsx client/src/pages/Chat.tsx client/src/components/PersistentHeader.tsx client/src/lib/chat/chatPanelStore.ts
git commit -m "feat(chat): /chat route + persistent-header chat icon with unread badge"
```

---

## Task 12: End-to-end manual verification

**Files:** none — purely a smoke check before declaring Phase 2 done.

- [ ] **Step 1: Start the dev server**

```bash
pnpm dev
```

Expected: server boots on its usual port; client served via Vite. No build errors in the console.

- [ ] **Step 2: Hit `/chat` in a browser as an authed user**

Open the dev URL, sign in (or use the dev test user pattern in the existing project — search the codebase for `DEV_USER_OPEN_ID`). Navigate to `/chat`. You should see:
- A tab strip with one "Global" tab.
- An empty message list (or some seeded messages from earlier tests).
- A composer at the bottom.

Type "hello phase 2" and hit Enter. The message should appear immediately (optimistic) and persist after a refresh.

- [ ] **Step 3: Verify unread badge on PersistentHeader**

Mark a few messages as unread by directly inserting into `chat_messages` (or by waiting for someone else to post). The header's MessageSquare icon should show the unread count. Click the icon — on desktop it opens the slide-over Sheet; on mobile (resize the browser to <768px) it navigates to `/chat`.

- [ ] **Step 4: Verify admin actions (if the dev user is admin)**

If the dev user has `role='admin'`, hover over a message — the `•••` menu should appear. Click "Delete message" → fill the reason → confirm. The message renders as a tombstone for non-admins (try with a second browser logged in as a non-admin user). Audit log should have a new row (query `SELECT * FROM chat_audit_log ORDER BY id DESC LIMIT 5`).

- [ ] **Step 5: Verify realtime delivery**

Open two browsers side-by-side, both authed. Post a message from browser A. It should appear in browser B within ~1 second WITHOUT a refresh.

- [ ] **Step 6: Verify the partition warning is harmless**

In the dev server console, look for `ErrorSendingBroadcastMessage: no partition of relation "messages" found for row`. This is the expected Supabase Realtime infrastructure warning surfaced during Phase 1; the message INSERT itself completes. If broadcasts visibly fail to reach the other client, document the symptom — it's the partition issue and Supabase has it covered on their side (the partition exists after a few minutes; broadcasts work once the time bucket rolls).

- [ ] **Step 7: Document the verification result**

Write a short markdown summary to `docs/superpowers/RESUME-chat-phase2.md` or similar — list which scenarios passed, which failed, any production deltas needed. This document supports the user's review before invoking Phase 3.

There is no commit for this task; it's a pure verification gate. If anything fails, surface DONE_WITH_CONCERNS or BLOCKED and ask before declaring Phase 2 complete.

---

## Phase 2 done. Phase 3 preview

Phase 2 ships the working Global chat tab end-to-end: posting, infinite scroll, realtime delivery, optimistic UI, unread badges, admin delete + global ban.

Phase 3 will add:
- `user_favorites` mutations: `favorites.add` / `favorites.remove` / `favorites.list` / `favorites.countForUser` / `favorites.followerCountForMe`
- Heart-icon button on each Leaderboard row with the 100-favorite cap enforced
- A new "Friends" tab in `ChatTabs` that reads from the Friends-feed inbox channel and renders messages from `{self} + favorites`
- The inbox-pattern fan-out trigger is already in place (Phase 1 migration); Phase 3 only adds the favorites surface + Friends-tab UI

The chat surface, store, and channel hook from Phase 2 are reused as-is. The architectural surface in Phase 3 is small.
