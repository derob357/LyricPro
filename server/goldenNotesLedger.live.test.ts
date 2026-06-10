// DB-gated integration tests for the pool-aware ledger (spendGoldenNotes /
// creditGoldenNotes).  Skipped when no DATABASE_URL is present — they run
// against the real DB on the controller's machine, not in CI.
//
// Sentinel user IDs are negative so they can never collide with real rows.
// afterEach cleans up all rows for sentinel IDs to keep the DB pristine.

import { describe, it, expect, afterEach } from "vitest";
import { eq, or } from "drizzle-orm";
import { goldenNoteBalances, goldenNoteTransactions } from "../drizzle/schema";
import { SIGNUP_GRANT } from "./_core/stakeMath";

const DB_URL =
  process.env.SUPABASE_SESSION_POOLER_STRING ??
  process.env.SUPABASE_DIRECT_CONNECTION_STRING ??
  process.env.DATABASE_URL;

const liveDescribe = DB_URL ? describe : describe.skip;

// Sentinel user IDs — negative so they never collide with real users.
const U1 = -9001;
const U2 = -9002;
const U3 = -9003;
const U4 = -9004;

async function getDb() {
  const { getDb: _getDb } = await import("./db");
  const db = await _getDb();
  if (!db) throw new Error("DB not available");
  return db;
}

async function cleanup(userIds: number[]) {
  const db = await getDb();
  // Delete in FK-safe order: transactions first, then balances.
  for (const uid of userIds) {
    await db.delete(goldenNoteTransactions).where(eq(goldenNoteTransactions.userId, uid));
    await db.delete(goldenNoteBalances).where(eq(goldenNoteBalances.userId, uid));
  }
}

async function seedBalance(
  userId: number,
  earned: number,
  purchased: number,
) {
  const db = await getDb();
  const total = earned + purchased;
  await db
    .insert(goldenNoteBalances)
    .values({
      userId,
      balance: total,
      earnedBalance: earned,
      purchasedBalance: purchased,
    })
    .onConflictDoNothing();
  // If row already existed (unlikely with sentinels), UPDATE it.
  await db
    .update(goldenNoteBalances)
    .set({ balance: total, earnedBalance: earned, purchasedBalance: purchased })
    .where(eq(goldenNoteBalances.userId, userId));
}

liveDescribe("goldenNotesLedger — pool-aware spend (live DB)", () => {
  afterEach(async () => {
    await cleanup([U1, U2, U3, U4]);
  });

  it("purchased-first: drains purchased before earned, balance === sum invariant", async () => {
    const db = await getDb();
    const { spendGoldenNotes } = await import("./_core/goldenNotesLedger");

    // U1: purchased=10, earned=20 total=30, spend 15 → fromPurchased=10, fromEarned=5
    await seedBalance(U1, 20, 10);

    const result = await db.transaction(async (tx) =>
      spendGoldenNotes(tx, U1, 15, "spend_extra_game", "test purchased-first"),
    );

    expect(result.deduped).toBe(false);
    expect(result.newBalance).toBe(15);

    const [bal] = await db
      .select()
      .from(goldenNoteBalances)
      .where(eq(goldenNoteBalances.userId, U1));

    expect(bal.balance).toBe(15);
    expect(bal.purchasedBalance).toBe(0);   // 10 - 10 = 0
    expect(bal.earnedBalance).toBe(15);     // 20 - 5 = 15
    // Invariant: balance === earned + purchased
    expect(bal.balance).toBe(bal.earnedBalance + bal.purchasedBalance);
  });

  it("earned-only: throws even when purchased balance covers the cost", async () => {
    const db = await getDb();
    const { spendGoldenNotes } = await import("./_core/goldenNotesLedger");

    // U2: earned=5 (insufficient), purchased=100 (plentiful)
    await seedBalance(U2, 5, 100);

    await expect(
      db.transaction(async (tx) =>
        spendGoldenNotes(tx, U2, 50, "stake_escrow", "test earned-only", {
          pool: "earned-only",
        }),
      ),
    ).rejects.toThrow(/insufficient/i);

    // Balance unchanged
    const [bal] = await db
      .select()
      .from(goldenNoteBalances)
      .where(eq(goldenNoteBalances.userId, U2));
    expect(bal.purchasedBalance).toBe(100);
    expect(bal.earnedBalance).toBe(5);
  });

  it("idempotency: replay with same idempotencyKey returns deduped without double-debit", async () => {
    const db = await getDb();
    const { spendGoldenNotes } = await import("./_core/goldenNotesLedger");

    await seedBalance(U3, 0, 100);
    const idem = `test-idem-spend-${U3}-${Date.now()}`;

    const first = await db.transaction(async (tx) =>
      spendGoldenNotes(tx, U3, 10, "spend_extra_game", "idem test", {
        idempotencyKey: idem,
      }),
    );

    const second = await db.transaction(async (tx) =>
      spendGoldenNotes(tx, U3, 10, "spend_extra_game", "idem test", {
        idempotencyKey: idem,
      }),
    );

    expect(first.deduped).toBe(false);
    expect(second.deduped).toBe(true);
    // Balance is 90 from first debit only — second was a no-op.
    expect(second.newBalance).toBe(first.newBalance);

    const [bal] = await db
      .select()
      .from(goldenNoteBalances)
      .where(eq(goldenNoteBalances.userId, U3));
    expect(bal.balance).toBe(90);

    // Only one transaction row written.
    const txns = await db
      .select()
      .from(goldenNoteTransactions)
      .where(eq(goldenNoteTransactions.userId, U3));
    expect(txns).toHaveLength(1);
  });

  it("earned credit lands in earnedBalance, not purchasedBalance", async () => {
    const db = await getDb();
    const { creditGoldenNotes } = await import("./_core/goldenNotesLedger");

    await seedBalance(U4, 0, 0);

    const result = await db.transaction(async (tx) =>
      creditGoldenNotes(tx, U4, 25, "stake_win", "Round 1 win", undefined, {
        pool: "earned",
      }),
    );

    expect(result.deduped).toBe(false);
    expect(result.newBalance).toBe(25);

    const [bal] = await db
      .select()
      .from(goldenNoteBalances)
      .where(eq(goldenNoteBalances.userId, U4));

    expect(bal.balance).toBe(25);
    expect(bal.earnedBalance).toBe(25);
    expect(bal.purchasedBalance).toBe(0);
    // Invariant
    expect(bal.balance).toBe(bal.earnedBalance + bal.purchasedBalance);
  });

  it("sequential retry idempotency: separate-tx replay of same spend key debits balance exactly once", async () => {
    // Simulates a realistic client-retry scenario: first request succeeds and
    // commits, then the client retries (e.g. network timeout before ack) with
    // the same idempotencyKey in a fresh transaction.
    //
    // A true concurrent race test is impractical in a serial live-test suite.
    // The lock-then-check restructure makes the sequential test + code
    // inspection sufficient: the FOR UPDATE lock serializes same-user same-key
    // races, so the post-lock idempotency check is always authoritative.
    const db = await getDb();
    const { spendGoldenNotes } = await import("./_core/goldenNotesLedger");

    await seedBalance(U4, 0, 100);
    const idem = `test-idem-seq-retry-${U4}-${Date.now()}`;

    // First request — committed transaction.
    const first = await db.transaction(async (tx) =>
      spendGoldenNotes(tx, U4, 20, "spend_extra_game", "seq-retry first", {
        idempotencyKey: idem,
      }),
    );

    // Second request — separate transaction, same key (client retry).
    const second = await db.transaction(async (tx) =>
      spendGoldenNotes(tx, U4, 20, "spend_extra_game", "seq-retry second", {
        idempotencyKey: idem,
      }),
    );

    expect(first.deduped).toBe(false);
    expect(second.deduped).toBe(true);
    // The deduplicated call returns the recorded balanceAfter, not a new debit.
    expect(second.newBalance).toBe(first.newBalance);

    const [bal] = await db
      .select()
      .from(goldenNoteBalances)
      .where(eq(goldenNoteBalances.userId, U4));
    // Balance debited exactly once: 100 - 20 = 80.
    expect(bal.balance).toBe(80);
    expect(bal.purchasedBalance).toBe(80);
    expect(bal.balance).toBe(bal.earnedBalance + bal.purchasedBalance);

    // Exactly one audit row for this key.
    const txns = await db
      .select()
      .from(goldenNoteTransactions)
      .where(eq(goldenNoteTransactions.userId, U4));
    expect(txns).toHaveLength(1);
    expect(txns[0].idempotencyKey).toBe(idem);
  });

  it("credit idempotency: replay with same key dedupes without double-credit", async () => {
    const db = await getDb();
    const { creditGoldenNotes } = await import("./_core/goldenNotesLedger");

    await seedBalance(U1, 0, 0);
    const idem = `test-idem-credit-${U1}-${Date.now()}`;

    const first = await db.transaction(async (tx) =>
      creditGoldenNotes(tx, U1, 100, "signup_grant", "Welcome", undefined, {
        pool: "earned",
        idempotencyKey: idem,
      }),
    );

    const second = await db.transaction(async (tx) =>
      creditGoldenNotes(tx, U1, 100, "signup_grant", "Welcome", undefined, {
        pool: "earned",
        idempotencyKey: idem,
      }),
    );

    expect(first.deduped).toBe(false);
    expect(second.deduped).toBe(true);
    expect(second.newBalance).toBe(first.newBalance);

    const [bal] = await db
      .select()
      .from(goldenNoteBalances)
      .where(eq(goldenNoteBalances.userId, U1));
    expect(bal.balance).toBe(100);       // only credited once
    expect(bal.earnedBalance).toBe(100);

    const txns = await db
      .select()
      .from(goldenNoteTransactions)
      .where(eq(goldenNoteTransactions.userId, U1));
    expect(txns).toHaveLength(1);
  });
});

// ─── Task 6: Signup grant ──────────────────────────────────────────────────────
// Tests mirror the exact idempotency-key format used by upsertUser:
//   `signup-grant-${userId}`
// Sentinel user ids U1/U2 are reused (cleanup from the suite above runs first).

liveDescribe("goldenNotesLedger — signup grant (live DB)", () => {
  const SG1 = -9011; // sentinel: signup-grant test user 1
  const SG2 = -9012; // sentinel: signup-grant test user 2

  afterEach(async () => {
    const db = await getDb();
    for (const uid of [SG1, SG2]) {
      await db.delete(goldenNoteTransactions).where(eq(goldenNoteTransactions.userId, uid));
      await db.delete(goldenNoteBalances).where(eq(goldenNoteBalances.userId, uid));
    }
  });

  it("signup grant: 100 GN lands in earnedBalance, purchasedBalance untouched", async () => {
    const db = await getDb();
    const { creditGoldenNotes } = await import("./_core/goldenNotesLedger");

    // Start from zero balance (no prior seed — creditGoldenNotes creates the row).
    const result = await db.transaction(async (tx) =>
      creditGoldenNotes(tx, SG1, SIGNUP_GRANT, "signup_grant", "Welcome bonus", undefined, {
        pool: "earned",
        idempotencyKey: `signup-grant-${SG1}`,
      }),
    );

    expect(result.deduped).toBe(false);
    expect(result.newBalance).toBe(SIGNUP_GRANT);

    const [bal] = await db
      .select()
      .from(goldenNoteBalances)
      .where(eq(goldenNoteBalances.userId, SG1));

    expect(bal.balance).toBe(SIGNUP_GRANT);
    expect(bal.earnedBalance).toBe(SIGNUP_GRANT);
    expect(bal.purchasedBalance).toBe(0);
    expect(bal.balance).toBe(bal.earnedBalance + bal.purchasedBalance);

    const txns = await db
      .select()
      .from(goldenNoteTransactions)
      .where(eq(goldenNoteTransactions.userId, SG1));
    expect(txns).toHaveLength(1);
    expect(txns[0].kind).toBe("signup_grant");
    expect(txns[0].idempotencyKey).toBe(`signup-grant-${SG1}`);
  });

  it("signup grant: second call with same key dedupes — no double-credit", async () => {
    const db = await getDb();
    const { creditGoldenNotes } = await import("./_core/goldenNotesLedger");

    const idemKey = `signup-grant-${SG2}`;

    const first = await db.transaction(async (tx) =>
      creditGoldenNotes(tx, SG2, SIGNUP_GRANT, "signup_grant", "Welcome bonus", undefined, {
        pool: "earned",
        idempotencyKey: idemKey,
      }),
    );

    // Simulate a second login (or retry) — same idempotency key.
    const second = await db.transaction(async (tx) =>
      creditGoldenNotes(tx, SG2, SIGNUP_GRANT, "signup_grant", "Welcome bonus", undefined, {
        pool: "earned",
        idempotencyKey: idemKey,
      }),
    );

    expect(first.deduped).toBe(false);
    expect(second.deduped).toBe(true);
    expect(second.newBalance).toBe(first.newBalance);

    const [bal] = await db
      .select()
      .from(goldenNoteBalances)
      .where(eq(goldenNoteBalances.userId, SG2));

    // Credited exactly once.
    expect(bal.balance).toBe(SIGNUP_GRANT);
    expect(bal.earnedBalance).toBe(SIGNUP_GRANT);

    const txns = await db
      .select()
      .from(goldenNoteTransactions)
      .where(eq(goldenNoteTransactions.userId, SG2));
    expect(txns).toHaveLength(1);
  });
});
