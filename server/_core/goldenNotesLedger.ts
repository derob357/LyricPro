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
 * Idempotency — lock-then-check ordering:
 *   1. Acquire FOR UPDATE lock on the balance row first.
 *   2. Under that lock, check the transactions table for the idempotencyKey.
 *      The lock serializes same-user races so by the time we read, any in-flight
 *      first request has either committed (key exists → safe to dedupe) or not
 *      yet started (key absent → safe to proceed). The early check before the
 *      lock is removed intentionally.
 *   3. If deduped at step 2 → return immediately (no balance write).
 *   4. Write balance update, then insert the audit row inside a NESTED
 *      transaction (savepoint). 23505 here is a programming error (same-user
 *      same-key slipped past the lock somehow) — throw loudly rather than
 *      silently double-debit.
 *
 * Why NOT the old pattern (check-first before lock):
 *   The old code checked for an existing key BEFORE locking the balance row.
 *   Two concurrent requests could both pass the check (key absent), both run
 *   the balance UPDATE, and then both attempt the INSERT — the loser catches
 *   23505 AFTER having already deducted the balance, creating a double debit.
 *   Moving the check to AFTER the FOR UPDATE lock closes that window.
 *
 * Drizzle on postgres-js: tx.transaction(inner) calls client.savepoint() —
 * confirmed in node_modules/drizzle-orm/postgres-js/session.cjs. After a
 * savepoint rollback, the outer transaction remains alive.
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

  // ── Step 1: Ensure the balance row exists, then lock it ───────────────────
  // Locking first serializes same-user requests so the idempotency check below
  // is authoritative (no race window between the check and the update).
  await tx.insert(goldenNoteBalances).values({ userId }).onConflictDoNothing();

  const [lockedRow] = await tx
    .select({
      balance: goldenNoteBalances.balance,
      earnedBalance: goldenNoteBalances.earnedBalance,
      purchasedBalance: goldenNoteBalances.purchasedBalance,
    })
    .from(goldenNoteBalances)
    .where(eq(goldenNoteBalances.userId, userId))
    .for("update");

  // ── Step 2: Idempotency check — safe now because we hold the row lock ─────
  // Any concurrent first request for the same user+key either committed before
  // we acquired the lock (key exists → return deduped) or hasn't started yet
  // (key absent → proceed). The lock makes this check race-safe for same-user
  // same-key replays. Different-user same-key is not a real scenario (keys
  // should embed userId).
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

  // ── Step 3: Update the balance ────────────────────────────────────────────
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

  // ── Step 4: Insert audit row inside a SAVEPOINT ───────────────────────────
  // The nested tx.transaction() call issues SAVEPOINT / RELEASE SAVEPOINT via
  // postgres-js client.savepoint(). If the INSERT fails (23505), the savepoint
  // is rolled back but the outer transaction's balance UPDATE survives.
  // After the lock-then-check above, 23505 here means a well-formed idempotency
  // key somehow reached the INSERT twice — that is a programming error (should
  // be unreachable for keys that embed userId). Throw loudly rather than
  // silently absorbing a double debit.
  try {
    await tx.transaction(async (inner: any) => {
      await inner.insert(goldenNoteTransactions).values({
        userId,
        amount: -cost,
        kind,
        reason,
        balanceAfter: newBalance,
        idempotencyKey: opts.idempotencyKey ?? null,
      });
    });
  } catch (insertErr: unknown) {
    // Normalize: postgres-js puts SQLSTATE on err.code; Drizzle may wrap it
    // as a DrizzleQueryError with .cause holding the original pg error.
    const code =
      (insertErr as any)?.code ?? (insertErr as any)?.cause?.code;
    if (code === "23505" && opts.idempotencyKey) {
      throw new Error(
        "Idempotency key conflict — concurrent duplicate with non-identical scope (should be unreachable for well-formed keys)"
      );
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
 * Idempotency — lock-then-check ordering (mirrors spendGoldenNotes):
 *   1. Acquire FOR UPDATE lock on the balance row first.
 *   2. Under that lock, check the transactions table for the idempotencyKey.
 *      The lock serializes same-user races so the check is authoritative.
 *   3. If deduped at step 2 → return immediately (no balance write).
 *   4. Write balance update, then insert the audit row inside a NESTED
 *      transaction (savepoint). 23505 here is a programming error — throw
 *      loudly rather than silently double-credit.
 *
 * See spendGoldenNotes for full rationale on why the check must come AFTER
 * the FOR UPDATE lock (moving it before re-opens a race window).
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

  // ── Step 1: Ensure the balance row exists, then lock it ───────────────────
  await tx.insert(goldenNoteBalances).values({ userId }).onConflictDoNothing();

  await tx
    .select({ balance: goldenNoteBalances.balance })
    .from(goldenNoteBalances)
    .where(eq(goldenNoteBalances.userId, userId))
    .for("update");

  // ── Step 2: Idempotency check — safe now because we hold the row lock ─────
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

  // ── Step 3: Update the balance ────────────────────────────────────────────
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

  // ── Step 4: Insert audit row inside a SAVEPOINT ───────────────────────────
  // Same rationale as spendGoldenNotes: the lock-then-check above makes 23505
  // here unreachable for well-formed keys. Throw loudly if it happens anyway.
  try {
    await tx.transaction(async (inner: any) => {
      await inner.insert(goldenNoteTransactions).values({
        userId,
        amount,
        kind,
        reason,
        relatedUserId: relatedUserId ?? null,
        balanceAfter: newBalance,
        idempotencyKey: opts.idempotencyKey ?? null,
      });
    });
  } catch (insertErr: unknown) {
    // Normalize: postgres-js puts SQLSTATE on err.code; Drizzle may wrap it
    // as a DrizzleQueryError with .cause holding the original pg error.
    const code =
      (insertErr as any)?.code ?? (insertErr as any)?.cause?.code;
    if (code === "23505" && opts.idempotencyKey) {
      throw new Error(
        "Idempotency key conflict — concurrent duplicate with non-identical scope (should be unreachable for well-formed keys)"
      );
    }
    throw insertErr;
  }

  return { newBalance, deduped: false };
}
