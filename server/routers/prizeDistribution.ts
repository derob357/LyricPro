import { getDb } from "../db";
import { entryFeeGames, entryFeeParticipants, userWallets } from "../../drizzle/schema";
import { eq, and, desc } from "drizzle-orm";

export async function distributePrizes(gameId: number) {
  const db = await getDb();
  if (!db) throw new Error("Database connection failed");

  // Get game details
  const games = await db
    .select()
    .from(entryFeeGames)
    .where(eq(entryFeeGames.id, gameId));

  const game = games[0];

  if (!game) throw new Error("Game not found");

  // Get all participants with their scores
  const participants = await db
    .select()
    .from(entryFeeParticipants)
    .where(
      and(
        eq(entryFeeParticipants.entryFeeGameId, gameId),
        eq(entryFeeParticipants.payoutStatus, "pending")
      )
    )
    .orderBy(desc(entryFeeParticipants.finalScore));

  if (participants.length === 0) {
    console.log(`[Prize Distribution] No participants found for game ${gameId}`);
    return;
  }

  // Calculate total entry fees and prize pool
  const totalEntryFees = participants.reduce(
    (sum, p) => sum + p.entryFeeAmount,
    0
  );
  const prizePoolAmount = totalEntryFees * 0.3; // 30% to prizes, 70% to LyricPro

  // Prize distribution: 1st (60%), 2nd (30%), 3rd (10%)
  const prizeDistribution = [
    { placement: 1, percentage: 0.6 },
    { placement: 2, percentage: 0.3 },
    { placement: 3, percentage: 0.1 },
  ];

  // Distribute prizes
  for (let i = 0; i < Math.min(3, participants.length); i++) {
    const participant = participants[i];
    const distribution = prizeDistribution[i];

    if (!distribution) break;

    const prizeAmount = prizePoolAmount * distribution.percentage;

    // Update participant with placement and prize
    await db
      .update(entryFeeParticipants)
      .set({
        placement: distribution.placement,
        prizeWon: prizeAmount,
        payoutStatus: "completed",
      })
      .where(eq(entryFeeParticipants.id, participant.id));

    // Add prize to user wallet
    const wallets = await db
      .select()
      .from(userWallets)
      .where(eq(userWallets.userId, participant.userId));

    const wallet = wallets[0];

    if (wallet) {
      await db
        .update(userWallets)
        .set({
          availableBalance: wallet.availableBalance + prizeAmount,
          totalWinnings: wallet.totalWinnings + prizeAmount,
        })
        .where(eq(userWallets.id, wallet.id));
    } else {
      // Create wallet if doesn't exist
      await db.insert(userWallets).values([{
        userId: participant.userId,
        availableBalance: prizeAmount,
        totalWinnings: prizeAmount,
        totalPayouts: 0,
      }]);
    }

    console.log(
      `[Prize Distribution] User ${participant.userId} won $${prizeAmount.toFixed(2)} (${distribution.placement}${
        distribution.placement === 1 ? "st" : distribution.placement === 2 ? "nd" : "rd"
      } place)`
    );
  }

  // Mark other participants as completed (no prize)
  if (participants.length > 3) {
    await db
      .update(entryFeeParticipants)
      .set({ payoutStatus: "completed" })
      .where(
        and(
          eq(entryFeeParticipants.entryFeeGameId, gameId),
          eq(entryFeeParticipants.payoutStatus, "pending")
        )
      );
  }

  console.log(
    `[Prize Distribution] Game ${gameId} completed. Prize pool: $${prizePoolAmount.toFixed(2)}`
  );
}

export async function getPlayerEarnings(userId: number) {
  const db = await getDb();
  if (!db) throw new Error("Database connection failed");

  const participants = await db
    .select()
    .from(entryFeeParticipants)
    .where(
      and(
        eq(entryFeeParticipants.userId, userId),
        eq(entryFeeParticipants.payoutStatus, "completed")
      )
    )
    .orderBy(desc(entryFeeParticipants.createdAt));

  const totalEarnings = participants.reduce((sum, p) => sum + (p.prizeWon || 0), 0);
  const totalSpent = participants.reduce(
    (sum, p) => sum + p.entryFeeAmount,
    0
  );

  return {
    totalEarnings,
    totalSpent,
    netProfit: totalEarnings - totalSpent,
    gamesPlayed: participants.length,
    wins: participants.filter((p) => p.placement === 1).length,
    topPlacements: participants.filter((p) => p.placement && p.placement <= 3)
      .length,
  };
}
