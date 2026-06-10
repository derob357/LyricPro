/** Stake lifecycle for solo staked games (accounts only).
 *  Escrow model: ante leaves earnedBalance at createRoom; burns only reduce
 *  the eventual refund (no balance movement — the GN already left); wins
 *  credit earnedBalance immediately; settle refunds staked-burned; the sweep
 *  refunds abandoned actives. Every mutation is idempotent or state-guarded.
 *
 *  Burns intentionally write NO transaction row (no balance movement —
 *  escrow already debited); the gn_stakes row is the burn audit.
 *  getTransactions therefore shows escrow/win/refund only. */

import { and, eq, lt, sql } from "drizzle-orm";
import { gnStakes, gameRooms } from "../../drizzle/schema";
import {
  spendGoldenNotes,
  creditGoldenNotes,
} from "./goldenNotesLedger";
import {
  resolveStakeOutcome,
  ABANDON_HOURS,
  STAKED_GAMES_PER_HOUR_CAP,
} from "./stakeMath";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnyTx = any;

/**
 * Escrow the ante for a staked game. Debits earnedBalance ("earned-only")
 * and inserts a gn_stakes row. Enforces a velocity cap of
 * STAKED_GAMES_PER_HOUR_CAP staked games per rolling hour (D6).
 *
 * Must be called inside an existing transaction.
 * Returns null when ante <= 0 (unstaked game — callers should guard on earned
 * balance before calling, but we still handle it cleanly).
 */
export async function escrowStake(
  tx: AnyTx,
  userId: number,
  roomId: number,
  ante: number,
): Promise<{ staked: number } | null> {
  if (ante <= 0) return null;

  // Velocity cap (D6): max N staked games per rolling hour.
  const recent = await tx
    .select({ n: sql<number>`count(*)::int` })
    .from(gnStakes)
    .where(
      and(
        eq(gnStakes.userId, userId),
        sql`${gnStakes.createdAt} > now() - interval '1 hour'`,
      ),
    );
  const recentCount = recent[0]?.n ?? 0;
  if (recentCount >= STAKED_GAMES_PER_HOUR_CAP) {
    throw new Error(
      `Stake limit: max ${STAKED_GAMES_PER_HOUR_CAP} staked games per hour.`,
    );
  }

  await spendGoldenNotes(
    tx,
    userId,
    ante,
    "stake_escrow",
    `Game stake (room ${roomId})`,
    {
      pool: "earned-only",
      idempotencyKey: `stake-escrow-${roomId}-${userId}`,
    },
  );

  // onConflictDoNothing: if the same (roomId, userId) pair reaches here twice
  // (e.g. client retry after commit), the spend was already deduped above and
  // we just skip the duplicate row insertion.
  await tx
    .insert(gnStakes)
    .values({ roomId, userId, staked: ante })
    .onConflictDoNothing();

  return { staked: ante };
}

/**
 * Called from submitAnswer after scoring. Resolves win or burn for the round
 * and updates the gn_stakes row accordingly. Returns the UI stake payload or
 * null when the game is not staked / no active stake exists.
 *
 * Opens its own transaction internally — callers should NOT wrap this in an
 * outer transaction (submitAnswer already handles its own writes separately).
 */
export async function resolveRoundStake(
  db: AnyTx,
  roomId: number,
  userId: number,
  correctCount: number,
  roundNumber: number,
): Promise<{
  staked: number;
  burned: number;
  win: number;
  burn: number;
  remaining: number;
} | null> {
  return db.transaction(async (tx: AnyTx) => {
    const [stake] = await tx
      .select()
      .from(gnStakes)
      .where(
        and(
          eq(gnStakes.roomId, roomId),
          eq(gnStakes.userId, userId),
          eq(gnStakes.state, "active"),
        ),
      )
      .for("update");

    if (!stake) return null;

    const { win, burn } = resolveStakeOutcome(stake, correctCount);

    if (burn > 0) {
      await tx
        .update(gnStakes)
        .set({ burned: stake.burned + burn })
        .where(eq(gnStakes.id, stake.id));
    }

    if (win > 0) {
      await tx
        .update(gnStakes)
        .set({ wonRounds: stake.wonRounds + 1 })
        .where(eq(gnStakes.id, stake.id));
      await creditGoldenNotes(
        tx,
        userId,
        win,
        "stake_win",
        `Round ${roundNumber} won (room ${roomId})`,
        undefined,
        {
          pool: "earned",
          idempotencyKey: `stake-win-${roomId}-${userId}-r${roundNumber}`,
        },
      );
    }

    const burnedTotal = stake.burned + burn;
    return {
      staked: stake.staked,
      burned: burnedTotal,
      win,
      burn,
      remaining: Math.max(0, stake.staked - burnedTotal),
    };
  });
}

/**
 * Called when a game finishes (nextRound → isGameOver). Transitions the stake
 * from "active" to "settled" and refunds staked-burned to earnedBalance.
 * Idempotent: the UPDATE only fires on state = 'active'; returns null if
 * already settled (second call from a retry or sweep race).
 *
 * Uses the same idempotency key as sweepAbandonedStakes — whichever executes
 * first wins; the other dedupes via the ledger's idempotency check.
 */
export async function settleStake(
  db: AnyTx,
  roomId: number,
  userId: number,
): Promise<{ refund: number; burned: number; wonRounds: number } | null> {
  return db.transaction(async (tx: AnyTx) => {
    const updated = await tx
      .update(gnStakes)
      .set({ state: "settled", settledAt: new Date() })
      .where(
        and(
          eq(gnStakes.roomId, roomId),
          eq(gnStakes.userId, userId),
          eq(gnStakes.state, "active"),
        ),
      )
      .returning();

    const stake = updated[0];
    if (!stake) return null;

    const refund = Math.max(0, stake.staked - stake.burned);
    if (refund > 0) {
      await creditGoldenNotes(
        tx,
        userId,
        refund,
        "stake_refund",
        `Stake refund (room ${roomId})`,
        undefined,
        {
          pool: "earned",
          idempotencyKey: `stake-refund-${roomId}-${userId}`,
        },
      );
    }

    return { refund, burned: stake.burned, wonRounds: stake.wonRounds };
  });
}

/**
 * Cron sweep: refund stakes whose game never finished within ABANDON_HOURS.
 * Each candidate is settled in its own transaction so a single failure doesn't
 * block others. Idempotent: state guard prevents double-refund even when the
 * sweep and settleStake race (e.g. a game finishes just as the sweep runs —
 * the loser's UPDATE touches 0 rows and returns null; the credit dedupes via
 * the shared idempotency key `stake-refund-{roomId}-{userId}`).
 */
export async function sweepAbandonedStakes(
  db: AnyTx,
): Promise<{ refunded: number }> {
  // ABANDON_HOURS is a compile-time constant; use make_interval for a fully
  // parameterized interval expression (no string interpolation into SQL).
  const cutoff = sql`now() - make_interval(hours => ${ABANDON_HOURS})`;

  const candidates = await db
    .select({
      roomId: gnStakes.roomId,
      userId: gnStakes.userId,
    })
    .from(gnStakes)
    .innerJoin(gameRooms, eq(gameRooms.id, gnStakes.roomId))
    .where(
      and(
        eq(gnStakes.state, "active"),
        lt(gnStakes.createdAt, cutoff),
        sql`${gameRooms.status} != 'finished'`,
      ),
    );

  let refunded = 0;
  for (const c of candidates) {
    const settled = await db.transaction(async (tx: AnyTx) => {
      const updated = await tx
        .update(gnStakes)
        .set({ state: "refunded", settledAt: new Date() })
        .where(
          and(
            eq(gnStakes.roomId, c.roomId),
            eq(gnStakes.userId, c.userId),
            eq(gnStakes.state, "active"),
          ),
        )
        .returning();

      const stake = updated[0];
      if (!stake) return false;

      const refund = Math.max(0, stake.staked - stake.burned);
      if (refund > 0) {
        await creditGoldenNotes(
          tx,
          c.userId,
          refund,
          "stake_refund",
          `Abandoned game refund (room ${c.roomId})`,
          undefined,
          {
            pool: "earned",
            // Shared key with settleStake — deliberate. Whichever runs first
            // wins; the other dedupes cleanly via the idempotency check.
            idempotencyKey: `stake-refund-${c.roomId}-${c.userId}`,
          },
        );
      }
      return true;
    });

    if (settled) refunded++;
  }

  return { refunded };
}
