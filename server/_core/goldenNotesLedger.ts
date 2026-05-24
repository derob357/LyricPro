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

type SpendKind =
  | "spend_extra_game"
  | "spend_tournament"
  | "spend_advanced_mode"
  | "spend_avatar_unlock";
type CreditKind =
  | "purchase"
  | "refund"
  | "admin_adjustment"
  | "gift_received";

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
