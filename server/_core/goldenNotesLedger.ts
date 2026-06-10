// Shared Golden Notes ledger helpers. Used by goldenNotes.spend (fixed
// price table), tournaments.payEntry (admin-set per-tournament cost),
// game.ts (streak insurance + hint), and insights.ts (practice pack).
// Call sites are responsible for validating that the `cost` is
// server-controlled (never client-supplied). The helper executes the
// race-safe decrement / credit and writes the audit row.
import { TRPCError } from "@trpc/server";
import { and, eq, gte, sql } from "drizzle-orm";
import {
  goldenNoteBalances,
  goldenNoteTransactions,
} from "../../drizzle/schema";
import { computePoolDebit, type PoolMode } from "./stakeMath";

export type SpendKind =
  | "spend_extra_game"
  | "spend_tournament"
  | "spend_advanced_mode"
  | "spend_avatar_unlock"
  | "spend_hint"
  | "spend_streak_insurance"
  | "spend_practice_pack"
  | "stake_escrow";

export type CreditKind =
  | "purchase"
  | "refund"
  | "admin_adjustment"
  | "gift_received"
  | "stake_win"
  | "stake_refund"
  | "signup_grant";

export interface SpendOptions {
  /** default "purchased-first"; stake_escrow MUST pass "earned-only" */
  pool?: PoolMode;
  /** unique across all transactions; replays return the recorded result */
  idempotencyKey?: string;
}

export interface CreditOptions {
  /** default "purchased" — preserves current behavior for purchase/refund/admin/gift */
  pool?: "earned" | "purchased";
  /** unique across all transactions; replays return the recorded result */
  idempotencyKey?: string;
}

/**
 * Race-safe decrement with pool split. Must be called inside a transaction so
 * the balance write + transaction-log write commit atomically.
 * Returns { newBalance, deduped }. Throws TRPCError BAD_REQUEST on insufficient funds.
 *
 * Idempotency: select-first + unique-violation catch (NOT onConflictDoUpdate —
 * the DB index on idempotencyKey is a PARTIAL unique index and Drizzle would
 * emit the wrong ON CONFLICT clause).
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export async function spendGoldenNotes(
  tx: any,
  userId: number,
  cost: number,
  kind: SpendKind,
  reason: string | null,
  opts: SpendOptions = {},
): Promise<{ newBalance: number; deduped: boolean }> {
  if (cost <= 0) {
    throw new TRPCError({ code: "BAD_REQUEST", message: "cost must be positive" });
  }

  // ── Idempotency: check for an existing transaction with this key ──────────
  if (opts.idempotencyKey) {
    const [existing] = await tx
      .select({ balanceAfter: goldenNoteTransactions.balanceAfter })
      .from(goldenNoteTransactions)
      .where(eq(goldenNoteTransactions.idempotencyKey, opts.idempotencyKey))
      .limit(1);
    if (existing) {
      return { newBalance: existing.balanceAfter, deduped: true };
    }
  }

  // Ensure a balance row exists (idempotent — ON CONFLICT DO NOTHING).
  await tx.insert(goldenNoteBalances).values({ userId }).onConflictDoNothing();

  // Lock the row and read pool balances for split computation.
  const [lockedRow] = await tx
    .select({
      balance: goldenNoteBalances.balance,
      earnedBalance: goldenNoteBalances.earnedBalance,
      purchasedBalance: goldenNoteBalances.purchasedBalance,
    })
    .from(goldenNoteBalances)
    .where(eq(goldenNoteBalances.userId, userId))
    .for("update");

  const currentBalance = lockedRow?.balance ?? 0;
  const currentEarned = lockedRow?.earnedBalance ?? 0;
  const currentPurchased = lockedRow?.purchasedBalance ?? 0;
  const poolMode: PoolMode = opts.pool ?? "purchased-first";

  // computePoolDebit throws Error on insufficient funds — convert to TRPCError.
  let fromPurchased: number;
  let fromEarned: number;
  try {
    ({ fromPurchased, fromEarned } = computePoolDebit(
      currentPurchased,
      currentEarned,
      cost,
      poolMode,
    ));
  } catch (e) {
    throw new TRPCError({
      code: "BAD_REQUEST",
      message: (e as Error).message,
    });
  }

  // Single atomic UPDATE: debit all three balance columns.
  const updated = await tx
    .update(goldenNoteBalances)
    .set({
      balance: sql`${goldenNoteBalances.balance} - ${cost}`,
      earnedBalance: sql`${goldenNoteBalances.earnedBalance} - ${fromEarned}`,
      purchasedBalance: sql`${goldenNoteBalances.purchasedBalance} - ${fromPurchased}`,
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

  // Belt-and-braces guard against drift between the lock read and the update.
  if (updated.length === 0) {
    throw new TRPCError({
      code: "BAD_REQUEST",
      message: `Not enough Golden Notes. You need ${cost}, have ${currentBalance}.`,
    });
  }

  const newBalance = updated[0].newBalance;

  // Insert the audit row. Catch unique-violation on idempotencyKey → treat as
  // deduped (race: two concurrent requests both passed the check-first above).
  try {
    await tx.insert(goldenNoteTransactions).values({
      userId,
      amount: -cost,
      kind,
      reason,
      balanceAfter: newBalance,
      idempotencyKey: opts.idempotencyKey ?? null,
    });
  } catch (insertErr: unknown) {
    // Postgres unique-violation code = 23505
    const msg = (insertErr as { code?: string })?.code;
    if (msg === "23505" && opts.idempotencyKey) {
      // Another concurrent request won the race — re-select and return.
      const [dup] = await tx
        .select({ balanceAfter: goldenNoteTransactions.balanceAfter })
        .from(goldenNoteTransactions)
        .where(eq(goldenNoteTransactions.idempotencyKey, opts.idempotencyKey))
        .limit(1);
      return { newBalance: dup?.balanceAfter ?? newBalance, deduped: true };
    }
    throw insertErr;
  }

  return { newBalance, deduped: false };
}

/**
 * Credit (positive amount). Used for refunds, admin adjustments, stake wins,
 * and signup grants. Updates balance + the chosen pool atomically.
 * Returns { newBalance, deduped }. Auto-creates the balance row if missing.
 *
 * Idempotency: select-first + unique-violation catch (same pattern as spend).
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export async function creditGoldenNotes(
  tx: any,
  userId: number,
  amount: number,
  kind: CreditKind,
  reason: string | null,
  relatedUserId?: number,
  opts: CreditOptions = {},
): Promise<{ newBalance: number; deduped: boolean }> {
  if (amount <= 0) {
    throw new TRPCError({ code: "BAD_REQUEST", message: "credit amount must be positive" });
  }

  // ── Idempotency: check for an existing transaction with this key ──────────
  if (opts.idempotencyKey) {
    const [existing] = await tx
      .select({ balanceAfter: goldenNoteTransactions.balanceAfter })
      .from(goldenNoteTransactions)
      .where(eq(goldenNoteTransactions.idempotencyKey, opts.idempotencyKey))
      .limit(1);
    if (existing) {
      return { newBalance: existing.balanceAfter, deduped: true };
    }
  }

  await tx.insert(goldenNoteBalances).values({ userId }).onConflictDoNothing();

  const pool = opts.pool ?? "purchased";
  const poolColumn =
    pool === "earned"
      ? sql`${goldenNoteBalances.earnedBalance} + ${amount}`
      : sql`${goldenNoteBalances.purchasedBalance} + ${amount}`;

  const updated = await tx
    .update(goldenNoteBalances)
    .set({
      balance: sql`${goldenNoteBalances.balance} + ${amount}`,
      ...(pool === "earned"
        ? { earnedBalance: poolColumn }
        : { purchasedBalance: poolColumn }),
      updatedAt: new Date(),
    })
    .where(eq(goldenNoteBalances.userId, userId))
    .returning({ newBalance: goldenNoteBalances.balance });

  const newBalance = updated[0].newBalance;

  // Insert audit row. Catch unique-violation on idempotencyKey → dedupe.
  try {
    await tx.insert(goldenNoteTransactions).values({
      userId,
      amount,
      kind,
      reason,
      relatedUserId: relatedUserId ?? null,
      balanceAfter: newBalance,
      idempotencyKey: opts.idempotencyKey ?? null,
    });
  } catch (insertErr: unknown) {
    const msg = (insertErr as { code?: string })?.code;
    if (msg === "23505" && opts.idempotencyKey) {
      const [dup] = await tx
        .select({ balanceAfter: goldenNoteTransactions.balanceAfter })
        .from(goldenNoteTransactions)
        .where(eq(goldenNoteTransactions.idempotencyKey, opts.idempotencyKey))
        .limit(1);
      return { newBalance: dup?.balanceAfter ?? newBalance, deduped: true };
    }
    throw insertErr;
  }

  return { newBalance, deduped: false };
}
