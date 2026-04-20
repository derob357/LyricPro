import { router, protectedProcedure } from "../_core/trpc";
import { z } from "zod";
import { TRPCError } from "@trpc/server";
import { distributePrizes, getPlayerEarnings } from "./prizeDistribution";
import {
  checkGameEligibility,
  validateGameSetup,
  enforceSubscriptionTierFeatures,
} from "./subscriptionEnforcement";

export const monetizationIntegrationRouter = router({
  // ─── Game Completion & Prize Distribution ──────────────────────────────────

  // completeGameWithPrizes — admin-only trigger for prize distribution.
  // The preceding (public) version let any authenticated user call
  // distributePrizes() on any gameId, trivially redirecting payouts. Real
  // end-of-game distribution should be server-internal (run automatically
  // when the final round completes); this procedure stays as an admin
  // override for manual reconciliation.
  completeGameWithPrizes: protectedProcedure
    .input(
      z.object({
        gameId: z.number(),
        finalScore: z.number(),
      })
    )
    .mutation(async ({ ctx, input }) => {
      if (ctx.user.role !== "admin") {
        throw new TRPCError({
          code: "FORBIDDEN",
          message: "Only admins can trigger prize distribution manually",
        });
      }
      try {
        await distributePrizes(input.gameId);
        const earnings = await getPlayerEarnings(ctx.user.id);
        return {
          success: true,
          earnings,
          message: "Game completed and prizes distributed",
        };
      } catch (error) {
        console.error(
          "[Prize Distribution] Error:",
          error instanceof Error ? error.message : "unknown"
        );
        throw new TRPCError({
          code: "INTERNAL_SERVER_ERROR",
          message: "Failed to distribute prizes",
        });
      }
    }),

  // ─── Check Game Eligibility ────────────────────────────────────────────────

  checkGameEligibility: protectedProcedure
    .input(
      z.object({
        rounds: z.number(),
        entryFee: z.number(),
        gameMode: z.enum(["solo", "team3", "team5", "team7"]),
        difficulty: z.enum(["easy", "medium", "hard"]),
      })
    )
    .query(async ({ ctx, input }) => {
      try {
        // Check if user can play this game
        await checkGameEligibility(ctx.user.id, input.rounds, input.entryFee);

        // Validate game setup against subscription tier
        const validation = await validateGameSetup(
          ctx.user.id,
          input.rounds,
          input.difficulty,
          input.gameMode,
          input.entryFee
        );

        return {
          eligible: true,
          tier: validation.tier,
          features: validation.features,
        };
      } catch (error) {
        if (error instanceof TRPCError) {
          throw error;
        }
        throw new TRPCError({
          code: "INTERNAL_SERVER_ERROR",
          message: "Failed to check game eligibility",
        });
      }
    }),

  // ─── Get Player Earnings ──────────────────────────────────────────────────

  getPlayerEarnings: protectedProcedure.query(async ({ ctx }) => {
    try {
      const earnings = await getPlayerEarnings(ctx.user.id);
      return earnings;
    } catch (error) {
      console.error("[Get Player Earnings] Error:", error);
      throw new TRPCError({
        code: "INTERNAL_SERVER_ERROR",
        message: "Failed to get player earnings",
      });
    }
  }),

  // ─── Get Subscription Features ─────────────────────────────────────────────

  getSubscriptionFeatures: protectedProcedure
    .input(
      z.object({
        tier: z.enum(["free", "player", "pro", "elite"]).optional(),
      })
    )
    .query(async ({ ctx, input }) => {
      try {
        const tier = input.tier || "free";
        const features = await enforceSubscriptionTierFeatures(ctx.user.id, tier);
        return features;
      } catch (error) {
        throw new TRPCError({
          code: "INTERNAL_SERVER_ERROR",
          message: "Failed to get subscription features",
        });
      }
    }),
});
