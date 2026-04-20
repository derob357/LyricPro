import { router, protectedProcedure, publicProcedure } from "../_core/trpc";
import { z } from "zod";
import {
  createSubscriptionCheckout,
  createEntryFeeCheckout,
  createAddOnGamesCheckout,
} from "../stripe-integration";
import {
  getOrCreateSubscription,
  updateSubscription,
  canPlayGame,
  getTodayGameCount,
  incrementDailyGameCount,
  createEntryFeeGame,
  addEntryFeeParticipant,
  completeEntryFeeGame,
  getOrCreateUserWallet,
  addToUserWallet,
  deductFromUserWallet,
  recordPayout,
  createAddOnPurchase,
  completeAddOnPurchase,
  getUserMonetizationStats,
  getAdminMetrics,
} from "../db-monetization";
import { TRPCError } from "@trpc/server";
import { getDb } from "../db";
import { gameRooms } from "../../drizzle/schema";
import { eq } from "drizzle-orm";

// ── Simple per-user token-bucket rate limiter for checkout-create ────────────
// Prevents a malicious client from spamming Stripe (which costs money in API
// volume and pollutes the dashboard). 10 checkout creates per 10 minutes per
// user; resets lazily. Process-local; good enough behind a single app node.
const CHECKOUT_BUCKETS = new Map<number, { count: number; windowStart: number }>();
const CHECKOUT_MAX = 10;
const CHECKOUT_WINDOW_MS = 10 * 60 * 1000;
function checkRateLimit(userId: number) {
  // Rate limits only enforce in production — see server/_core/rateLimit.ts
  // for the same convention applied project-wide.
  if (process.env.NODE_ENV !== "production") return;

  const now = Date.now();
  const bucket = CHECKOUT_BUCKETS.get(userId);
  if (!bucket || now - bucket.windowStart > CHECKOUT_WINDOW_MS) {
    CHECKOUT_BUCKETS.set(userId, { count: 1, windowStart: now });
    return;
  }
  bucket.count++;
  if (bucket.count > CHECKOUT_MAX) {
    throw new TRPCError({
      code: "TOO_MANY_REQUESTS",
      message: "Too many checkout attempts. Please wait a few minutes and try again.",
    });
  }
}

export const monetizationRouter = router({
  // ─── Subscription Procedures ──────────────────────────────────────────────
  
  getSubscription: protectedProcedure.query(async ({ ctx }) => {
    return await getOrCreateSubscription(ctx.user.id);
  }),

  // NOTE: Subscription tier changes are driven by Stripe webhooks only
  // (see stripeWebhook.ts handling `checkout.session.completed`). A direct
  // client-callable upgrade procedure was removed because it allowed any
  // authenticated user to grant themselves any tier.

  // ─── Game Play Procedures ────────────────────────────────────────────────

  canPlayGame: protectedProcedure.query(async ({ ctx }) => {
    return await canPlayGame(ctx.user.id);
  }),

  recordGamePlayed: protectedProcedure.mutation(async ({ ctx }) => {
    const canPlay = await canPlayGame(ctx.user.id);
    if (!canPlay.allowed) {
      throw new TRPCError({
        code: "FORBIDDEN",
        message: canPlay.reason || "Cannot play game",
      });
    }

    await incrementDailyGameCount(ctx.user.id);
    return { success: true };
  }),

  getTodayGameCount: protectedProcedure.query(async ({ ctx }) => {
    return await getTodayGameCount(ctx.user.id);
  }),

  // ─── Entry Fee Game Procedures ────────────────────────────────────────────

  createEntryFeeGame: protectedProcedure
    .input(
      z.object({
        roomId: z.number(),
        entryFeeAmount: z.number().min(2.5).max(1000),
        gameType: z.enum(["solo", "team3", "team5", "team7"]),
        participantCount: z.number().min(1),
      })
    )
    .mutation(async ({ ctx, input }) => {
      // IDOR check — confirm the caller actually hosts the room they're
      // converting into an entry-fee game. Without this, any user could
      // attach a paid prize structure to someone else's room.
      const db = await getDb();
      if (!db) throw new Error("Database not available");
      const [room] = await db
        .select({ id: gameRooms.id, hostUserId: gameRooms.hostUserId })
        .from(gameRooms)
        .where(eq(gameRooms.id, input.roomId))
        .limit(1);
      if (!room) {
        throw new TRPCError({ code: "NOT_FOUND", message: "Room not found" });
      }
      if (room.hostUserId !== ctx.user.id) {
        throw new TRPCError({
          code: "FORBIDDEN",
          message: "Only the host can convert this room to an entry-fee game",
        });
      }

      // Verify user has access to this entry fee tier
      const subscription = await getOrCreateSubscription(ctx.user.id);

      if (subscription.tier === "free") {
        throw new TRPCError({
          code: "FORBIDDEN",
          message: "Free tier cannot play entry fee games",
        });
      }

      if (subscription.tier === "player" && input.entryFeeAmount > 25) {
        throw new TRPCError({
          code: "FORBIDDEN",
          message: "Player tier limited to $25 entry fees",
        });
      }

      if (subscription.tier === "pro" && input.entryFeeAmount > 100) {
        throw new TRPCError({
          code: "FORBIDDEN",
          message: "Pro tier limited to $100 entry fees",
        });
      }

      // Create the entry fee game
      const result = await createEntryFeeGame(
        input.roomId,
        input.entryFeeAmount,
        input.gameType,
        input.participantCount
      );

      return {
        entryFeeGameId: result[0],
        prizePool: input.entryFeeAmount * input.participantCount * 0.3,
      };
    }),

  // joinEntryFeeGame: REMOVED. The previous implementation called
  // addEntryFeeParticipant() without actually charging the user through
  // Stripe — any paid-tier account could join any prize game for free.
  // Participation is now only recorded by the Stripe webhook handler
  // (checkout.session.completed → type: "entry_fee"), which fires after
  // payment has actually cleared.

  completeEntryFeeGame: protectedProcedure
    .input(
      z.object({
        entryFeeGameId: z.number(),
        rankings: z.array(
          z.object({
            userId: z.number(),
            score: z.number(),
            placement: z.number(),
          })
        ),
      })
    )
    .mutation(async ({ ctx, input }) => {
      // Verify user is admin or game creator
      if (ctx.user.role !== "admin") {
        throw new TRPCError({
          code: "FORBIDDEN",
          message: "Only admins can complete entry fee games",
        });
      }

      await completeEntryFeeGame(input.entryFeeGameId, input.rankings);

      return { success: true, message: "Entry fee game completed" };
    }),

  // ─── Wallet Procedures ───────────────────────────────────────────────────

  getWallet: protectedProcedure.query(async ({ ctx }) => {
    return await getOrCreateUserWallet(ctx.user.id);
  }),

  requestPayout: protectedProcedure
    .input(
      z.object({
        amount: z.number().min(10).max(10000),
      })
    )
    .mutation(async ({ ctx, input }) => {
      const wallet = await getOrCreateUserWallet(ctx.user.id);

      if (wallet.availableBalance < input.amount) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: "Insufficient balance",
        });
      }

      // In production, initiate Stripe Connect payout
      await recordPayout(ctx.user.id, input.amount);

      return {
        success: true,
        message: `Payout of $${input.amount} initiated`,
      };
    }),

  // ─── Add-On Game Purchases ───────────────────────────────────────────────

  // purchaseAddOnGames / completeAddOnPurchase: REMOVED. The previous pair
  // allowed the client to both create a pending purchase row and then
  // self-report it "completed" with an arbitrary Stripe payment-intent id —
  // no actual charge was verified. Add-on purchases now flow exclusively
  // through createAddOnGamesCheckout below → Stripe Checkout → webhook.

  // ─── User Stats Procedures ───────────────────────────────────────────────

  getMonetizationStats: protectedProcedure.query(async ({ ctx }) => {
    return await getUserMonetizationStats(ctx.user.id);
  }),

  // ─── Admin Procedures ────────────────────────────────────────────────────

  getAdminMetrics: protectedProcedure.query(async ({ ctx }) => {
    if (ctx.user.role !== "admin") {
      throw new TRPCError({
        code: "FORBIDDEN",
        message: "Only admins can view metrics",
      });
    }

    return await getAdminMetrics();
  }),

  // ─── Stripe Checkout ──────────────────────────────────────────────────────

  createSubscriptionCheckout: protectedProcedure
    .input(
      z.object({
        tier: z.enum(["player", "pro", "elite"]),
      })
    )
    .mutation(async ({ ctx, input }) => {
      checkRateLimit(ctx.user.id);
      const session = await createSubscriptionCheckout(
        ctx.user.id,
        ctx.user.email || ctx.user.name || "user@example.com",
        input.tier,
        ctx.req.headers.origin || "http://localhost:3000"
      );

      return {
        checkoutUrl: session.url,
        sessionId: session.id,
      };
    }),

  createEntryFeeCheckout: protectedProcedure
    .input(
      z.object({
        entryFeeGameId: z.number(),
        entryFeeAmount: z.number().min(2.5).max(1000),
        gameType: z.enum(["solo", "team3", "team5", "team7"]),
      })
    )
    .mutation(async ({ ctx, input }) => {
      checkRateLimit(ctx.user.id);
      const session = await createEntryFeeCheckout(
        ctx.user.id,
        ctx.user.email || ctx.user.name || "user@example.com",
        input.entryFeeGameId,
        input.entryFeeAmount,
        input.gameType,
        ctx.req.headers.origin || "http://localhost:3000"
      );

      return {
        checkoutUrl: session.url,
        sessionId: session.id,
      };
    }),

  createAddOnGamesCheckout: protectedProcedure
    .input(
      z.object({
        quantity: z.number().min(1).max(100),
      })
    )
    .mutation(async ({ ctx, input }) => {
      checkRateLimit(ctx.user.id);
      const session = await createAddOnGamesCheckout(
        ctx.user.id,
        ctx.user.email || ctx.user.name || "user@example.com",
        input.quantity,
        ctx.req.headers.origin || "http://localhost:3000"
      );

      return {
        checkoutUrl: session.url,
        sessionId: session.id,
      };
    }),
});
