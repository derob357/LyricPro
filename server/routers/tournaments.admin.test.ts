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
    // chat_audit_log is append-only (deny-change trigger from migration
    // 0013); its target_tournament_id FK blocks deletion of any tournament
    // that has audit rows. We delete what we can; any tournament that has
    // an audit entry is intentionally leaked. Each run uses a unique
    // `stamp` so leaked rows are identifiable and re-runs do not collide.
    const db = await getDb();
    if (cleanupTournamentIds.length > 0) {
      await db!.delete(tournamentMembers).where(inArray(tournamentMembers.tournamentId, cleanupTournamentIds));
      for (const id of cleanupTournamentIds) {
        try {
          // chat_rooms.tournament_id has ON DELETE CASCADE, so deleting
          // the tournament also deletes the chat_rooms row when allowed.
          await db!.delete(tournaments).where(eq(tournaments.id, id));
        } catch {
          // FK from chat_audit_log.target_tournament_id blocks — leak it.
        }
      }
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
