import { router, protectedProcedure } from "../_core/trpc";
import { z } from "zod";
import { TRPCError } from "@trpc/server";
import crypto from "crypto";

// Generate unique referral code
function generateReferralCode(): string {
  return crypto.randomBytes(8).toString("hex").toUpperCase().slice(0, 12);
}

export const referralRouter = router({
  // Get or create referral code for user
  getOrCreateReferralCode: protectedProcedure.query(async ({ ctx }) => {
    // For MVP, generate code based on user ID
    const referralCode = `REF${ctx.user.id}${generateReferralCode()}`.slice(0, 16);
    
    return {
      referralCode,
      referralUrl: `${ctx.req.headers.origin}/signup?ref=${referralCode}`,
    };
  }),

  // Get referral stats placeholder
  getReferralStats: protectedProcedure.query(async ({ ctx }) => {
    return {
      totalReferrals: 0,
      totalRewardsEarned: 0,
      totalRewardsClaimed: 0,
      referrals: [],
    };
  }),

  // Claim referral reward placeholder
  claimReferralReward: protectedProcedure
    .input(
      z.object({
        referralId: z.number(),
      })
    )
    .mutation(async ({ ctx, input }) => {
      return { success: true, rewardAmount: 0 };
    }),
});
