import { z } from "zod";
import { and, eq, desc, gte, sql } from "drizzle-orm";
import { TRPCError } from "@trpc/server";
import { router, protectedProcedure } from "../_core/trpc";
import { rateLimit } from "../_core/rateLimit";
import { getDb } from "../db";
import {
  goldenNoteBalances,
  goldenNoteTransactions,
} from "../../drizzle/schema";

// Server-owned pack pricing table. Client never supplies the USD amount —
// it only names a packId, and the server looks up the real price.
// Prices in CENTS for Stripe. Amount = USD in cents.
export const GN_PACKS = {
  starter: { notes: 10,   amountCents:  199, label: "Starter — 10 Golden Notes" },
  regular: { notes: 50,   amountCents:  799, label: "Regular — 50 Golden Notes" },
  pro:     { notes: 150,  amountCents: 1999, label: "Pro — 150 Golden Notes" },
  mega:    { notes: 500,  amountCents: 4999, label: "Mega — 500 Golden Notes" },
  ultra:   { notes: 1200, amountCents: 9999, label: "Ultra — 1,200 Golden Notes" },
} as const;

export type GoldenNotePackId = keyof typeof GN_PACKS;

// Server-owned spend pricing. Client names a spend kind; server validates
// the amount matches this table.
export const GN_SPEND_COSTS = {
  spend_extra_game: 1,
  spend_tournament_entry_small: 5,
  spend_tournament_entry_medium: 25,
  spend_tournament_entry_large: 100,
  spend_advanced_mode_session: 5,
  spend_advanced_mode_daypass: 20,
} as const;

type SpendKind = keyof typeof GN_SPEND_COSTS;

// Zero-out-safely-create: returns an existing balance row or creates one.
async function getOrCreateBalance(userId: number) {
  const db = await getDb();
  if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "Database unavailable" });
  const rows = await db
    .select()
    .from(goldenNoteBalances)
    .where(eq(goldenNoteBalances.userId, userId))
    .limit(1);
  if (rows.length > 0) return rows[0];
  await db.insert(goldenNoteBalances).values({ userId }).onConflictDoNothing();
  const fresh = await db
    .select()
    .from(goldenNoteBalances)
    .where(eq(goldenNoteBalances.userId, userId))
    .limit(1);
  return fresh[0];
}

export const goldenNotesRouter = router({
  // Current balance + lifetime totals for the signed-in user.
  getMyBalance: protectedProcedure.query(async ({ ctx }) => {
    const bal = await getOrCreateBalance(ctx.user.id);
    return {
      balance: bal.balance,
      lifetimePurchased: bal.lifetimePurchased,
      lifetimeSpent: bal.lifetimeSpent,
      lifetimeGiftedSent: bal.lifetimeGiftedSent,
      lifetimeGiftedReceived: bal.lifetimeGiftedReceived,
      lastPurchaseAt: bal.lastPurchaseAt,
    };
  }),

  // Recent transactions for the signed-in user (for a history panel).
  getTransactions: protectedProcedure
    .input(z.object({ limit: z.number().min(1).max(100).default(25) }))
    .query(async ({ ctx, input }) => {
      const db = await getDb();
      if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "Database unavailable" });
      const rows = await db
        .select()
        .from(goldenNoteTransactions)
        .where(eq(goldenNoteTransactions.userId, ctx.user.id))
        .orderBy(desc(goldenNoteTransactions.createdAt))
        .limit(input.limit);
      return rows;
    }),

  // List the packs — client renders these as options on /shop.
  getPacks: protectedProcedure.query(() => {
    return Object.entries(GN_PACKS).map(([id, p]) => ({
      id: id as GoldenNotePackId,
      notes: p.notes,
      amountCents: p.amountCents,
      priceUsd: (p.amountCents / 100).toFixed(2),
      label: p.label,
    }));
  }),

  // Start a Stripe Checkout session for a pack purchase. The actual minting
  // of Golden Notes happens in the Stripe webhook — this only creates the
  // checkout session and returns its URL.
  createPurchaseCheckout: protectedProcedure
    .input(z.object({
      packId: z.enum(
        Object.keys(GN_PACKS) as [GoldenNotePackId, ...GoldenNotePackId[]]
      ),
    }))
    .mutation(async ({ ctx, input }) => {
      rateLimit("gn.createCheckout", ctx.user.id, { max: 10, windowMs: 10 * 60_000 });
      const pack = GN_PACKS[input.packId];

      const { default: Stripe } = await import("stripe");
      const key = process.env.STRIPE_SECRET_KEY;
      if (!key || key === "sk_test_placeholder") {
        throw new TRPCError({
          code: "PRECONDITION_FAILED",
          message: "Stripe not configured yet. Purchases will be available once real keys are set.",
        });
      }
      const stripe = new Stripe(key);

      // Stripe redirects the user to success_url / cancel_url after payment.
      // Those URLs MUST NOT be attacker-controllable — a spoofed Origin
      // header would otherwise send paid-up users to a phishing clone. We
      // only honor request Origin values that appear in ALLOWED_ORIGINS;
      // anything else falls back to the canonical production host.
      const allowlist = (process.env.ALLOWED_ORIGINS ?? "")
        .split(",")
        .map(s => s.trim())
        .filter(Boolean);
      const claimedOrigin = ctx.req.headers.origin;
      const origin =
        claimedOrigin && allowlist.includes(String(claimedOrigin))
          ? String(claimedOrigin)
          : "https://lyricpro-ai.vercel.app";

      const session = await stripe.checkout.sessions.create({
        payment_method_types: ["card"],
        mode: "payment",
        customer_email: ctx.user.email ?? undefined,
        line_items: [{
          price_data: {
            currency: "usd",
            product_data: {
              name: pack.label,
              description: `${pack.notes} Golden Notes for your LyricPro Ai account`,
            },
            unit_amount: pack.amountCents,
          },
          quantity: 1,
        }],
        success_url: `${origin}/shop?status=success&pack=${input.packId}`,
        cancel_url: `${origin}/shop?status=cancelled`,
        metadata: {
          type: "golden_notes",
          userId: String(ctx.user.id),
          packId: input.packId,
          notes: String(pack.notes),
        },
        client_reference_id: String(ctx.user.id),
      });

      return { checkoutUrl: session.url };
    }),

  // Debit the user's balance for a defined spend kind. Server validates the
  // kind against the price table — client never supplies the cost.
  spend: protectedProcedure
    .input(z.object({
      kind: z.enum(
        Object.keys(GN_SPEND_COSTS) as [SpendKind, ...SpendKind[]]
      ),
      reason: z.string().max(256).optional(),
    }))
    .mutation(async ({ ctx, input }) => {
      rateLimit("gn.spend", ctx.user.id, { max: 60, windowMs: 60_000 });
      const cost = GN_SPEND_COSTS[input.kind];
      const db = await getDb();
      if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "Database unavailable" });

      // Map the shared spend kind to the enum kind stored in the log.
      // All spend kinds map to a spend_* enum value; tournament variants
      // collapse to spend_tournament, advanced-mode variants to
      // spend_advanced_mode.
      const enumKind =
        input.kind === "spend_extra_game"            ? "spend_extra_game" :
        input.kind.startsWith("spend_tournament")    ? "spend_tournament" :
        input.kind.startsWith("spend_advanced_mode") ? "spend_advanced_mode" :
        "spend_extra_game";

      // Ensure the balance row exists — insert with balance=0 if new.
      await getOrCreateBalance(ctx.user.id);

      // Race-safe decrement: the UPDATE only runs where balance >= cost.
      // Two concurrent spends can't both succeed past a point where funds
      // run out — Postgres serializes the UPDATEs and whichever finds
      // insufficient balance returns 0 rows. This avoids the TOCTOU
      // (time-of-check / time-of-use) race where a read-then-write in
      // separate statements could double-spend.
      const result = await db.transaction(async (tx) => {
        const updated = await tx
          .update(goldenNoteBalances)
          .set({
            balance: sql`${goldenNoteBalances.balance} - ${cost}`,
            lifetimeSpent: sql`${goldenNoteBalances.lifetimeSpent} + ${cost}`,
            updatedAt: new Date(),
          })
          .where(
            and(
              eq(goldenNoteBalances.userId, ctx.user.id),
              gte(goldenNoteBalances.balance, cost)
            )
          )
          .returning({ newBalance: goldenNoteBalances.balance });

        if (updated.length === 0) {
          const [cur] = await tx
            .select({ balance: goldenNoteBalances.balance })
            .from(goldenNoteBalances)
            .where(eq(goldenNoteBalances.userId, ctx.user.id));
          throw new TRPCError({
            code: "BAD_REQUEST",
            message: `Not enough Golden Notes. You need ${cost}, have ${cur?.balance ?? 0}.`,
          });
        }

        const newBalance = updated[0].newBalance;
        await tx.insert(goldenNoteTransactions).values({
          userId: ctx.user.id,
          amount: -cost,
          kind: enumKind as "spend_extra_game" | "spend_tournament" | "spend_advanced_mode",
          reason: input.reason ?? null,
          balanceAfter: newBalance,
        });
        return newBalance;
      });

      return { newBalance: result };
    }),
});
