// DB-gated integration tests for stakeEngine.ts.
// Skipped when no DATABASE_URL / SUPABASE_* env is present — run against the
// real DB on the controller's machine, not in CI.
//
// Sentinel user IDs are negative so they never collide with real users.
// Throwaway gameRoom rows use a unique roomCode per test run and are deleted
// in afterAll. All golden_note_balances / golden_note_transactions / gn_stakes
// rows for sentinel IDs are cleaned up after each test.

import { describe, it, expect, afterEach, afterAll } from "vitest";
import { and, eq, lt } from "drizzle-orm";
import { sql } from "drizzle-orm";
import {
  goldenNoteBalances,
  goldenNoteTransactions,
  gnStakes,
  gameRooms,
} from "../drizzle/schema";

const DB_URL =
  process.env.SUPABASE_SESSION_POOLER_STRING ??
  process.env.SUPABASE_DIRECT_CONNECTION_STRING ??
  process.env.DATABASE_URL;

const liveDescribe = DB_URL ? describe : describe.skip;

// ─── Sentinels ────────────────────────────────────────────────────────────────
// Negative user IDs — never collide with real users.
const U1 = -8001; // escrow / idempotency tests
const U2 = -8002; // resolve win
const U3 = -8003; // resolve loss + burn cap
const U4 = -8004; // settle
const U5 = -8005; // sweep
const U6 = -8006; // velocity cap
const ALL_USERS = [U1, U2, U3, U4, U5, U6];

// Unique prefix for room codes so parallel reruns don't collide.
const RUN_ID = Math.abs(Date.now() % 100000).toString().padStart(5, "0");
let insertedRoomIds: number[] = [];

// ─── Helpers ─────────────────────────────────────────────────────────────────

async function getDb() {
  const { getDb: _getDb } = await import("./db");
  const db = await _getDb();
  if (!db) throw new Error("DB not available");
  return db;
}

/** Seed a goldenNoteBalances row for a sentinel user. */
async function seedBalance(
  userId: number,
  earned: number,
  purchased: number,
) {
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

/**
 * Insert a throwaway game_rooms row. Returns the auto-generated id.
 * `status` defaults to 'active' (not finished) so sweep picks it up.
 */
async function insertRoom(
  codePrefix: string,
  status: "waiting" | "active" | "finished" = "active",
): Promise<number> {
  const db = await getDb();
  const roomCode = `${codePrefix.slice(0, 3).toUpperCase()}${RUN_ID}`.slice(0, 8);
  const [row] = await db
    .insert(gameRooms)
    .values({
      roomCode,
      mode: "solo",
      selectedGenres: "[]",
      selectedDecades: "[]",
      status,
    })
    .returning({ id: gameRooms.id });
  insertedRoomIds.push(row.id);
  return row.id;
}

/** Delete all test-owned data for a set of userIds. */
async function cleanup(userIds: number[]) {
  const db = await getDb();
  for (const uid of userIds) {
    // Delete gn_stakes for this user (may reference inserted rooms).
    await db.delete(gnStakes).where(eq(gnStakes.userId, uid));
    // Delete golden notes data.
    await db
      .delete(goldenNoteTransactions)
      .where(eq(goldenNoteTransactions.userId, uid));
    await db
      .delete(goldenNoteBalances)
      .where(eq(goldenNoteBalances.userId, uid));
  }
}

// ─── Teardown ─────────────────────────────────────────────────────────────────

afterEach(async () => {
  await cleanup(ALL_USERS);
});

afterAll(async () => {
  // Delete throwaway rooms after all tests (rooms have no FK back to users).
  if (insertedRoomIds.length > 0) {
    const db = await getDb();
    // Delete any residual gn_stakes referencing these rooms (belt-and-braces).
    for (const roomId of insertedRoomIds) {
      await db.delete(gnStakes).where(eq(gnStakes.roomId, roomId));
    }
    for (const roomId of insertedRoomIds) {
      await db.delete(gameRooms).where(eq(gameRooms.id, roomId));
    }
    insertedRoomIds = [];
  }
});

// ─── Tests ────────────────────────────────────────────────────────────────────

liveDescribe("stakeEngine (live DB)", () => {
  // ── 1. escrow: debits earned-only, creates the gn_stakes row, and dedupes ──

  it("escrow: debits earnedBalance and creates gn_stakes row", async () => {
    const db = await getDb();
    const { escrowStake } = await import("./_core/stakeEngine");

    await seedBalance(U1, 100, 50); // earned=100, purchased=50
    const roomId = await insertRoom("E1U", "active");

    const result = await db.transaction(async (tx) =>
      escrowStake(tx, U1, roomId, 50),
    );

    expect(result).toEqual({ staked: 50 });

    // earnedBalance drained by 50; purchasedBalance untouched.
    const [bal] = await db
      .select()
      .from(goldenNoteBalances)
      .where(eq(goldenNoteBalances.userId, U1));
    expect(bal.balance).toBe(100);        // 150 - 50
    expect(bal.earnedBalance).toBe(50);   // 100 - 50
    expect(bal.purchasedBalance).toBe(50); // unchanged
    expect(bal.balance).toBe(bal.earnedBalance + bal.purchasedBalance);

    // gn_stakes row created.
    const [stake] = await db
      .select()
      .from(gnStakes)
      .where(and(eq(gnStakes.roomId, roomId), eq(gnStakes.userId, U1)));
    expect(stake).toBeDefined();
    expect(stake.staked).toBe(50);
    expect(stake.burned).toBe(0);
    expect(stake.state).toBe("active");
  });

  it("escrow: second call with same roomId+userId dedupes (idempotent)", async () => {
    const db = await getDb();
    const { escrowStake } = await import("./_core/stakeEngine");

    await seedBalance(U1, 100, 0);
    const roomId = await insertRoom("E2U", "active");

    // First escrow.
    await db.transaction(async (tx) => escrowStake(tx, U1, roomId, 50));

    // Second escrow (client retry) — the spend dedupes via idempotencyKey and
    // the gnStakes insert uses onConflictDoNothing.
    await db.transaction(async (tx) => escrowStake(tx, U1, roomId, 50));

    // Balance debited exactly once.
    const [bal] = await db
      .select()
      .from(goldenNoteBalances)
      .where(eq(goldenNoteBalances.userId, U1));
    expect(bal.balance).toBe(50); // 100 - 50, only once

    // Exactly one gn_stakes row.
    const rows = await db
      .select()
      .from(gnStakes)
      .where(and(eq(gnStakes.roomId, roomId), eq(gnStakes.userId, U1)));
    expect(rows).toHaveLength(1);
  });

  // ── 2. resolveRoundStake: win credits +25 earned; loss burns 25 from stake ─

  it("resolveRoundStake: win round credits +25 earnedBalance and increments wonRounds", async () => {
    const db = await getDb();
    const { escrowStake, resolveRoundStake } = await import("./_core/stakeEngine");

    await seedBalance(U2, 100, 0);
    const roomId = await insertRoom("RW2", "active");
    await db.transaction(async (tx) => escrowStake(tx, U2, roomId, 50));

    const roundResult = await resolveRoundStake(db, roomId, U2, 3, 1); // 3 correct → win

    expect(roundResult).not.toBeNull();
    expect(roundResult!.win).toBe(25);
    expect(roundResult!.burn).toBe(0);
    expect(roundResult!.remaining).toBe(50); // stake unchanged (burn=0)

    // earnedBalance credited by 25.
    const [bal] = await db
      .select()
      .from(goldenNoteBalances)
      .where(eq(goldenNoteBalances.userId, U2));
    // Started at 100 earned, spent 50 on escrow → 50 earned. Won 25 → 75.
    expect(bal.earnedBalance).toBe(75);

    // wonRounds incremented.
    const [stake] = await db
      .select()
      .from(gnStakes)
      .where(and(eq(gnStakes.roomId, roomId), eq(gnStakes.userId, U2)));
    expect(stake.wonRounds).toBe(1);
  });

  it("resolveRoundStake: loss round burns 25 from stake (no balance movement)", async () => {
    const db = await getDb();
    const { escrowStake, resolveRoundStake } = await import("./_core/stakeEngine");

    await seedBalance(U3, 100, 0);
    const roomId = await insertRoom("RL3", "active");
    await db.transaction(async (tx) => escrowStake(tx, U3, roomId, 50));

    const roundResult = await resolveRoundStake(db, roomId, U3, 2, 1); // 2 correct → loss

    expect(roundResult).not.toBeNull();
    expect(roundResult!.win).toBe(0);
    expect(roundResult!.burn).toBe(25);
    expect(roundResult!.remaining).toBe(25); // 50 staked - 25 burned = 25

    // Balance unchanged — burns don't move money (escrow already left).
    const [bal] = await db
      .select()
      .from(goldenNoteBalances)
      .where(eq(goldenNoteBalances.userId, U3));
    expect(bal.earnedBalance).toBe(50); // 100 - 50 escrow, no credit

    // burned incremented.
    const [stake] = await db
      .select()
      .from(gnStakes)
      .where(and(eq(gnStakes.roomId, roomId), eq(gnStakes.userId, U3)));
    expect(stake.burned).toBe(25);
  });

  it("resolveRoundStake: burn caps at remaining stake (does not go negative)", async () => {
    const db = await getDb();
    const { escrowStake, resolveRoundStake } = await import("./_core/stakeEngine");

    await seedBalance(U3, 100, 0);
    const roomId = await insertRoom("RC3", "active");
    await db.transaction(async (tx) => escrowStake(tx, U3, roomId, 25));

    // Two loss rounds: first burns 25 (all remaining), second should burn 0.
    await resolveRoundStake(db, roomId, U3, 1, 1); // 1 correct → loss, burns 25

    const [stakeAfterFirst] = await db
      .select()
      .from(gnStakes)
      .where(and(eq(gnStakes.roomId, roomId), eq(gnStakes.userId, U3)));
    expect(stakeAfterFirst.burned).toBe(25); // exhausted

    const secondResult = await resolveRoundStake(db, roomId, U3, 0, 2); // 0 correct → loss, burn capped
    expect(secondResult!.burn).toBe(0); // capped — nothing left to burn
    expect(secondResult!.remaining).toBe(0);
  });

  // ── 3. settleStake: refunds staked-burned exactly once ─────────────────────

  it("settleStake: refunds staked-burned to earnedBalance; second call returns null", async () => {
    const db = await getDb();
    const { escrowStake, resolveRoundStake, settleStake } = await import("./_core/stakeEngine");

    await seedBalance(U4, 100, 0);
    const roomId = await insertRoom("ST4", "finished");

    await db.transaction(async (tx) => escrowStake(tx, U4, roomId, 50));
    // One loss round burns 25.
    await resolveRoundStake(db, roomId, U4, 2, 1);

    const settled = await settleStake(db, roomId, U4);
    expect(settled).not.toBeNull();
    expect(settled!.refund).toBe(25);    // staked 50 - burned 25 = 25 refund
    expect(settled!.burned).toBe(25);

    // earnedBalance: started 100, escrow -50 → 50. Refund +25 → 75.
    const [bal] = await db
      .select()
      .from(goldenNoteBalances)
      .where(eq(goldenNoteBalances.userId, U4));
    expect(bal.earnedBalance).toBe(75);
    expect(bal.balance).toBe(bal.earnedBalance + bal.purchasedBalance);

    // Stake state is 'settled'.
    const [stake] = await db
      .select()
      .from(gnStakes)
      .where(and(eq(gnStakes.roomId, roomId), eq(gnStakes.userId, U4)));
    expect(stake.state).toBe("settled");
    expect(stake.settledAt).not.toBeNull();

    // Second call → null (already settled — state guard prevents double-refund).
    const second = await settleStake(db, roomId, U4);
    expect(second).toBeNull();

    // Balance still 75 — no double credit.
    const [balAfter] = await db
      .select()
      .from(goldenNoteBalances)
      .where(eq(goldenNoteBalances.userId, U4));
    expect(balAfter.earnedBalance).toBe(75);
  });

  // ── 4. sweepAbandonedStakes: refunds aged active stakes; idempotent ─────────

  it("sweepAbandonedStakes: refunds an aged active stake on an unfinished room and is idempotent", async () => {
    const db = await getDb();
    const { escrowStake, sweepAbandonedStakes } = await import("./_core/stakeEngine");

    await seedBalance(U5, 100, 0);
    const roomId = await insertRoom("SW5", "active"); // status != finished → eligible

    // Escrow the stake.
    await db.transaction(async (tx) => escrowStake(tx, U5, roomId, 50));

    // Back-date the stake's createdAt to more than ABANDON_HOURS ago so the
    // sweep cutoff query picks it up.
    await db
      .update(gnStakes)
      .set({ createdAt: sql`now() - make_interval(hours => 7)` }) // 7h > 6h cutoff
      .where(and(eq(gnStakes.roomId, roomId), eq(gnStakes.userId, U5)));

    // First sweep — should refund.
    const first = await sweepAbandonedStakes(db);
    expect(first.refunded).toBeGreaterThanOrEqual(1);

    // earnedBalance: 100 - 50 escrow + 50 refund = 100.
    const [bal] = await db
      .select()
      .from(goldenNoteBalances)
      .where(eq(goldenNoteBalances.userId, U5));
    expect(bal.earnedBalance).toBe(100);
    expect(bal.balance).toBe(bal.earnedBalance + bal.purchasedBalance);

    // Stake is now 'refunded'.
    const [stake] = await db
      .select()
      .from(gnStakes)
      .where(and(eq(gnStakes.roomId, roomId), eq(gnStakes.userId, U5)));
    expect(stake.state).toBe("refunded");

    // Second sweep — same stake already 'refunded', no further action.
    const second = await sweepAbandonedStakes(db);
    // The stake is now 'refunded', not 'active' → sweep skips it entirely.
    // refunded count for our sentinel might be 0 or reflect other rows; just
    // verify our user's balance is unchanged.
    const [balAfter] = await db
      .select()
      .from(goldenNoteBalances)
      .where(eq(goldenNoteBalances.userId, U5));
    expect(balAfter.earnedBalance).toBe(100); // no double-credit
  });

  // ── 5. velocity cap: 11th staked game within an hour throws ─────────────────

  it("velocity cap: throws on the 11th staked game within an hour", async () => {
    const db = await getDb();
    const { escrowStake } = await import("./_core/stakeEngine");

    await seedBalance(U6, 1000, 0); // plenty of earned GN

    // Insert 10 gn_stakes rows directly (no escrow transaction overhead).
    // These rows must have: userId=U6, state='active', createdAt < 1h ago is FALSE
    // (i.e. createdAt is recent — within the last hour). Drizzle default for
    // createdAt is now() so freshly inserted rows are within the hour.
    const roomIds: number[] = [];
    for (let i = 0; i < 10; i++) {
      const rid = await insertRoom(`VC${i}`, "active");
      roomIds.push(rid);
      await db.insert(gnStakes).values({
        roomId: rid,
        userId: U6,
        staked: 25,
        state: "active",
      });
    }

    // 11th stake attempt — should throw velocity cap error.
    const extraRoom = await insertRoom("VCX", "active");
    await expect(
      db.transaction(async (tx) => escrowStake(tx, U6, extraRoom, 25)),
    ).rejects.toThrow(/stake limit/i);

    // Cleanup extra room ids.
    insertedRoomIds.push(extraRoom);
  });
});
