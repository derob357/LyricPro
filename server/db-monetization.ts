import { getDb } from "./db";
import { 
  subscriptions, 
  dailyGameTracking, 
  entryFeeGames, 
  entryFeeParticipants,
  addOnGamePurchases,
  userWallets,
} from "../drizzle/schema";
import { eq, and } from "drizzle-orm";

const getDatabase = async () => {
  const db = await getDb();
  if (!db) throw new Error("Database connection failed");
  return db;
};

// ─── Subscription Management ──────────────────────────────────────────────────

export async function getOrCreateSubscription(userId: number) {
  const db = await getDatabase();
  const existing = await db
    .select()
    .from(subscriptions)
    .where(eq(subscriptions.userId, userId))
    .limit(1);

  if (existing.length > 0) {
    return existing[0];
  }

  // Create free tier subscription
  const newSub = await db.insert(subscriptions).values({
    userId,
    tier: "free",
    status: "active",
  });

  return {
    id: newSub[0],
    userId,
    tier: "free",
    status: "active",
    stripeSubscriptionId: null,
    currentPeriodStart: null,
    currentPeriodEnd: null,
    canceledAt: null,
    createdAt: new Date(),
    updatedAt: new Date(),
  };
}

export async function updateSubscription(
  userId: number,
  tier: "free" | "player" | "pro" | "elite",
  stripeSubscriptionId?: string,
  currentPeriodEnd?: Date
) {
  const db = await getDatabase();
  return await db
    .update(subscriptions)
    .set({
      tier,
      stripeSubscriptionId,
      currentPeriodEnd,
      status: "active",
      updatedAt: new Date(),
    })
    .where(eq(subscriptions.userId, userId));
}

// ─── Daily Game Tracking ──────────────────────────────────────────────────────

export async function getTodayGameCount(userId: number): Promise<number> {
  const db = await getDatabase();
  const today = new Date().toISOString().split("T")[0]; // YYYY-MM-DD
  const result = await db
    .select()
    .from(dailyGameTracking)
    .where(and(eq(dailyGameTracking.userId, userId), eq(dailyGameTracking.date, today)))
    .limit(1);

  return result.length > 0 ? result[0].gamesPlayedToday : 0;
}

export async function incrementDailyGameCount(userId: number): Promise<void> {
  const db = await getDatabase();
  const today = new Date().toISOString().split("T")[0];
  const existing = await db
    .select()
    .from(dailyGameTracking)
    .where(and(eq(dailyGameTracking.userId, userId), eq(dailyGameTracking.date, today)))
    .limit(1);

  if (existing.length > 0) {
    await db
      .update(dailyGameTracking)
      .set({ gamesPlayedToday: existing[0].gamesPlayedToday + 1 })
      .where(eq(dailyGameTracking.id, existing[0].id));
  } else {
    await db.insert(dailyGameTracking).values({
      userId,
      date: today,
      gamesPlayedToday: 1,
    });
  }
}

// ─── Game Play Eligibility ────────────────────────────────────────────────────

export async function canPlayGame(userId: number): Promise<{ allowed: boolean; reason?: string }> {
  const db = await getDatabase();
  const subscription = await getOrCreateSubscription(userId);
  const todayCount = await getTodayGameCount(userId);

  if (subscription.tier === "free") {
    // Free tier: 2 trial games total (not daily)
    const totalGames = await db
      .select()
      .from(dailyGameTracking)
      .where(eq(dailyGameTracking.userId, userId));

    const totalCount = totalGames.reduce((sum: number, day: any) => sum + day.gamesPlayedToday, 0);
    if (totalCount >= 2) {
      return { allowed: false, reason: "Free trial limit reached. Subscribe to play more." };
    }
  } else if (subscription.tier === "player") {
    // Player tier: 1 game every 2 days (15 games/month)
    if (todayCount >= 1) {
      return { allowed: false, reason: "Daily game limit reached. Come back tomorrow." };
    }
    // Check if played yesterday
    const yesterday = new Date();
    yesterday.setDate(yesterday.getDate() - 1);
    const yesterdayStr = yesterday.toISOString().split("T")[0];
    
    const yesterdayGames = await db
      .select()
      .from(dailyGameTracking)
      .where(and(eq(dailyGameTracking.userId, userId), eq(dailyGameTracking.date, yesterdayStr)))
      .limit(1);

    if (yesterdayGames.length > 0 && yesterdayGames[0].gamesPlayedToday > 0) {
      return { allowed: false, reason: "You can play again tomorrow. Or purchase additional games." };
    }
  } else if (subscription.tier === "pro" || subscription.tier === "elite") {
    // Pro/Elite: 1 game per day
    if (todayCount >= 1) {
      return { allowed: false, reason: "Daily game limit reached. Come back tomorrow." };
    }
  }

  return { allowed: true };
}

// ─── Entry Fee Games ──────────────────────────────────────────────────────────

export async function createEntryFeeGame(
  roomId: number,
  entryFeeAmount: number,
  gameType: "solo" | "team3" | "team5" | "team7",
  participantCount: number
) {
  const db = await getDatabase();
  const totalCollected = entryFeeAmount * participantCount;
  const prizePool = totalCollected * 0.3; // 30% to prizes

  return await db.insert(entryFeeGames).values({
    roomId,
    entryFeeAmount,
    gameType,
    prizePoolAmount: prizePool,
    totalEntriesCollected: totalCollected,
    status: "pending",
  });
}

export async function addEntryFeeParticipant(
  entryFeeGameId: number,
  userId: number,
  entryFeeAmount: number
) {
  const db = await getDatabase();
  return await db.insert(entryFeeParticipants).values({
    entryFeeGameId,
    userId,
    entryFeeAmount,
    payoutStatus: "pending",
  });
}

export async function completeEntryFeeGame(
  entryFeeGameId: number,
  rankings: Array<{ userId: number; score: number; placement: number }>
) {
  const db = await getDatabase();
  // Get game details
  const game = await db
    .select()
    .from(entryFeeGames)
    .where(eq(entryFeeGames.id, entryFeeGameId))
    .limit(1);

  if (game.length === 0) throw new Error("Game not found");

  const prizePool = game[0].prizePoolAmount;
  
  // Prize distribution: 60% / 30% / 10%
  const prizes = [
    { placement: 1, percentage: 0.6 },
    { placement: 2, percentage: 0.3 },
    { placement: 3, percentage: 0.1 },
  ];

  // Update participants with scores and prizes
  for (const ranking of rankings) {
    const prizePercentage = prizes.find((p) => p.placement === ranking.placement)?.percentage || 0;
    const prizeAmount = prizePool * prizePercentage;

    await db
      .update(entryFeeParticipants)
      .set({
        finalScore: ranking.score,
        placement: ranking.placement,
        prizeWon: prizeAmount,
        payoutStatus: "processing",
        updatedAt: new Date(),
      })
      .where(
        and(
          eq(entryFeeParticipants.entryFeeGameId, entryFeeGameId),
          eq(entryFeeParticipants.userId, ranking.userId)
        )
      );

    // Add to user wallet
    await addToUserWallet(ranking.userId, prizeAmount);
  }

  // Mark game as completed
  await db
    .update(entryFeeGames)
    .set({ status: "completed", completedAt: new Date() })
    .where(eq(entryFeeGames.id, entryFeeGameId));
}

// ─── User Wallet ──────────────────────────────────────────────────────────────

export async function getOrCreateUserWallet(userId: number) {
  const db = await getDatabase();
  const existing = await db
    .select()
    .from(userWallets)
    .where(eq(userWallets.userId, userId))
    .limit(1);

  if (existing.length > 0) {
    return existing[0];
  }

  const newWallet = await db.insert(userWallets).values({
    userId,
    availableBalance: 0,
    totalWinnings: 0,
    totalPayouts: 0,
  });

  return {
    id: newWallet[0],
    userId,
    availableBalance: 0,
    totalWinnings: 0,
    totalPayouts: 0,
    lastPayoutDate: null,
    createdAt: new Date(),
    updatedAt: new Date(),
  };
}

export async function addToUserWallet(userId: number, amount: number) {
  const db = await getDatabase();
  const wallet = await getOrCreateUserWallet(userId);
  
  return await db
    .update(userWallets)
    .set({
      availableBalance: wallet.availableBalance + amount,
      totalWinnings: wallet.totalWinnings + amount,
      updatedAt: new Date(),
    })
    .where(eq(userWallets.userId, userId));
}

export async function deductFromUserWallet(userId: number, amount: number) {
  const db = await getDatabase();
  const wallet = await getOrCreateUserWallet(userId);
  
  if (wallet.availableBalance < amount) {
    throw new Error("Insufficient balance");
  }

  return await db
    .update(userWallets)
    .set({
      availableBalance: wallet.availableBalance - amount,
      updatedAt: new Date(),
    })
    .where(eq(userWallets.userId, userId));
}

export async function recordPayout(userId: number, amount: number) {
  const db = await getDatabase();
  const wallet = await getOrCreateUserWallet(userId);
  
  if (wallet.availableBalance < amount) {
    throw new Error("Insufficient balance");
  }

  return await db
    .update(userWallets)
    .set({
      availableBalance: wallet.availableBalance - amount,
      totalPayouts: wallet.totalPayouts + amount,
      lastPayoutDate: new Date(),
      updatedAt: new Date(),
    })
    .where(eq(userWallets.userId, userId));
}

// ─── Add-On Game Purchases ────────────────────────────────────────────────────

export async function createAddOnPurchase(
  userId: number,
  quantity: number,
  pricePerGame: number = 0.99
) {
  const db = await getDatabase();
  const totalAmount = quantity * pricePerGame;

  return await db.insert(addOnGamePurchases).values({
    userId,
    quantity,
    pricePerGame,
    totalAmount,
    status: "pending",
  });
}

export async function completeAddOnPurchase(
  purchaseId: number,
  stripePaymentIntentId: string
) {
  const db = await getDatabase();
  return await db
    .update(addOnGamePurchases)
    .set({
      stripePaymentIntentId,
      status: "completed",
    })
    .where(eq(addOnGamePurchases.id, purchaseId));
}

// ─── Analytics ────────────────────────────────────────────────────────────────

export async function getUserMonetizationStats(userId: number) {
  const subscription = await getOrCreateSubscription(userId);
  const wallet = await getOrCreateUserWallet(userId);
  const todayCount = await getTodayGameCount(userId);

  return {
    subscription,
    wallet,
    todayGameCount: todayCount,
  };
}

export async function getAdminMetrics() {
  const db = await getDatabase();
  
  // Total users by subscription tier
  const tierStats = await db
    .select()
    .from(subscriptions);

  // Total revenue from entry fees (completed games)
  const entryFeeRevenue = await db
    .select()
    .from(entryFeeGames)
    .where(eq(entryFeeGames.status, "completed"));

  // Total payouts
  const totalPayouts = await db
    .select()
    .from(entryFeeParticipants)
    .where(eq(entryFeeParticipants.payoutStatus, "completed"));

  // Active subscriptions (non-free, non-canceled)
  const activeSubscriptions = await db
    .select()
    .from(subscriptions)
    .where(
      and(
        eq(subscriptions.status, "active"),
        eq(subscriptions.tier, "player")
      )
    );

  // Calculate totals
  const tierCounts = tierStats.reduce((acc: any, sub: any) => {
    acc[sub.tier] = (acc[sub.tier] || 0) + 1;
    return acc;
  }, {});

  const totalRevenue = entryFeeRevenue.reduce((sum: number, game: any) => sum + (game.totalEntriesCollected || 0), 0);
  const totalPayoutAmount = totalPayouts.reduce((sum: number, payout: any) => sum + (payout.prizeWon || 0), 0);

  return {
    tierStats: tierCounts,
    totalRevenue,
    totalPayouts: totalPayoutAmount,
    activeSubscriptions: activeSubscriptions.length,
    totalUsers: tierStats.length,
  };
}
