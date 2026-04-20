import { getDb } from "../db";
import { subscriptions, gameSessions } from "../../drizzle/schema";
import { eq, and, gte } from "drizzle-orm";
import { TRPCError } from "@trpc/server";

const FREE_GAMES_LIMIT = 2;
const FREE_GAME_ROUNDS = 5;

export async function checkGameEligibility(
  userId: number,
  requestedRounds: number,
  entryFee: number
) {
  const db = await getDb();
  if (!db) throw new Error("Database connection failed");

  // Get user's subscription
  const subs = await db
    .select()
    .from(subscriptions)
    .where(eq(subscriptions.userId, userId));

  const subscription = subs[0];

  // If entry fee > 0, user must have active subscription
  if (entryFee > 0) {
    if (!subscription || subscription.tier === "free") {
      throw new TRPCError({
        code: "FORBIDDEN",
        message: "You must have an active subscription to play for prizes. Upgrade to Player, Pro, or Elite tier.",
      });
    }
    // Subscription covers entry fees, so allow
    return { allowed: true, reason: "subscription_active" };
  }

  // Free play (entry fee = 0)
  if (!subscription || subscription.tier === "free") {
    // Check free game limit
    const today = new Date();
    today.setHours(0, 0, 0, 0);

    const todayGames = await db
      .select()
      .from(gameSessions)
      .where(
        and(
          eq(gameSessions.userId, userId),
          gte(gameSessions.startedAt, today)
        )
      );

    const freeGamesPlayedToday = todayGames.length;

    if (freeGamesPlayedToday >= FREE_GAMES_LIMIT) {
      throw new TRPCError({
        code: "FORBIDDEN",
        message: `You've reached your free game limit (${FREE_GAMES_LIMIT} per day). Upgrade to Player tier ($6.99/mo) for unlimited play.`,
      });
    }

    // Also check if requesting more than 5 rounds for free
    if (requestedRounds > FREE_GAME_ROUNDS) {
      throw new TRPCError({
        code: "BAD_REQUEST",
        message: `Free games are limited to ${FREE_GAME_ROUNDS} rounds. Upgrade to Player tier for more.`,
      });
    }

    return { allowed: true, reason: "free_game_allowed", gamesUsed: freeGamesPlayedToday };
  }

  // User has subscription
  return { allowed: true, reason: "subscription_active" };
}

export async function enforceSubscriptionTierFeatures(
  userId: number,
  tier: "free" | "player" | "pro" | "elite"
) {
  const features: Record<string, any> = {
    free: {
      maxRounds: 5,
      maxDifficulty: "medium",
      canPlayTeam: false,
      canPlayEntryFee: false,
      dailyGameLimit: 2,
    },
    player: {
      maxRounds: 20,
      maxDifficulty: "hard",
      canPlayTeam: true,
      canPlayEntryFee: true,
      dailyGameLimit: 999, // Unlimited
    },
    pro: {
      maxRounds: 20,
      maxDifficulty: "hard",
      canPlayTeam: true,
      canPlayEntryFee: true,
      dailyGameLimit: 999,
      priorityMatchmaking: true,
    },
    elite: {
      maxRounds: 20,
      maxDifficulty: "hard",
      canPlayTeam: true,
      canPlayEntryFee: true,
      dailyGameLimit: 999,
      priorityMatchmaking: true,
      vipTournaments: true,
    },
  };

  return features[tier] || features.free;
}

export async function validateGameSetup(
  userId: number,
  rounds: number,
  difficulty: "easy" | "medium" | "hard",
  gameMode: "solo" | "team3" | "team5" | "team7",
  entryFee: number
) {
  const db = await getDb();
  if (!db) throw new Error("Database connection failed");

  // Get subscription
  const subs = await db
    .select()
    .from(subscriptions)
    .where(eq(subscriptions.userId, userId));

  const subscription = subs[0];
  const tier = subscription?.tier || "free";

  // Get tier features
  const features = await enforceSubscriptionTierFeatures(userId, tier);

  // Validate rounds
  if (rounds > features.maxRounds) {
    throw new TRPCError({
      code: "BAD_REQUEST",
      message: `${tier === "free" ? "Free tier" : `${tier} tier`} limited to ${features.maxRounds} rounds`,
    });
  }

  // Validate difficulty
  const difficultyRank = { easy: 1, medium: 2, hard: 3 };
  const maxDifficultyRank = difficultyRank[features.maxDifficulty as keyof typeof difficultyRank];

  if (difficultyRank[difficulty] > maxDifficultyRank) {
    throw new TRPCError({
      code: "BAD_REQUEST",
      message: `${tier === "free" ? "Free tier" : `${tier} tier`} limited to ${features.maxDifficulty} difficulty`,
    });
  }

  // Validate team play
  if (gameMode !== "solo" && !features.canPlayTeam) {
    throw new TRPCError({
      code: "BAD_REQUEST",
      message: "Team play requires Player tier or higher",
    });
  }

  // Validate entry fee
  if (entryFee > 0 && !features.canPlayEntryFee) {
    throw new TRPCError({
      code: "BAD_REQUEST",
      message: "Entry fee games require Player tier or higher",
    });
  }

  return { valid: true, tier, features };
}
