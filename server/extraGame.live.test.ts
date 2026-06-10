// DB-gated integration tests for purchaseExtraGame + checkGameEligibility widening.
// Skipped when no DATABASE_URL / SUPABASE_* env is present — run against the
// real DB on the controller's machine, not in CI.
//
// Sentinel user IDs are negative so they never collide with real users.
// afterEach cleans up all rows for sentinel IDs to keep the DB pristine.

import { describe, it, expect, afterEach } from "vitest";
import { eq, and, sql } from "drizzle-orm";
import {
  goldenNoteBalances,
  goldenNoteTransactions,
  gameSessions,
} from "../drizzle/schema";

const DB_URL =
  process.env.SUPABASE_SESSION_POOLER_STRING ??
  process.env.SUPABASE_DIRECT_CONNECTION_STRING ??
  process.env.DATABASE_URL;

const liveDescribe = DB_URL ? describe : describe.skip;

// Sentinel IDs — never collide with real users.
const EG1 = -7001; // purchaseExtraGame tests
const EG2 = -7002; // eligibility widening tests

async function getDb() {
  const { getDb: _getDb } = await import("./db");
  const db = await _getDb();
  if (!db) throw new Error("DB not available");
  return db;
}

async function cleanup(userIds: number[]) {
  const db = await getDb();
  for (const uid of userIds) {
    await db.delete(goldenNoteTransactions).where(eq(goldenNoteTransactions.userId, uid));
    await db.delete(gameSessions).where(eq(gameSessions.userId, uid));
    await db.delete(goldenNoteBalances).where(eq(goldenNoteBalances.userId, uid));
  }
}

async function seedBalance(userId: number, earned: number, purchased: number) {
  const db = await getDb();
  const total = earned + purchased;
  await db
    .insert(goldenNoteBalances)
    .values({ userId, balance: total, earnedBalance: earned, purchasedBalance: purchased })
    .onConflictDoNothing();
  await db
    .update(goldenNoteBalances)
    .set({ balance: total, earnedBalance: earned, purchasedBalance: purchased })
    .where(eq(goldenNoteBalances.userId, userId));
}

liveDescribe("purchaseExtraGame (live DB)", () => {
  afterEach(async () => {
    await cleanup([EG1, EG2]);
  });

  it("debits 1 GN purchased-first and records a spend_extra_game transaction", async () => {
    const db = await getDb();
    // Seed purchased pool only (typical real-money buyer scenario).
    await seedBalance(EG1, 0, 10);

    const { spendGoldenNotes } = await import("./_core/goldenNotesLedger");
    const result = await db.transaction(async (tx) =>
      spendGoldenNotes(tx, EG1, 1, "spend_extra_game", "Extra game", {}),
    );

    expect(result.deduped).toBe(false);
    expect(result.newBalance).toBe(9);

    const [bal] = await db
      .select()
      .from(goldenNoteBalances)
      .where(eq(goldenNoteBalances.userId, EG1));
    expect(bal.balance).toBe(9);
    expect(bal.purchasedBalance).toBe(9); // purchased drained first
    expect(bal.earnedBalance).toBe(0);
    expect(bal.balance).toBe(bal.earnedBalance + bal.purchasedBalance);

    const txns = await db
      .select()
      .from(goldenNoteTransactions)
      .where(eq(goldenNoteTransactions.userId, EG1));
    expect(txns).toHaveLength(1);
    expect(txns[0].kind).toBe("spend_extra_game");
    expect(txns[0].amount).toBe(-1);
  });

  it("replay with same idempotencyKey dedupes — balance debited only once", async () => {
    const db = await getDb();
    await seedBalance(EG1, 0, 10);

    const idem = `extra-game-${EG1}-${Date.now()}`;
    const { spendGoldenNotes } = await import("./_core/goldenNotesLedger");

    const first = await db.transaction(async (tx) =>
      spendGoldenNotes(tx, EG1, 1, "spend_extra_game", "Extra game", {
        idempotencyKey: idem,
      }),
    );

    const second = await db.transaction(async (tx) =>
      spendGoldenNotes(tx, EG1, 1, "spend_extra_game", "Extra game", {
        idempotencyKey: idem,
      }),
    );

    expect(first.deduped).toBe(false);
    expect(second.deduped).toBe(true);
    expect(second.newBalance).toBe(first.newBalance);

    const [bal] = await db
      .select()
      .from(goldenNoteBalances)
      .where(eq(goldenNoteBalances.userId, EG1));
    // Balance debited exactly once: 10 - 1 = 9
    expect(bal.balance).toBe(9);

    // Only one transaction row written.
    const txns = await db
      .select()
      .from(goldenNoteTransactions)
      .where(eq(goldenNoteTransactions.userId, EG1));
    expect(txns).toHaveLength(1);
  });
});

liveDescribe("checkGameEligibility — extra-game widening (live DB)", () => {
  afterEach(async () => {
    await cleanup([EG2]);
  });

  it("eligibility flips from blocked to allowed after an in-window spend_extra_game txn", async () => {
    const db = await getDb();
    const { checkGameEligibility } = await import("./routers/subscriptionEnforcement");

    // No subscription row → free tier with FREE_GAMES_LIMIT = 2.
    // Insert exactly FREE_GAMES_LIMIT game sessions today so the limit is reached.
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const midToday = new Date(today.getTime() + 6 * 60 * 60 * 1000); // 6h into today

    await db.insert(gameSessions).values([
      { userId: EG2, mode: "solo", startedAt: midToday },
      { userId: EG2, mode: "solo", startedAt: midToday },
    ]);

    // Before the extra-game purchase: should be blocked.
    await expect(checkGameEligibility(EG2, 3, 0)).rejects.toThrow(/free game limit/i);

    // Insert a spend_extra_game transaction with a createdAt within today's window.
    await db.insert(goldenNoteTransactions).values({
      userId: EG2,
      amount: -1,
      kind: "spend_extra_game",
      reason: "Extra game test",
      balanceAfter: 0,
      createdAt: midToday,
    });

    // After the purchase: one extra slot added → should now be allowed.
    const result = await checkGameEligibility(EG2, 3, 0);
    expect(result.allowed).toBe(true);
  });
});
