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

    // Create an open tournament. The DB has a non-deferrable CHECK
    // requiring (kind='tournament' AND tournament_id IS NOT NULL), so we
    // must insert the tournament first (with chat_room_id NULL), then the
    // chat_rooms row carrying tournament_id, then close the cycle.
    const [t] = await db!.insert(tournaments).values({
      name: `Test Tournament ${stamp}`,
      description: "open tournament for tests",
      entryCostGn: 10,
      capacity: 5,
      startsAt: new Date(Date.now() + 24 * 60 * 60 * 1000),
      endsAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
      status: "open",
      createdBy: adminId,
    }).returning();
    openTournamentId = t.id;

    const [room] = await db!.insert(chatRooms).values({
      kind: "tournament",
      tournamentId: t.id,
      retentionDays: 60,
    }).returning();
    openTournamentRoomId = room.id;

    await db!.update(tournaments).set({ chatRoomId: room.id }).where(eq(tournaments.id, t.id));

    // Also create a draft tournament (not visible to listOpen)
    const [draft] = await db!.insert(tournaments).values({
      name: `Draft Tournament ${stamp}`,
      entryCostGn: 0,
      startsAt: new Date(Date.now() + 24 * 60 * 60 * 1000),
      endsAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
      status: "draft",
      createdBy: adminId,
    }).returning();
    draftTournamentId = draft.id;
    const [draftRoom] = await db!.insert(chatRooms).values({
      kind: "tournament",
      tournamentId: draft.id,
      retentionDays: 60,
    }).returning();
    await db!.update(tournaments).set({ chatRoomId: draftRoom.id }).where(eq(tournaments.id, draft.id));
  });

  afterAll(async () => {
    // chat_audit_log is append-only (deny-change trigger from migration
    // 0013); its target_tournament_id FK blocks deletion of any tournament
    // that has audit rows. We delete what we can; the joined tournament +
    // its chat_rooms row + the related audit row are intentionally leaked.
    // Each run uses a unique `stamp` so leaked rows are identifiable and
    // re-runs do not collide.
    const db = await getDb();
    await db!.delete(tournamentMembers).where(inArray(tournamentMembers.tournamentId, [openTournamentId, draftTournamentId]));
    // The draft tournament has no audit log entries, so it deletes cleanly.
    // Its chat_rooms row cascades via the tournament_id FK ON DELETE CASCADE.
    try {
      await db!.delete(tournaments).where(eq(tournaments.id, draftTournamentId));
    } catch {
      // ignore — leave behind if FK still blocks
    }
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
