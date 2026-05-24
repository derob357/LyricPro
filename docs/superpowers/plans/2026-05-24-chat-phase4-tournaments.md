# Chat System — Phase 4: Tournaments + GN-paid Entry — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship the monetized tournament feature — admins create tournaments with start/end dates and GN entry cost; users pay GN to join via an atomic transaction; tournament members get a dedicated chat tab; admins can transition tournament status (open / in_progress / completed / cancelled) and refund GN on cancellation.

**Architecture:** A new `tournamentsRouter` exposes user-facing procedures (list, getById, myMemberships, payEntry). A new `tournamentsAdminRouter` (under `tournaments.admin`) exposes admin CRUD + lifecycle transitions + member management. The GN-spend logic is extracted into a reusable helper (`server/_core/goldenNotesLedger.ts`) called by both the existing `goldenNotes.spend` mutation and the new `tournaments.payEntry` mutation — keeping the race-safe decrement pattern in one place. The Phase 1 broadcast triggers already fan tournament-scope messages out to `chat:tournament:<chat_room_id>`. Phase 4 just wires the client to subscribe via the same `useChatChannel` hook from Phase 2 and adds a Tournament tab (with a sub-dropdown when the user is in >1 tournament).

**Tech Stack:** All of Phases 1-3 reused. No new dependencies. Adds two `goldenNoteTransactions.kind` enum values (`refund`, `admin_adjustment` — both already exist in the enum from prior migrations).

**Reference spec:** [docs/superpowers/specs/2026-05-24-chat-system-design.md](../specs/2026-05-24-chat-system-design.md). Section 7 covers tournament lifecycle, entry flow, and refunds.

---

## File structure

### Server

- Create: `server/_core/goldenNotesLedger.ts` — `spendGoldenNotes(tx, userId, cost, kind, reason)` and `creditGoldenNotes(tx, userId, amount, kind, reason, relatedUserId?)` helpers. Race-safe decrement, transaction-scoped, returns `{ newBalance }`.
- Create: `server/_core/goldenNotesLedger.test.ts` — unit + integration tests for both helpers.
- Modify: `server/routers/goldenNotes.ts` — refactor `spend` to call `spendGoldenNotes` instead of duplicating the UPDATE logic. Behavior is unchanged for callers.
- Create: `server/routers/tournaments.ts` — user-facing router (`list`, `getById`, `myMemberships`, `payEntry`) + admin sub-router (`create`, `update`, `openTournament`, `startTournament`, `completeTournament`, `cancelTournament`, `addMember`, `removeMember`).
- Create: `server/routers/tournaments.test.ts` — integration tests for the user-facing procedures.
- Create: `server/routers/tournaments.admin.test.ts` — integration tests for admin transitions + member management + refund flow.
- Modify: `server/app-router.ts` — register `tournaments: tournamentsRouter`.
- Modify: `server/routers/chat.ts` — extend `unreadCounts` to compute per-tournament counts for the viewer's active memberships.

### Client

- Create: `client/src/pages/Tournaments.tsx` — public `/tournaments` discovery page. Lists open tournaments with name, dates, entry cost, capacity, and "Join (X GN)" or "Joined" / "Tournament full" buttons.
- Create: `client/src/pages/admin/TournamentsList.tsx` — admin list at `/admin/tournaments`.
- Create: `client/src/pages/admin/TournamentNew.tsx` — admin create form at `/admin/tournaments/new`.
- Create: `client/src/pages/admin/TournamentEdit.tsx` — admin edit form + lifecycle transition buttons + member roster at `/admin/tournaments/:id`.
- Modify: `client/src/App.tsx` — register the three new routes.
- Modify: `client/src/components/chat/ChatTabs.tsx` — add Tournament tab; sub-dropdown for >1 tournament; empty state when 0 memberships.

### No migration

The `tournaments` and `tournament_members` tables, plus the `chat_room_kind = 'tournament'` enum value, were created by Phase 1's migration 0013. Phase 4 only adds router and UI surface.

---

## Task 1: Server — extract GN ledger helpers

**Files:**
- Create: `server/_core/goldenNotesLedger.ts`
- Create: `server/_core/goldenNotesLedger.test.ts`
- Modify: `server/routers/goldenNotes.ts`

- [ ] **Step 1: Write failing tests**

Create `server/_core/goldenNotesLedger.test.ts`:

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

import { getDb } from "../db";
import {
  users,
  goldenNoteBalances,
  goldenNoteTransactions,
} from "../../drizzle/schema";
import { eq, inArray } from "drizzle-orm";
import { spendGoldenNotes, creditGoldenNotes } from "./goldenNotesLedger";

const DB_URL =
  process.env.SUPABASE_SESSION_POOLER_STRING ??
  process.env.SUPABASE_DIRECT_CONNECTION_STRING ??
  process.env.DATABASE_URL;
const liveDescribe = DB_URL ? describe : describe.skip;

const stamp = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

liveDescribe("goldenNotesLedger", () => {
  let userId: number;

  beforeAll(async () => {
    const db = await getDb();
    const [u] = await db!.insert(users).values({
      openId: `gn-ledger-${stamp}`,
      email: `gn-ledger-${stamp}@example.com`,
      loginMethod: "vitest",
      role: "user",
    }).returning();
    userId = u.id;
    // Seed balance to 100 GN
    await db!.insert(goldenNoteBalances).values({ userId, balance: 100 });
  });

  afterAll(async () => {
    const db = await getDb();
    await db!.delete(goldenNoteTransactions).where(eq(goldenNoteTransactions.userId, userId));
    await db!.delete(goldenNoteBalances).where(eq(goldenNoteBalances.userId, userId));
    await db!.delete(users).where(eq(users.id, userId));
  });

  it("spendGoldenNotes debits, writes a transaction row, and returns new balance", async () => {
    const db = await getDb();
    const result = await db!.transaction(async (tx) => {
      return spendGoldenNotes(tx, userId, 30, "spend_tournament", "test spend");
    });
    expect(result.newBalance).toBe(70);

    const txRows = await db!
      .select()
      .from(goldenNoteTransactions)
      .where(eq(goldenNoteTransactions.userId, userId));
    expect(txRows.some((r) => r.amount === -30 && r.kind === "spend_tournament")).toBe(true);
  });

  it("spendGoldenNotes throws when balance is insufficient", async () => {
    const db = await getDb();
    await expect(
      db!.transaction(async (tx) => {
        return spendGoldenNotes(tx, userId, 9999, "spend_tournament", "too much");
      }),
    ).rejects.toThrow(/Not enough Golden Notes/i);
  });

  it("creditGoldenNotes adds funds and writes a refund transaction", async () => {
    const db = await getDb();
    const result = await db!.transaction(async (tx) => {
      return creditGoldenNotes(tx, userId, 30, "refund", "test refund");
    });
    expect(result.newBalance).toBe(100); // 70 + 30 = 100 again

    const txRows = await db!
      .select()
      .from(goldenNoteTransactions)
      .where(eq(goldenNoteTransactions.userId, userId));
    expect(txRows.some((r) => r.amount === 30 && r.kind === "refund")).toBe(true);
  });

  it("creditGoldenNotes auto-creates a balance row if missing", async () => {
    const db = await getDb();
    const ts2 = `${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
    const [u2] = await db!.insert(users).values({
      openId: `gn-credit-fresh-${ts2}`,
      email: `gn-credit-fresh-${ts2}@example.com`,
      loginMethod: "vitest",
      role: "user",
    }).returning();
    try {
      const result = await db!.transaction(async (tx) => {
        return creditGoldenNotes(tx, u2.id, 50, "admin_adjustment", "comp");
      });
      expect(result.newBalance).toBe(50);
    } finally {
      await db!.delete(goldenNoteTransactions).where(eq(goldenNoteTransactions.userId, u2.id));
      await db!.delete(goldenNoteBalances).where(eq(goldenNoteBalances.userId, u2.id));
      await db!.delete(users).where(eq(users.id, u2.id));
    }
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

```bash
set -a; source .env; set +a; pnpm test:server -- goldenNotesLedger.test
```

Expected: FAIL — module not found.

- [ ] **Step 3: Implement the helpers**

Create `server/_core/goldenNotesLedger.ts`:

```ts
// Shared Golden Notes ledger helpers. Used by goldenNotes.spend (fixed
// price table) and tournaments.payEntry (admin-set per-tournament cost).
// Both call sites are responsible for validating that the `cost` is
// server-controlled (never client-supplied). The helper just executes
// the race-safe decrement / credit and writes the audit row.
import { TRPCError } from "@trpc/server";
import { and, eq, gte, sql } from "drizzle-orm";
import {
  goldenNoteBalances,
  goldenNoteTransactions,
} from "../../drizzle/schema";

type SpendKind = "spend_extra_game" | "spend_tournament" | "spend_advanced_mode" | "spend_avatar_unlock";
type CreditKind = "purchase" | "refund" | "admin_adjustment" | "gift_received";

/**
 * Race-safe decrement. Must be called inside a transaction so the balance
 * write + transaction-log write commit atomically. Returns the new balance.
 * Throws TRPCError BAD_REQUEST with a friendly message if balance < cost.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export async function spendGoldenNotes(tx: any, userId: number, cost: number, kind: SpendKind, reason: string | null): Promise<{ newBalance: number }> {
  if (cost <= 0) {
    throw new TRPCError({ code: "BAD_REQUEST", message: "cost must be positive" });
  }
  // Ensure a balance row exists (idempotent — ON CONFLICT DO NOTHING).
  await tx.insert(goldenNoteBalances).values({ userId }).onConflictDoNothing();

  const updated = await tx
    .update(goldenNoteBalances)
    .set({
      balance: sql`${goldenNoteBalances.balance} - ${cost}`,
      lifetimeSpent: sql`${goldenNoteBalances.lifetimeSpent} + ${cost}`,
      updatedAt: new Date(),
    })
    .where(
      and(
        eq(goldenNoteBalances.userId, userId),
        gte(goldenNoteBalances.balance, cost),
      ),
    )
    .returning({ newBalance: goldenNoteBalances.balance });

  if (updated.length === 0) {
    const [cur] = await tx
      .select({ balance: goldenNoteBalances.balance })
      .from(goldenNoteBalances)
      .where(eq(goldenNoteBalances.userId, userId));
    throw new TRPCError({
      code: "BAD_REQUEST",
      message: `Not enough Golden Notes. You need ${cost}, have ${cur?.balance ?? 0}.`,
    });
  }

  const newBalance = updated[0].newBalance;
  await tx.insert(goldenNoteTransactions).values({
    userId,
    amount: -cost,
    kind,
    reason,
    balanceAfter: newBalance,
  });

  return { newBalance };
}

/**
 * Credit (positive amount). Used for refunds and admin adjustments.
 * Returns the new balance. Auto-creates the balance row if missing.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export async function creditGoldenNotes(tx: any, userId: number, amount: number, kind: CreditKind, reason: string | null, relatedUserId?: number): Promise<{ newBalance: number }> {
  if (amount <= 0) {
    throw new TRPCError({ code: "BAD_REQUEST", message: "credit amount must be positive" });
  }
  await tx.insert(goldenNoteBalances).values({ userId }).onConflictDoNothing();

  const updated = await tx
    .update(goldenNoteBalances)
    .set({
      balance: sql`${goldenNoteBalances.balance} + ${amount}`,
      updatedAt: new Date(),
    })
    .where(eq(goldenNoteBalances.userId, userId))
    .returning({ newBalance: goldenNoteBalances.balance });

  const newBalance = updated[0].newBalance;
  await tx.insert(goldenNoteTransactions).values({
    userId,
    amount,
    kind,
    reason,
    relatedUserId: relatedUserId ?? null,
    balanceAfter: newBalance,
  });

  return { newBalance };
}
```

- [ ] **Step 4: Refactor `goldenNotes.spend` to call the helper**

Edit `server/routers/goldenNotes.ts`. Find the `spend: protectedProcedure ... .mutation(async ({ ctx, input }) => { ... })` block (approximately lines 168-239). Replace the body of the mutation function (everything inside `async ({ ctx, input }) => { ... }`) with:

```ts
    .mutation(async ({ ctx, input }) => {
      rateLimit("gn.spend", ctx.user.id, { max: 60, windowMs: 60_000 });
      const cost = GN_SPEND_COSTS[input.kind];
      const db = await getDb();
      if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "Database unavailable" });

      const enumKind =
        input.kind === "spend_extra_game"            ? "spend_extra_game" :
        input.kind.startsWith("spend_tournament")    ? "spend_tournament" :
        input.kind.startsWith("spend_advanced_mode") ? "spend_advanced_mode" :
        "spend_extra_game";

      const { spendGoldenNotes } = await import("../_core/goldenNotesLedger");
      const result = await db.transaction(async (tx) => {
        return spendGoldenNotes(tx, ctx.user.id, cost, enumKind as "spend_extra_game" | "spend_tournament" | "spend_advanced_mode", input.reason ?? null);
      });

      return { newBalance: result.newBalance };
    }),
```

The dynamic `import` avoids any circular-dependency risk (the helper imports from `drizzle/schema`; `goldenNotes.ts` already does). Use a static import at the top of the file if no circularity surfaces.

- [ ] **Step 5: Run all tests, watch them pass**

```bash
set -a; source .env; set +a; pnpm test:server -- "goldenNotesLedger.test|goldenNotes"
```

Expected: 4 new ledger tests PASS; any existing `goldenNotes` tests still PASS (the refactor preserves behavior).

- [ ] **Step 6: Run typecheck**

```bash
pnpm check
```

Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add server/_core/goldenNotesLedger.ts server/_core/goldenNotesLedger.test.ts server/routers/goldenNotes.ts
git commit -m "refactor(gn): extract spendGoldenNotes + creditGoldenNotes ledger helpers"
```

---

## Task 2: Server — tournamentsRouter (user-facing)

**Files:**
- Create: `server/routers/tournaments.ts`
- Create: `server/routers/tournaments.test.ts`
- Modify: `server/app-router.ts`

- [ ] **Step 1: Write failing tests**

Create `server/routers/tournaments.test.ts`:

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
import {
  users,
  tournaments,
  tournamentMembers,
  chatRooms,
  goldenNoteBalances,
  goldenNoteTransactions,
} from "../../drizzle/schema";
import { eq, inArray } from "drizzle-orm";

const DB_URL =
  process.env.SUPABASE_SESSION_POOLER_STRING ??
  process.env.SUPABASE_DIRECT_CONNECTION_STRING ??
  process.env.DATABASE_URL;
const liveDescribe = DB_URL ? describe : describe.skip;

const stamp = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

liveDescribe("tournamentsRouter", () => {
  let userId: number;
  let adminId: number;
  let openTournamentId: number;
  let openTournamentRoomId: number;
  let draftTournamentId: number;

  beforeAll(async () => {
    const db = await getDb();
    const [u] = await db!.insert(users).values({
      openId: `t-user-${stamp}`,
      email: `t-user-${stamp}@example.com`,
      loginMethod: "vitest",
      role: "user",
    }).returning();
    userId = u.id;
    const [a] = await db!.insert(users).values({
      openId: `t-admin-${stamp}`,
      email: `t-admin-${stamp}@example.com`,
      loginMethod: "vitest",
      role: "admin",
    }).returning();
    adminId = a.id;

    // Seed user with 100 GN
    await db!.insert(goldenNoteBalances).values({ userId, balance: 100 });

    // Create an open tournament (chat room first, then tournament, then update chat_room_id)
    const [room] = await db!.insert(chatRooms).values({
      kind: "tournament",
      retentionDays: 60,
    }).returning();
    openTournamentRoomId = room.id;

    const [t] = await db!.insert(tournaments).values({
      name: `Test Tournament ${stamp}`,
      description: "open tournament for tests",
      entryCostGn: 10,
      capacity: 5,
      startsAt: new Date(Date.now() + 24 * 60 * 60 * 1000),
      endsAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
      chatRoomId: room.id,
      status: "open",
      createdBy: adminId,
    }).returning();
    openTournamentId = t.id;

    // Link the room to the tournament
    await db!.update(chatRooms).set({ tournamentId: t.id }).where(eq(chatRooms.id, room.id));

    // Also create a draft tournament (not visible to listOpen)
    const [draftRoom] = await db!.insert(chatRooms).values({
      kind: "tournament",
      retentionDays: 60,
    }).returning();
    const [draft] = await db!.insert(tournaments).values({
      name: `Draft Tournament ${stamp}`,
      entryCostGn: 0,
      startsAt: new Date(Date.now() + 24 * 60 * 60 * 1000),
      endsAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
      chatRoomId: draftRoom.id,
      status: "draft",
      createdBy: adminId,
    }).returning();
    draftTournamentId = draft.id;
    await db!.update(chatRooms).set({ tournamentId: draft.id }).where(eq(chatRooms.id, draftRoom.id));
  });

  afterAll(async () => {
    const db = await getDb();
    await db!.delete(tournamentMembers).where(inArray(tournamentMembers.tournamentId, [openTournamentId, draftTournamentId]));
    await db!.delete(tournaments).where(inArray(tournaments.id, [openTournamentId, draftTournamentId]));
    await db!.delete(chatRooms).where(eq(chatRooms.tournamentId, openTournamentId));
    await db!.delete(chatRooms).where(eq(chatRooms.tournamentId, draftTournamentId));
    await db!.delete(goldenNoteTransactions).where(eq(goldenNoteTransactions.userId, userId));
    await db!.delete(goldenNoteBalances).where(eq(goldenNoteBalances.userId, userId));
  });

  const callerFor = (id: number, role: "user" | "admin" = "user") =>
    appRouter.createCaller({
      user: { id, role, email: `${id}@example.com` },
      req: { ip: "127.0.0.1" } as never,
      ip: "127.0.0.1",
      userAgent: "vitest",
    } as never);

  it("listOpen returns tournaments with status='open' only", async () => {
    const result = await callerFor(userId).tournaments.listOpen();
    const ids = result.map((t) => t.id);
    expect(ids).toContain(openTournamentId);
    expect(ids).not.toContain(draftTournamentId);
  });

  it("getById returns full tournament + roster size", async () => {
    const result = await callerFor(userId).tournaments.getById({ id: openTournamentId });
    expect(result.tournament.id).toBe(openTournamentId);
    expect(result.tournament.entryCostGn).toBe(10);
    expect(result.rosterSize).toBe(0);
  });

  it("payEntry succeeds atomically: GN debit + roster insert + audit log", async () => {
    const before = await callerFor(userId).tournaments.getById({ id: openTournamentId });
    expect(before.rosterSize).toBe(0);

    const result = await callerFor(userId).tournaments.payEntry({ tournamentId: openTournamentId });
    expect(result.success).toBe(true);
    expect(result.newBalance).toBe(90); // 100 - 10

    const after = await callerFor(userId).tournaments.getById({ id: openTournamentId });
    expect(after.rosterSize).toBe(1);

    // Verify membership
    const memberships = await callerFor(userId).tournaments.myMemberships();
    expect(memberships.map((m) => m.tournamentId)).toContain(openTournamentId);
  });

  it("payEntry rejects when already a member", async () => {
    await expect(
      callerFor(userId).tournaments.payEntry({ tournamentId: openTournamentId }),
    ).rejects.toThrow(/already a member|ALREADY_MEMBER/i);
  });

  it("payEntry rejects when tournament is not open", async () => {
    await expect(
      callerFor(userId).tournaments.payEntry({ tournamentId: draftTournamentId }),
    ).rejects.toThrow(/closed|not.*open|TOURNAMENT_CLOSED/i);
  });

  it("payEntry rejects on insufficient GN", async () => {
    const db = await getDb();
    const ts2 = `${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
    const [poor] = await db!.insert(users).values({
      openId: `t-poor-${ts2}`,
      email: `t-poor-${ts2}@example.com`,
      loginMethod: "vitest",
      role: "user",
    }).returning();
    try {
      await db!.insert(goldenNoteBalances).values({ userId: poor.id, balance: 1 });
      await expect(
        callerFor(poor.id).tournaments.payEntry({ tournamentId: openTournamentId }),
      ).rejects.toThrow(/not enough golden notes|insufficient/i);
    } finally {
      await db!.delete(goldenNoteTransactions).where(eq(goldenNoteTransactions.userId, poor.id));
      await db!.delete(goldenNoteBalances).where(eq(goldenNoteBalances.userId, poor.id));
      await db!.delete(users).where(eq(users.id, poor.id));
    }
  });
});
```

- [ ] **Step 2: Run tests, watch them fail**

```bash
set -a; source .env; set +a; pnpm test:server -- tournaments.test
```

Expected: FAIL — `tournaments` namespace doesn't exist on `appRouter`.

- [ ] **Step 3: Implement `tournamentsRouter`**

Create `server/routers/tournaments.ts`:

```ts
// Tournaments tRPC router. User-facing procedures only in this file.
// Admin procedures live on the .admin sub-router (Task 3).
import { z } from "zod";
import { TRPCError } from "@trpc/server";
import { and, eq, sql, isNull } from "drizzle-orm";
import { router, protectedProcedure } from "../_core/trpc";
import { getDb } from "../db";
import {
  tournaments,
  tournamentMembers,
  chatRoomMembers,
} from "../../drizzle/schema";
import { spendGoldenNotes } from "../_core/goldenNotesLedger";
import { recordChatAction } from "../_core/chatAudit";
import { tournamentsAdminRouter } from "./tournaments.admin";

export const tournamentsRouter = router({
  listOpen: protectedProcedure.query(async () => {
    const db = await getDb();
    if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "DB unavailable" });
    const rows = await db
      .select()
      .from(tournaments)
      .where(eq(tournaments.status, "open"))
      .orderBy(sql`${tournaments.startsAt} ASC`);
    return rows;
  }),

  getById: protectedProcedure
    .input(z.object({ id: z.number().int() }))
    .query(async ({ input }) => {
      const db = await getDb();
      if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "DB unavailable" });

      const [tournament] = await db
        .select()
        .from(tournaments)
        .where(eq(tournaments.id, input.id));
      if (!tournament) {
        throw new TRPCError({ code: "NOT_FOUND", message: "Tournament not found" });
      }

      const [{ count }] = await db
        .select({ count: sql<number>`COUNT(*)::int` })
        .from(tournamentMembers)
        .where(
          and(
            eq(tournamentMembers.tournamentId, input.id),
            isNull(tournamentMembers.leftAt),
          ),
        );

      return { tournament, rosterSize: count };
    }),

  myMemberships: protectedProcedure.query(async ({ ctx }) => {
    const db = await getDb();
    if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "DB unavailable" });
    const rows = await db
      .select({
        tournamentId: tournamentMembers.tournamentId,
        joinedAt: tournamentMembers.joinedAt,
        entryMethod: tournamentMembers.entryMethod,
        name: tournaments.name,
        status: tournaments.status,
        chatRoomId: tournaments.chatRoomId,
      })
      .from(tournamentMembers)
      .innerJoin(tournaments, eq(tournamentMembers.tournamentId, tournaments.id))
      .where(
        and(
          eq(tournamentMembers.userId, ctx.user.id),
          isNull(tournamentMembers.leftAt),
        ),
      )
      .orderBy(sql`${tournamentMembers.joinedAt} DESC`);
    return rows;
  }),

  payEntry: protectedProcedure
    .input(z.object({ tournamentId: z.number().int() }))
    .mutation(async ({ input, ctx }) => {
      const db = await getDb();
      if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "DB unavailable" });

      const result = await db.transaction(async (tx) => {
        // 1. Lock the tournament row + read entry cost & status & capacity
        const [t] = await tx
          .select()
          .from(tournaments)
          .where(eq(tournaments.id, input.tournamentId))
          .for("update");
        if (!t) throw new TRPCError({ code: "NOT_FOUND", message: "Tournament not found" });
        if (t.status !== "open") {
          throw new TRPCError({
            code: "BAD_REQUEST",
            message: "Tournament is no longer accepting entries.",
          });
        }

        // 2. Capacity check
        if (t.capacity != null) {
          const [{ count }] = await tx
            .select({ count: sql<number>`COUNT(*)::int` })
            .from(tournamentMembers)
            .where(
              and(
                eq(tournamentMembers.tournamentId, input.tournamentId),
                isNull(tournamentMembers.leftAt),
              ),
            );
          if (count >= t.capacity) {
            throw new TRPCError({ code: "BAD_REQUEST", message: "Tournament is full." });
          }
        }

        // 3. Already-member check (active only)
        const existing = await tx
          .select()
          .from(tournamentMembers)
          .where(
            and(
              eq(tournamentMembers.tournamentId, input.tournamentId),
              eq(tournamentMembers.userId, ctx.user.id),
              isNull(tournamentMembers.leftAt),
            ),
          )
          .limit(1);
        if (existing.length > 0) {
          throw new TRPCError({
            code: "BAD_REQUEST",
            message: "You're already a member of this tournament.",
          });
        }

        // 4. Spend GN (throws if insufficient)
        const { newBalance } = await spendGoldenNotes(
          tx,
          ctx.user.id,
          t.entryCostGn,
          "spend_tournament",
          `Tournament entry: ${t.name}`,
        );

        // 5. Insert roster row
        await tx.insert(tournamentMembers).values({
          tournamentId: input.tournamentId,
          userId: ctx.user.id,
          entryMethod: "paid",
          gnSpent: t.entryCostGn,
        });

        // 6. Insert chat_room_members row so unread tracking starts at 0
        if (t.chatRoomId != null) {
          await tx
            .insert(chatRoomMembers)
            .values({ userId: ctx.user.id, roomId: t.chatRoomId, lastReadSeq: 0 })
            .onConflictDoNothing();
        }

        // 7. Audit
        await recordChatAction({
          tx,
          actorId: ctx.user.id,
          actorRole: "user",
          action: "tournament_join_paid",
          targetUserId: ctx.user.id,
          targetTournamentId: input.tournamentId,
          reason: `paid ${t.entryCostGn} GN`,
        });

        return { newBalance };
      });

      return { success: true as const, newBalance: result.newBalance };
    }),

  // Admin sub-router lives in tournaments.admin.ts and is composed here.
  admin: tournamentsAdminRouter,
});
```

- [ ] **Step 4: Stub the admin sub-router**

Create `server/routers/tournaments.admin.ts` with an empty router so the import in Task 2 compiles:

```ts
// Tournaments admin sub-router. Procedures (create / update / lifecycle
// transitions / addMember / removeMember) are added by Task 3.
import { router } from "../_core/trpc";

export const tournamentsAdminRouter = router({});
```

- [ ] **Step 5: Register in `app-router.ts`**

Edit `server/app-router.ts`. Add:

```ts
import { tournamentsRouter } from "./routers/tournaments";
```

Inside the `router({ ... })` call:

```ts
tournaments: tournamentsRouter,
```

- [ ] **Step 6: Run tests, watch them pass**

```bash
set -a; source .env; set +a; pnpm test:server -- tournaments.test
```

Expected: 6 / 6 PASS.

- [ ] **Step 7: Run typecheck**

```bash
pnpm check
```

Expected: PASS.

- [ ] **Step 8: Commit**

```bash
git add server/routers/tournaments.ts server/routers/tournaments.admin.ts server/routers/tournaments.test.ts server/app-router.ts
git commit -m "feat(tournaments): user-facing router — listOpen / getById / myMemberships / payEntry"
```

---

## Task 3: Server — tournaments.admin sub-router

**Files:**
- Modify: `server/routers/tournaments.admin.ts`
- Create: `server/routers/tournaments.admin.test.ts`

- [ ] **Step 1: Write failing tests**

Create `server/routers/tournaments.admin.test.ts`:

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
import {
  users,
  tournaments,
  tournamentMembers,
  chatRooms,
  goldenNoteBalances,
  goldenNoteTransactions,
  chatAuditLog,
} from "../../drizzle/schema";
import { eq, inArray } from "drizzle-orm";

const DB_URL =
  process.env.SUPABASE_SESSION_POOLER_STRING ??
  process.env.SUPABASE_DIRECT_CONNECTION_STRING ??
  process.env.DATABASE_URL;
const liveDescribe = DB_URL ? describe : describe.skip;

const stamp = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

liveDescribe("tournaments.admin", () => {
  let adminId: number;
  let playerId: number;
  const cleanupTournamentIds: number[] = [];

  beforeAll(async () => {
    const db = await getDb();
    const [a] = await db!.insert(users).values({
      openId: `tadmin-admin-${stamp}`,
      email: `tadmin-admin-${stamp}@example.com`,
      loginMethod: "vitest",
      role: "admin",
    }).returning();
    adminId = a.id;
    const [p] = await db!.insert(users).values({
      openId: `tadmin-player-${stamp}`,
      email: `tadmin-player-${stamp}@example.com`,
      loginMethod: "vitest",
      role: "user",
    }).returning();
    playerId = p.id;
    await db!.insert(goldenNoteBalances).values({ userId: playerId, balance: 200 });
  });

  afterAll(async () => {
    const db = await getDb();
    if (cleanupTournamentIds.length > 0) {
      await db!.delete(tournamentMembers).where(inArray(tournamentMembers.tournamentId, cleanupTournamentIds));
      await db!.delete(tournaments).where(inArray(tournaments.id, cleanupTournamentIds));
      await db!.delete(chatRooms).where(inArray(chatRooms.tournamentId, cleanupTournamentIds));
    }
    await db!.delete(goldenNoteTransactions).where(inArray(goldenNoteTransactions.userId, [playerId]));
    await db!.delete(goldenNoteBalances).where(eq(goldenNoteBalances.userId, playerId));
  });

  const callerFor = (id: number, role: "user" | "admin") =>
    appRouter.createCaller({
      user: { id, role, email: `${id}@example.com` },
      req: { ip: "127.0.0.1" } as never,
      ip: "127.0.0.1",
      userAgent: "vitest",
    } as never);

  it("create makes a draft tournament + a tournament chat_rooms row in one tx", async () => {
    const result = await callerFor(adminId, "admin").tournaments.admin.create({
      name: `Test Create ${stamp}`,
      description: "from test",
      entryCostGn: 15,
      capacity: 10,
      startsAt: new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString(),
      endsAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString(),
    });
    expect(result.id).toBeGreaterThan(0);
    expect(result.chatRoomId).toBeGreaterThan(0);
    cleanupTournamentIds.push(result.id);

    const db = await getDb();
    const [t] = await db!.select().from(tournaments).where(eq(tournaments.id, result.id));
    expect(t.status).toBe("draft");
    expect(t.entryCostGn).toBe(15);
  });

  it("non-admin cannot call admin.create", async () => {
    await expect(
      // @ts-expect-error: non-admin caller should be denied at runtime
      callerFor(playerId, "user").tournaments.admin.create({
        name: "nope",
        startsAt: new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString(),
        endsAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString(),
      }),
    ).rejects.toThrow();
  });

  it("openTournament transitions draft -> open", async () => {
    const tid = cleanupTournamentIds[0];
    const r = await callerFor(adminId, "admin").tournaments.admin.openTournament({ id: tid });
    expect(r.status).toBe("open");
  });

  it("startTournament transitions open -> in_progress", async () => {
    const tid = cleanupTournamentIds[0];
    const r = await callerFor(adminId, "admin").tournaments.admin.startTournament({ id: tid });
    expect(r.status).toBe("in_progress");
  });

  it("completeTournament transitions in_progress -> completed", async () => {
    const tid = cleanupTournamentIds[0];
    const r = await callerFor(adminId, "admin").tournaments.admin.completeTournament({ id: tid });
    expect(r.status).toBe("completed");
  });

  it("addMember (admin_invited) creates a roster row with gn_spent=0", async () => {
    // New tournament for this case
    const created = await callerFor(adminId, "admin").tournaments.admin.create({
      name: `Invite Test ${stamp}`,
      entryCostGn: 0,
      startsAt: new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString(),
      endsAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString(),
    });
    cleanupTournamentIds.push(created.id);
    await callerFor(adminId, "admin").tournaments.admin.openTournament({ id: created.id });

    const r = await callerFor(adminId, "admin").tournaments.admin.addMember({
      tournamentId: created.id,
      userId: playerId,
      method: "admin_invited",
    });
    expect(r.success).toBe(true);

    const db = await getDb();
    const rows = await db!.select().from(tournamentMembers).where(eq(tournamentMembers.tournamentId, created.id));
    expect(rows.length).toBe(1);
    expect(rows[0].entryMethod).toBe("admin_invited");
    expect(rows[0].gnSpent).toBe(0);
  });

  it("cancelTournament refunds paid members and writes audit log", async () => {
    const created = await callerFor(adminId, "admin").tournaments.admin.create({
      name: `Cancel Test ${stamp}`,
      entryCostGn: 20,
      startsAt: new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString(),
      endsAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString(),
    });
    cleanupTournamentIds.push(created.id);
    await callerFor(adminId, "admin").tournaments.admin.openTournament({ id: created.id });

    // Player pays 20 GN to enter
    await callerFor(playerId, "user").tournaments.payEntry({ tournamentId: created.id });

    const db = await getDb();
    const [beforeBal] = await db!.select().from(goldenNoteBalances).where(eq(goldenNoteBalances.userId, playerId));
    const beforeBalance = beforeBal.balance;

    // Cancel
    const r = await callerFor(adminId, "admin").tournaments.admin.cancelTournament({
      id: created.id,
      reason: "scheduling conflict",
    });
    expect(r.refundedCount).toBeGreaterThanOrEqual(1);

    const [afterBal] = await db!.select().from(goldenNoteBalances).where(eq(goldenNoteBalances.userId, playerId));
    expect(afterBal.balance).toBe(beforeBalance + 20);

    // Verify audit log row for the cancellation
    const audit = await db!
      .select()
      .from(chatAuditLog)
      .where(eq(chatAuditLog.action, "tournament_cancel"));
    expect(audit.length).toBeGreaterThanOrEqual(1);
  });
});
```

- [ ] **Step 2: Implement the admin sub-router**

Replace `server/routers/tournaments.admin.ts`:

```ts
// Tournaments admin sub-router. All procedures require role='admin'.
import { z } from "zod";
import { TRPCError } from "@trpc/server";
import { and, eq, sql, isNull } from "drizzle-orm";
import { router, adminProcedure } from "../_core/trpc";
import { getDb } from "../db";
import {
  tournaments,
  tournamentMembers,
  chatRooms,
} from "../../drizzle/schema";
import { creditGoldenNotes } from "../_core/goldenNotesLedger";
import { recordChatAction } from "../_core/chatAudit";

const NameSchema = z.string().min(1).max(128);

export const tournamentsAdminRouter = router({
  create: adminProcedure
    .input(
      z.object({
        name: NameSchema,
        description: z.string().optional(),
        entryCostGn: z.number().int().min(0).default(0),
        capacity: z.number().int().min(1).optional(),
        startsAt: z.string().datetime(),
        endsAt: z.string().datetime(),
        prizePoolId: z.number().int().optional(),
      }),
    )
    .mutation(async ({ input, ctx }) => {
      const db = await getDb();
      if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "DB unavailable" });

      const result = await db.transaction(async (tx) => {
        // 1. Create the chat_rooms row (tournament_id filled in step 3)
        const [room] = await tx
          .insert(chatRooms)
          .values({ kind: "tournament", retentionDays: 60 })
          .returning();

        // 2. Create the tournament linked to the room
        const [t] = await tx
          .insert(tournaments)
          .values({
            name: input.name,
            description: input.description ?? null,
            entryCostGn: input.entryCostGn,
            capacity: input.capacity ?? null,
            startsAt: new Date(input.startsAt),
            endsAt: new Date(input.endsAt),
            chatRoomId: room.id,
            status: "draft",
            prizePoolId: input.prizePoolId ?? null,
            createdBy: ctx.user.id,
          })
          .returning();

        // 3. Link the room back to the tournament (closes the FK)
        await tx.update(chatRooms).set({ tournamentId: t.id }).where(eq(chatRooms.id, room.id));

        // 4. Audit
        await recordChatAction({
          tx,
          actorId: ctx.user.id,
          actorRole: "admin",
          action: "tournament_create",
          targetTournamentId: t.id,
          reason: `created ${t.name}`,
          metadata: { entryCostGn: t.entryCostGn, capacity: t.capacity },
        });

        return { id: t.id, chatRoomId: room.id };
      });

      return result;
    }),

  update: adminProcedure
    .input(
      z.object({
        id: z.number().int(),
        name: NameSchema.optional(),
        description: z.string().optional(),
      }),
    )
    .mutation(async ({ input, ctx }) => {
      const db = await getDb();
      if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "DB unavailable" });

      const result = await db.transaction(async (tx) => {
        const [updated] = await tx
          .update(tournaments)
          .set({
            ...(input.name != null ? { name: input.name } : {}),
            ...(input.description !== undefined ? { description: input.description } : {}),
            updatedAt: new Date(),
          })
          .where(eq(tournaments.id, input.id))
          .returning();
        if (!updated) throw new TRPCError({ code: "NOT_FOUND", message: "Tournament not found" });

        await recordChatAction({
          tx,
          actorId: ctx.user.id,
          actorRole: "admin",
          action: "tournament_update",
          targetTournamentId: input.id,
          reason: "metadata update",
        });

        return updated;
      });

      return result;
    }),

  openTournament: adminProcedure
    .input(z.object({ id: z.number().int() }))
    .mutation(async ({ input, ctx }) => transitionStatus(input.id, ctx.user.id, "draft", "open")),

  startTournament: adminProcedure
    .input(z.object({ id: z.number().int() }))
    .mutation(async ({ input, ctx }) => transitionStatus(input.id, ctx.user.id, "open", "in_progress")),

  completeTournament: adminProcedure
    .input(z.object({ id: z.number().int() }))
    .mutation(async ({ input, ctx }) => transitionStatus(input.id, ctx.user.id, "in_progress", "completed")),

  cancelTournament: adminProcedure
    .input(z.object({ id: z.number().int(), reason: z.string().min(1) }))
    .mutation(async ({ input, ctx }) => {
      const db = await getDb();
      if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "DB unavailable" });

      const result = await db.transaction(async (tx) => {
        const [t] = await tx
          .select()
          .from(tournaments)
          .where(eq(tournaments.id, input.id))
          .for("update");
        if (!t) throw new TRPCError({ code: "NOT_FOUND", message: "Tournament not found" });
        if (t.status === "completed" || t.status === "cancelled") {
          throw new TRPCError({ code: "BAD_REQUEST", message: `Already ${t.status}` });
        }

        await tx
          .update(tournaments)
          .set({ status: "cancelled", updatedAt: new Date() })
          .where(eq(tournaments.id, input.id));

        // Refund paid members
        const paidMembers = await tx
          .select()
          .from(tournamentMembers)
          .where(
            and(
              eq(tournamentMembers.tournamentId, input.id),
              eq(tournamentMembers.entryMethod, "paid"),
              isNull(tournamentMembers.leftAt),
            ),
          );

        for (const m of paidMembers) {
          await creditGoldenNotes(
            tx,
            m.userId,
            m.gnSpent,
            "refund",
            `Refund: tournament "${t.name}" cancelled`,
          );
          await recordChatAction({
            tx,
            actorId: ctx.user.id,
            actorRole: "admin",
            action: "tournament_remove_member",
            targetUserId: m.userId,
            targetTournamentId: input.id,
            reason: `refund on cancel (${m.gnSpent} GN)`,
            metadata: { refunded: true, amount: m.gnSpent },
          });
        }

        await recordChatAction({
          tx,
          actorId: ctx.user.id,
          actorRole: "admin",
          action: "tournament_cancel",
          targetTournamentId: input.id,
          reason: input.reason,
          metadata: { refundedCount: paidMembers.length },
        });

        return { refundedCount: paidMembers.length };
      });

      return result;
    }),

  addMember: adminProcedure
    .input(
      z.object({
        tournamentId: z.number().int(),
        userId: z.number().int(),
        method: z.enum(["admin_invited", "comp"]),
      }),
    )
    .mutation(async ({ input, ctx }) => {
      const db = await getDb();
      if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "DB unavailable" });

      await db.transaction(async (tx) => {
        await tx
          .insert(tournamentMembers)
          .values({
            tournamentId: input.tournamentId,
            userId: input.userId,
            entryMethod: input.method,
            gnSpent: 0,
          })
          .onConflictDoNothing();

        await recordChatAction({
          tx,
          actorId: ctx.user.id,
          actorRole: "admin",
          action: "tournament_add_member",
          targetUserId: input.userId,
          targetTournamentId: input.tournamentId,
          reason: input.method,
        });
      });

      return { success: true as const };
    }),

  removeMember: adminProcedure
    .input(
      z.object({
        tournamentId: z.number().int(),
        userId: z.number().int(),
        refundGn: z.boolean(),
        reason: z.string().min(1),
      }),
    )
    .mutation(async ({ input, ctx }) => {
      const db = await getDb();
      if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "DB unavailable" });

      const result = await db.transaction(async (tx) => {
        const [m] = await tx
          .select()
          .from(tournamentMembers)
          .where(
            and(
              eq(tournamentMembers.tournamentId, input.tournamentId),
              eq(tournamentMembers.userId, input.userId),
              isNull(tournamentMembers.leftAt),
            ),
          );
        if (!m) throw new TRPCError({ code: "NOT_FOUND", message: "Member not found" });

        await tx
          .update(tournamentMembers)
          .set({ leftAt: new Date() })
          .where(
            and(
              eq(tournamentMembers.tournamentId, input.tournamentId),
              eq(tournamentMembers.userId, input.userId),
            ),
          );

        let refunded = 0;
        if (input.refundGn && m.entryMethod === "paid" && m.gnSpent > 0) {
          await creditGoldenNotes(tx, input.userId, m.gnSpent, "refund", `Admin removed: ${input.reason}`);
          refunded = m.gnSpent;
        }

        await recordChatAction({
          tx,
          actorId: ctx.user.id,
          actorRole: "admin",
          action: "tournament_remove_member",
          targetUserId: input.userId,
          targetTournamentId: input.tournamentId,
          reason: input.reason,
          metadata: { refunded: refunded > 0, amount: refunded },
        });

        return { refunded };
      });

      return result;
    }),
});

async function transitionStatus(
  id: number,
  actorId: number,
  fromStatus: "draft" | "open" | "in_progress",
  toStatus: "open" | "in_progress" | "completed",
): Promise<{ status: "open" | "in_progress" | "completed" }> {
  const db = await getDb();
  if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "DB unavailable" });

  const result = await db.transaction(async (tx) => {
    const [t] = await tx
      .select()
      .from(tournaments)
      .where(eq(tournaments.id, id))
      .for("update");
    if (!t) throw new TRPCError({ code: "NOT_FOUND", message: "Tournament not found" });
    if (t.status !== fromStatus) {
      throw new TRPCError({
        code: "BAD_REQUEST",
        message: `Expected status ${fromStatus}, found ${t.status}`,
      });
    }

    await tx
      .update(tournaments)
      .set({ status: toStatus, updatedAt: new Date() })
      .where(eq(tournaments.id, id));

    await recordChatAction({
      tx,
      actorId,
      actorRole: "admin",
      action: "tournament_update",
      targetTournamentId: id,
      reason: `status: ${fromStatus} -> ${toStatus}`,
      metadata: { from: fromStatus, to: toStatus },
    });

    return { status: toStatus };
  });

  return result;
}
```

- [ ] **Step 3: Run tests, watch them pass**

```bash
set -a; source .env; set +a; pnpm test:server -- "tournaments.admin.test|tournaments.test"
```

Expected: all tests PASS.

- [ ] **Step 4: Run typecheck**

```bash
pnpm check
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add server/routers/tournaments.admin.ts server/routers/tournaments.admin.test.ts
git commit -m "feat(tournaments): admin sub-router — create / update / lifecycle / add+remove member / refund"
```

---

## Task 4: Server — chat.unreadCounts.tournaments

**Files:**
- Modify: `server/routers/chat.ts`
- Modify: `server/routers/chat.endpoints.test.ts`

- [ ] **Step 1: Append failing test**

Append to `server/routers/chat.endpoints.test.ts` inside the existing `liveDescribe("chat.markRead + unreadCounts", ...)` block (after the friends-count test):

```ts
  it("unreadCounts.tournaments returns per-tournament counts for active memberships", async () => {
    const db = await getDb();
    const ts = `${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;

    // Create a tournament + chat room
    const [room] = await db!.insert(chatRooms).values({
      kind: "tournament",
      retentionDays: 60,
    }).returning();
    const [t] = await db!.insert(tournaments).values({
      name: `Unread Tournament ${ts}`,
      entryCostGn: 0,
      startsAt: new Date(Date.now() + 24 * 60 * 60 * 1000),
      endsAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
      chatRoomId: room.id,
      status: "open",
      createdBy: userId,
    }).returning();
    await db!.update(chatRooms).set({ tournamentId: t.id }).where(eq(chatRooms.id, room.id));

    try {
      // userId joins as admin_invited; lastReadSeq stays at 0
      await db!.insert(tournamentMembers).values({
        tournamentId: t.id,
        userId: userId,
        entryMethod: "admin_invited",
        gnSpent: 0,
      });
      await db!.insert(chatRoomMembers).values({ userId, roomId: room.id, lastReadSeq: 0 });

      // Post a tournament message
      await db!.insert(chatMessages).values({
        scope: "tournament",
        roomId: room.id,
        authorId: userId,
        body: "tournament test message",
      });

      const counts = await callerFor(userId).chat.unreadCounts();
      expect(counts.tournaments[t.id]).toBeGreaterThanOrEqual(1);
    } finally {
      await db!.delete(chatMessages).where(eq(chatMessages.roomId, room.id));
      await db!.delete(chatRoomMembers).where(eq(chatRoomMembers.roomId, room.id));
      await db!.delete(tournamentMembers).where(eq(tournamentMembers.tournamentId, t.id));
      await db!.delete(tournaments).where(eq(tournaments.id, t.id));
      await db!.delete(chatRooms).where(eq(chatRooms.id, room.id));
    }
  });
```

Also add `tournaments` and `tournamentMembers` and `chatRooms` to the imports at the top of `chat.endpoints.test.ts` if missing.

- [ ] **Step 2: Update `chat.unreadCounts`**

Edit `server/routers/chat.ts`. Find the `unreadCounts` query. Replace the existing `tournaments: {}` line with a real computation. Inside the body, after the friends count computation, add:

```ts
    // Tournaments — per-tournament unread count for the viewer's active memberships
    const tournamentRows = await db.execute(sql`
      SELECT t.id AS tournament_id, t.chat_room_id, COALESCE(crm.last_read_seq, 0) AS last_read_seq
      FROM tournament_members tm
      JOIN tournaments t ON t.id = tm.tournament_id
      LEFT JOIN chat_room_members crm
        ON crm.user_id = ${ctx.user.id} AND crm.room_id = t.chat_room_id
      WHERE tm.user_id = ${ctx.user.id}
        AND tm.left_at IS NULL
        AND t.chat_room_id IS NOT NULL
    `);
    const tournamentMembershipRows = ((tournamentRows as unknown as { rows?: Array<{ tournament_id: number; chat_room_id: number; last_read_seq: number }> }).rows
      ?? (Array.isArray(tournamentRows) ? (tournamentRows as unknown as Array<{ tournament_id: number; chat_room_id: number; last_read_seq: number }>) : []));

    const tournamentCounts: Record<number, number> = {};
    for (const row of tournamentMembershipRows) {
      const countRes = await db.execute(sql`
        SELECT COUNT(*)::int AS count
        FROM chat_messages
        WHERE scope = 'tournament'
          AND room_id = ${row.chat_room_id}
          AND id > ${row.last_read_seq}
          AND deleted_at IS NULL
          AND NOT (posted_while_shadow_banned AND author_id != ${ctx.user.id})
      `);
      const c = ((countRes as unknown as { rows?: Array<{ count: number }> }).rows
        ?? (Array.isArray(countRes) ? (countRes as unknown as Array<{ count: number }>) : []))[0]?.count ?? 0;
      if (c > 0) tournamentCounts[row.tournament_id] = c;
    }

    return {
      global: globalCount,
      friends: friendsCount,
      tournaments: tournamentCounts,
    };
```

Remove the previous `tournaments: {} as Record<number, number>` line.

- [ ] **Step 3: Run tests, watch them pass**

```bash
set -a; source .env; set +a; pnpm test:server -- chat.endpoints.test
```

Expected: all tests PASS.

- [ ] **Step 4: Commit**

```bash
git add server/routers/chat.ts server/routers/chat.endpoints.test.ts
git commit -m "feat(chat): unreadCounts.tournaments computed per active membership"
```

---

## Task 5: Client — /tournaments public discovery page

**Files:**
- Create: `client/src/pages/Tournaments.tsx`
- Modify: `client/src/App.tsx`

- [ ] **Step 1: Create the page**

Create `client/src/pages/Tournaments.tsx`:

```tsx
import { useState } from "react";
import { trpc } from "@/lib/trpc";
import { useAuth } from "@/_core/hooks/useAuth";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Calendar, Users, Coins } from "lucide-react";
import { toast } from "sonner";

export default function TournamentsPage() {
  const { user } = useAuth();
  const utils = trpc.useUtils();
  const open = trpc.tournaments.listOpen.useQuery();
  const myMemberships = trpc.tournaments.myMemberships.useQuery(undefined, {
    enabled: !!user,
  });
  const payMutation = trpc.tournaments.payEntry.useMutation();
  const [busyId, setBusyId] = useState<number | null>(null);

  const joinedIds = new Set((myMemberships.data ?? []).map((m) => m.tournamentId));

  const handleJoin = async (id: number, cost: number) => {
    if (!confirm(`Spend ${cost} GN to join this tournament?`)) return;
    setBusyId(id);
    try {
      await payMutation.mutateAsync({ tournamentId: id });
      void utils.tournaments.listOpen.invalidate();
      void utils.tournaments.myMemberships.invalidate();
      void utils.chat.unreadCounts.invalidate();
      toast.success("Joined tournament");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to join");
    } finally {
      setBusyId(null);
    }
  };

  return (
    <div className="container max-w-3xl py-8">
      <h1 className="text-2xl font-bold mb-4">Tournaments</h1>
      {open.isLoading && <p className="text-muted-foreground">Loading...</p>}
      {open.data && open.data.length === 0 && (
        <p className="text-muted-foreground">No open tournaments right now.</p>
      )}
      <div className="grid gap-3">
        {(open.data ?? []).map((t) => {
          const joined = joinedIds.has(t.id);
          return (
            <Card key={t.id} className="p-4">
              <div className="flex items-start justify-between gap-4">
                <div className="flex-1 min-w-0">
                  <h2 className="font-semibold">{t.name}</h2>
                  {t.description && (
                    <p className="text-sm text-muted-foreground mt-0.5">{t.description}</p>
                  )}
                  <div className="flex flex-wrap gap-3 mt-2 text-xs text-muted-foreground">
                    <span className="flex items-center gap-1">
                      <Calendar className="w-3.5 h-3.5" />
                      {new Date(t.startsAt).toLocaleDateString()} - {new Date(t.endsAt).toLocaleDateString()}
                    </span>
                    {t.capacity != null && (
                      <span className="flex items-center gap-1">
                        <Users className="w-3.5 h-3.5" />
                        Capacity: {t.capacity}
                      </span>
                    )}
                    <span className="flex items-center gap-1">
                      <Coins className="w-3.5 h-3.5" />
                      Entry: {t.entryCostGn} GN
                    </span>
                  </div>
                </div>
                <div className="shrink-0">
                  {joined ? (
                    <Badge variant="secondary">Joined</Badge>
                  ) : (
                    <Button
                      size="sm"
                      onClick={() => handleJoin(t.id, t.entryCostGn)}
                      disabled={!user || busyId === t.id}
                    >
                      Join ({t.entryCostGn} GN)
                    </Button>
                  )}
                </div>
              </div>
            </Card>
          );
        })}
      </div>
    </div>
  );
}
```

- [ ] **Step 2: Register the route in `App.tsx`**

Add to imports:

```tsx
import TournamentsPage from "@/pages/Tournaments";
```

Inside the `<Switch>` block, add (near other public routes):

```tsx
<Route path="/tournaments" component={TournamentsPage} />
```

- [ ] **Step 3: Run typecheck + client tests**

```bash
pnpm check
pnpm test:client
```

Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git add client/src/pages/Tournaments.tsx client/src/App.tsx
git commit -m "feat(tournaments): /tournaments public discovery page with join flow"
```

---

## Task 6: Client — admin tournament pages

**Files:**
- Create: `client/src/pages/admin/TournamentsList.tsx`
- Create: `client/src/pages/admin/TournamentNew.tsx`
- Create: `client/src/pages/admin/TournamentEdit.tsx`
- Modify: `client/src/App.tsx`

- [ ] **Step 1: Create TournamentsList page**

Create `client/src/pages/admin/TournamentsList.tsx`:

```tsx
import { Link } from "wouter";
import { trpc } from "@/lib/trpc";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Plus } from "lucide-react";

export default function TournamentsList() {
  // For Phase 4 v1, we list open tournaments. A future enhancement
  // surfaces draft + completed + cancelled via additional procedures.
  const open = trpc.tournaments.listOpen.useQuery();

  return (
    <div className="container max-w-3xl py-8">
      <div className="flex items-center justify-between mb-4">
        <h1 className="text-2xl font-bold">Tournaments (Admin)</h1>
        <Button asChild>
          <Link to="/admin/tournaments/new">
            <Plus className="w-4 h-4 mr-1" /> New tournament
          </Link>
        </Button>
      </div>
      <div className="grid gap-2">
        {(open.data ?? []).map((t) => (
          <Card key={t.id} className="p-3 flex items-center justify-between">
            <div>
              <Link to={`/admin/tournaments/${t.id}`} className="font-medium hover:underline">
                {t.name}
              </Link>
              <div className="text-xs text-muted-foreground">
                {t.entryCostGn} GN entry - capacity {t.capacity ?? "unlimited"}
              </div>
            </div>
            <Badge>{t.status}</Badge>
          </Card>
        ))}
        {(open.data ?? []).length === 0 && (
          <p className="text-muted-foreground text-sm">No open tournaments. Create one to get started.</p>
        )}
      </div>
    </div>
  );
}
```

- [ ] **Step 2: Create TournamentNew page**

Create `client/src/pages/admin/TournamentNew.tsx`:

```tsx
import { useState, type FormEvent } from "react";
import { useLocation } from "wouter";
import { trpc } from "@/lib/trpc";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { toast } from "sonner";

export default function TournamentNew() {
  const [, navigate] = useLocation();
  const create = trpc.tournaments.admin.create.useMutation();

  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [entryCostGn, setEntryCostGn] = useState<number>(0);
  const [capacity, setCapacity] = useState<string>("");
  const [startsAt, setStartsAt] = useState("");
  const [endsAt, setEndsAt] = useState("");

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();
    try {
      const result = await create.mutateAsync({
        name,
        description: description || undefined,
        entryCostGn,
        capacity: capacity ? parseInt(capacity, 10) : undefined,
        startsAt: new Date(startsAt).toISOString(),
        endsAt: new Date(endsAt).toISOString(),
      });
      toast.success("Tournament created (draft).");
      navigate(`/admin/tournaments/${result.id}`);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to create");
    }
  };

  return (
    <div className="container max-w-xl py-8">
      <h1 className="text-2xl font-bold mb-4">New Tournament</h1>
      <Card className="p-4">
        <form onSubmit={handleSubmit} className="space-y-3">
          <div>
            <Label htmlFor="name">Name</Label>
            <Input id="name" value={name} onChange={(e) => setName(e.target.value)} required />
          </div>
          <div>
            <Label htmlFor="description">Description</Label>
            <Textarea id="description" value={description} onChange={(e) => setDescription(e.target.value)} rows={3} />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <Label htmlFor="entryCostGn">Entry cost (GN)</Label>
              <Input
                id="entryCostGn"
                type="number"
                min={0}
                value={entryCostGn}
                onChange={(e) => setEntryCostGn(parseInt(e.target.value, 10) || 0)}
              />
            </div>
            <div>
              <Label htmlFor="capacity">Capacity (optional)</Label>
              <Input
                id="capacity"
                type="number"
                min={1}
                value={capacity}
                onChange={(e) => setCapacity(e.target.value)}
              />
            </div>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <Label htmlFor="startsAt">Starts at</Label>
              <Input
                id="startsAt"
                type="datetime-local"
                value={startsAt}
                onChange={(e) => setStartsAt(e.target.value)}
                required
              />
            </div>
            <div>
              <Label htmlFor="endsAt">Ends at</Label>
              <Input
                id="endsAt"
                type="datetime-local"
                value={endsAt}
                onChange={(e) => setEndsAt(e.target.value)}
                required
              />
            </div>
          </div>
          <Button type="submit" disabled={create.isPending}>
            {create.isPending ? "Creating..." : "Create (draft)"}
          </Button>
        </form>
      </Card>
    </div>
  );
}
```

- [ ] **Step 3: Create TournamentEdit page**

Create `client/src/pages/admin/TournamentEdit.tsx`:

```tsx
import { useParams } from "wouter";
import { trpc } from "@/lib/trpc";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { toast } from "sonner";

export default function TournamentEdit() {
  const params = useParams<{ id: string }>();
  const id = parseInt(params.id, 10);
  const utils = trpc.useUtils();
  const tournament = trpc.tournaments.getById.useQuery({ id });
  const openMut = trpc.tournaments.admin.openTournament.useMutation();
  const startMut = trpc.tournaments.admin.startTournament.useMutation();
  const completeMut = trpc.tournaments.admin.completeTournament.useMutation();
  const cancelMut = trpc.tournaments.admin.cancelTournament.useMutation();

  if (!tournament.data) return <div className="p-8">Loading...</div>;
  const t = tournament.data.tournament;

  const run = async (fn: () => Promise<unknown>, label: string) => {
    try {
      await fn();
      void utils.tournaments.getById.invalidate({ id });
      void utils.tournaments.listOpen.invalidate();
      toast.success(`${label} complete`);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : `${label} failed`);
    }
  };

  return (
    <div className="container max-w-xl py-8">
      <div className="flex items-center justify-between mb-4">
        <h1 className="text-2xl font-bold">{t.name}</h1>
        <Badge>{t.status}</Badge>
      </div>
      <Card className="p-4 space-y-2">
        <div className="text-sm"><strong>Entry cost:</strong> {t.entryCostGn} GN</div>
        <div className="text-sm"><strong>Capacity:</strong> {t.capacity ?? "unlimited"}</div>
        <div className="text-sm"><strong>Roster size:</strong> {tournament.data.rosterSize}</div>
        <div className="text-sm">
          <strong>Window:</strong>{" "}
          {new Date(t.startsAt).toLocaleString()} - {new Date(t.endsAt).toLocaleString()}
        </div>
        {t.description && <div className="text-sm whitespace-pre-line">{t.description}</div>}
      </Card>

      <div className="mt-4 flex flex-wrap gap-2">
        {t.status === "draft" && (
          <Button onClick={() => run(() => openMut.mutateAsync({ id }), "Open")} disabled={openMut.isPending}>
            Open tournament
          </Button>
        )}
        {t.status === "open" && (
          <Button onClick={() => run(() => startMut.mutateAsync({ id }), "Start")} disabled={startMut.isPending}>
            Start tournament (lock roster)
          </Button>
        )}
        {t.status === "in_progress" && (
          <Button onClick={() => run(() => completeMut.mutateAsync({ id }), "Complete")} disabled={completeMut.isPending}>
            Complete tournament
          </Button>
        )}
        {(t.status === "draft" || t.status === "open" || t.status === "in_progress") && (
          <Button
            variant="destructive"
            onClick={() => {
              const reason = prompt("Cancellation reason?");
              if (!reason) return;
              void run(() => cancelMut.mutateAsync({ id, reason }), "Cancel");
            }}
            disabled={cancelMut.isPending}
          >
            Cancel tournament (refund all paid)
          </Button>
        )}
      </div>
    </div>
  );
}
```

- [ ] **Step 4: Register routes in `App.tsx`**

Add imports:

```tsx
import TournamentsList from "@/pages/admin/TournamentsList";
import TournamentNew from "@/pages/admin/TournamentNew";
import TournamentEdit from "@/pages/admin/TournamentEdit";
```

Inside the `<Switch>` block (with other `/admin/*` routes):

```tsx
<Route path="/admin/tournaments" component={TournamentsList} />
<Route path="/admin/tournaments/new" component={TournamentNew} />
<Route path="/admin/tournaments/:id" component={TournamentEdit} />
```

- [ ] **Step 5: Run typecheck + client tests**

```bash
pnpm check
pnpm test:client
```

Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add client/src/pages/admin/TournamentsList.tsx client/src/pages/admin/TournamentNew.tsx client/src/pages/admin/TournamentEdit.tsx client/src/App.tsx
git commit -m "feat(tournaments): admin pages — list, create, edit with lifecycle buttons"
```

---

## Task 7: Client — Tournament tab in ChatTabs

**Files:**
- Modify: `client/src/components/chat/ChatTabs.tsx`

- [ ] **Step 1: Extend `ChatTabs` to support the Tournament tab**

Edit `client/src/components/chat/ChatTabs.tsx`. Changes:

1. Tab state union expands to `"global" | "friends" | "tournament"`:

```tsx
const [tab, setTab] = useState<"global" | "friends" | "tournament">("global");
```

2. Fetch the viewer's tournament memberships and surface as a sub-dropdown when >1:

```tsx
const myTournaments = trpc.tournaments.myMemberships.useQuery(undefined, {
  enabled: !!user,
  staleTime: 60_000,
});
const tournamentMemberships = myTournaments.data ?? [];
const [activeTournamentId, setActiveTournamentId] = useState<number | null>(null);
useEffect(() => {
  if (activeTournamentId == null && tournamentMemberships.length > 0) {
    setActiveTournamentId(tournamentMemberships[0].chatRoomId);
  }
}, [activeTournamentId, tournamentMemberships]);
```

3. Compute the active topic. If on the Tournament tab and the selected tournament has a `chatRoomId`, subscribe to that:

```tsx
const tournamentTopic =
  tab === "tournament" && activeTournamentId != null
    ? `chat:tournament:${activeTournamentId}`
    : null;
const friendsTopic = user ? `chat:user:${user.id}:feed` : null;
const activeTopic =
  tab === "global"
    ? GLOBAL_TOPIC
    : tab === "friends"
    ? friendsTopic
    : tournamentTopic;
```

4. Add a third `useQuery` for the active tournament's initial fetch, gated on tab + room id:

```tsx
const tournamentInitial = trpc.chat.fetchInitial.useQuery(
  { scope: "tournament", roomId: activeTournamentId ?? -1, limit: 50 },
  { enabled: tab === "tournament" && activeTournamentId != null, staleTime: 60_000 },
);

useEffect(() => {
  if (!tournamentInitial.data?.messages || !tournamentTopic) return;
  for (const m of tournamentInitial.data.messages) {
    upsertMessage(tournamentTopic, {
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
}, [tournamentInitial.data, tournamentTopic]);
```

5. Update `handleSend` to route to the tournament scope when the Tournament tab is active:

```tsx
const handleSend = async (body: string) => {
  try {
    const payload =
      tab === "global"
        ? { scope: "global" as const, roomId: GLOBAL_ROOM_ID, body }
        : tab === "friends"
        ? { scope: "friends" as const, body }
        : { scope: "tournament" as const, roomId: activeTournamentId!, body };
    const result = await postMutation.mutateAsync(payload);
    const targetTopic =
      tab === "global" ? GLOBAL_TOPIC
      : tab === "friends" ? friendsTopic!
      : tournamentTopic!;
    upsertMessage(targetTopic, {
      id: Number(result.id),
      scope: tab,
      roomId: tab === "global" ? GLOBAL_ROOM_ID : tab === "tournament" ? activeTournamentId : null,
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

6. Update `TabsList` to 3 columns:

```tsx
<TabsList className="grid grid-cols-3 mx-3 mt-3">
  <TabsTrigger value="global">Global</TabsTrigger>
  <TabsTrigger value="friends">Friends</TabsTrigger>
  <TabsTrigger value="tournament">Tournament</TabsTrigger>
</TabsList>
```

7. Add the `TabsContent value="tournament"` block:

```tsx
const tournamentMessages = useChatMessages(tournamentTopic ?? "");

// inside the TabsContent block
<TabsContent value="tournament" className="flex flex-col flex-1 min-h-0 mt-2">
  {tournamentMemberships.length === 0 ? (
    <div className="flex flex-1 flex-col items-center justify-center text-center px-6 gap-2">
      <p className="text-sm text-muted-foreground">You're not in any tournament.</p>
      <a
        href="/tournaments"
        className="text-sm text-primary underline-offset-2 hover:underline"
      >
        Browse tournaments
      </a>
    </div>
  ) : (
    <>
      {tournamentMemberships.length > 1 && (
        <div className="px-3 pb-2">
          <select
            className="w-full text-sm border rounded px-2 py-1 bg-background"
            value={activeTournamentId ?? ""}
            onChange={(e) => setActiveTournamentId(parseInt(e.target.value, 10))}
          >
            {tournamentMemberships.map((m) => (
              <option key={m.chatRoomId ?? m.tournamentId} value={m.chatRoomId ?? -1}>
                {m.name} ({m.status})
              </option>
            ))}
          </select>
        </div>
      )}
      <ChatMessageList
        messages={tournamentMessages.filter((m) => m.scope === "tournament")}
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

Expected: PASS.

- [ ] **Step 3: Commit**

```bash
git add client/src/components/chat/ChatTabs.tsx
git commit -m "feat(tournaments): Tournament tab in ChatTabs with multi-tournament sub-dropdown"
```

---

## Task 8: End-to-end manual verification

**Files:** none — verification gate only.

- [ ] **Step 1: Build + dev**

```bash
pnpm build && pnpm dev
```

Expected: clean build, dev server boots.

- [ ] **Step 2: Admin: create + open a tournament**

Sign in as an admin user. Navigate to `/admin/tournaments`. Click "New tournament". Fill out the form (set entry cost to 5 GN, capacity to 5, dates in the future). Submit. You should land on the edit page with status=`draft`. Click "Open tournament" — status flips to `open`.

- [ ] **Step 3: User: join via /tournaments**

Sign in as a non-admin with at least 5 GN. Navigate to `/tournaments`. The tournament from Step 2 should appear. Click "Join (5 GN)" — modal confirm. After success, GN balance drops by 5; the button changes to a "Joined" badge.

- [ ] **Step 4: Tournament chat**

Open chat. Click the **Tournament** tab. Verify the tournament chat surface opens with an empty message list. Post a message. Open a second browser as another tournament member (e.g., have the admin `addMember` via `/admin/tournaments/:id` member section — or skip and have the admin themselves join via `payEntry`). Verify realtime delivery between the two members.

- [ ] **Step 5: Cancellation refund**

As the admin, navigate to `/admin/tournaments/:id` and click "Cancel tournament". Provide a reason. The non-admin user's GN balance should be restored by 5. The tournament status flips to `cancelled`. The chat tab for that tournament should now be empty (the user is removed from active membership… actually the cancellation flow in this plan keeps the user in `tournament_members` with `entry_method='paid'`, just refunded — verify the actual behavior matches: cancellation leaves members in the table but the chat tab becomes read-only).

- [ ] **Step 6: Capacity check**

Create a new tournament with capacity=2. Have 3 users try to join. The 3rd should get "Tournament is full."

- [ ] **Step 7: Insufficient GN check**

Have a user with 0 GN attempt to join a paid tournament. Expected toast: "Not enough Golden Notes. You need X, have 0."

No commit for this task.

---

## Phase 4 done. Phase 5 preview

Phase 4 ships:
- Admin `/admin/tournaments` CRUD with status lifecycle buttons
- Public `/tournaments` discovery page
- Atomic GN-paid entry transaction
- Tournament tab in chat with multi-tournament dropdown
- Cancellation refund flow

Phase 5 will add the full moderation tooling:
- Mute mutations (visible + shadow) in `chat.admin`
- `/admin/chat` dashboard — activity, bans, audit log, user lookup
- Edit-message with `previous_body` snapshots
- Manage anyone's favorites override
- Flag review queue
- Ban revocation UI

The Phase 2 minimal admin actions (delete, global ban) get promoted from per-message `window.prompt` dialogs to proper modals in Phase 5.
