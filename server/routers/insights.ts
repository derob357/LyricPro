import { TRPCError } from "@trpc/server";
import { and, desc, eq } from "drizzle-orm";
import Anthropic from "@anthropic-ai/sdk";
import { router, publicProcedure } from "../_core/trpc";
import { getDb } from "../db";
import {
  roundResults,
  songs,
  userInsights,
  gameRooms,
  roomPlayers,
  goldenNoteBalances,
  goldenNoteTransactions,
} from "../../drizzle/schema";
import { nanoid } from "nanoid";

// ── Constants ─────────────────────────────────────────────────────────────────
const MIN_ROUNDS_FOR_DIAGNOSIS = 10;
const PACK_SIZE = 5;
const PACK_PRICE_GN = 4;
const CACHE_TTL_HOURS = 24;
const MODEL = "claude-haiku-4-5-20251001";

type CategoryKey = "lyric" | "artist" | "year" | "title";

// ── Helpers ───────────────────────────────────────────────────────────────────

function pickWeakestCell(
  rounds: Array<{
    genre: string | null;
    decade: string;
    lyricPoints: number;
    artistPoints: number;
    yearPoints: number;
  }>
) {
  // Aggregate accuracy per (genre × decade) × category.
  // Returns the cell with the highest miss rate (min 3 samples to count).
  const cells = new Map<
    string,
    {
      genre: string;
      decade: string;
      lyric: number[];
      artist: number[];
      year: number[];
    }
  >();

  for (const r of rounds) {
    const genre = r.genre ?? "Unknown";
    const key = `${genre}|${r.decade}`;
    if (!cells.has(key)) {
      cells.set(key, { genre, decade: r.decade, lyric: [], artist: [], year: [] });
    }
    const c = cells.get(key)!;
    c.lyric.push(r.lyricPoints > 0 ? 1 : 0);
    c.artist.push(r.artistPoints > 0 ? 1 : 0);
    c.year.push(r.yearPoints > 0 ? 1 : 0);
  }

  let worst: {
    genre: string;
    decade: string;
    category: CategoryKey;
    missRate: number;
    count: number;
  } | null = null;

  for (const c of Array.from(cells.values())) {
    const cats: Array<[CategoryKey, number[]]> = [
      ["lyric", c.lyric],
      ["artist", c.artist],
      ["year", c.year],
    ];
    for (const [cat, arr] of cats) {
      if (arr.length < 3) continue;
      const missRate = 1 - arr.reduce((a, b) => a + b, 0) / arr.length;
      if (!worst || missRate > worst.missRate) {
        worst = { genre: c.genre, decade: c.decade, category: cat, missRate, count: arr.length };
      }
    }
  }

  return worst;
}

function buildSummary(
  rounds: Array<{
    genre: string | null;
    lyricPoints: number;
    artistPoints: number;
    yearPoints: number;
    totalRoundPoints: number;
  }>
) {
  const totalRounds = rounds.length;
  const wins = rounds.filter((r) => r.totalRoundPoints > 0).length;
  const byGenre: Record<string, { n: number; pts: number }> = {};
  for (const r of rounds) {
    const g = r.genre ?? "Unknown";
    if (!byGenre[g]) byGenre[g] = { n: 0, pts: 0 };
    byGenre[g].n++;
    byGenre[g].pts += r.totalRoundPoints;
  }
  const topGenres = Object.entries(byGenre)
    .sort((a, b) => b[1].pts / b[1].n - a[1].pts / a[1].n)
    .slice(0, 3);
  return { totalRounds, wins, topGenres };
}

async function generateDiagnosis(
  weakestCell: NonNullable<ReturnType<typeof pickWeakestCell>>,
  summary: ReturnType<typeof buildSummary>
): Promise<string> {
  if (!process.env.ANTHROPIC_API_KEY) {
    return `You're weakest at ${weakestCell.category} on ${weakestCell.genre} from ${weakestCell.decade}. Practice up.`;
  }

  const anthropic = new Anthropic({ maxRetries: 4 });
  const prompt = `You write punchy, observational 1-sentence diagnostics for a music lyric trivia game.
The user has played ${summary.totalRounds} rounds with ${summary.wins} wins.
Top genres by points/round: ${summary.topGenres.map(([g, s]) => `${g} (${(s.pts / s.n).toFixed(0)} pts avg)`).join(", ")}.
Their weakest spot: ${weakestCell.category} guesses on ${weakestCell.genre} from ${weakestCell.decade} — they miss ${(weakestCell.missRate * 100).toFixed(0)}% of these.

Write ONE sentence (max 22 words) calling out a strength and gently challenging them on the weakness. Tone: punchy, slightly cocky, hype-coach. No greetings. No emojis. No sign-off. Just the sentence.`;

  try {
    const res = await anthropic.messages.create({
      model: MODEL,
      max_tokens: 200,
      messages: [{ role: "user", content: prompt }],
    });
    const block = res.content.find((b) => b.type === "text") as { type: "text"; text: string } | undefined;
    return block?.text?.trim() ?? `You're weakest at ${weakestCell.category} on ${weakestCell.genre} from ${weakestCell.decade}.`;
  } catch (err) {
    console.warn("[insights] LLM diagnosis failed:", err);
    return `You're weakest at ${weakestCell.category} on ${weakestCell.genre} from ${weakestCell.decade}. Practice up.`;
  }
}

// ── Router ────────────────────────────────────────────────────────────────────

export const insightsRouter = router({
  /**
   * Aggregates the last 30 rounds for the authenticated user, identifies the
   * weakest (genre × decade × category) cell, calls Claude Haiku for a 1-line
   * diagnosis, picks 5 candidate songs, upserts into user_insights, and
   * returns the diagnosis + pack song IDs + cell info.
   *
   * Results are cached for 24 h via user_insights.computedAt.
   * Returns null for unauthenticated callers.
   * Returns { eligible: false } when the user has fewer than 10 rounds played.
   */
  getMyWeaknessDiagnosis: publicProcedure.query(async ({ ctx }) => {
    if (!ctx.user?.id) return null;

    const db = await getDb();
    if (!db) return null;

    const userId = ctx.user.id;

    // Cache: return existing row if <24 h old.
    const [cached] = await db
      .select()
      .from(userInsights)
      .where(eq(userInsights.userId, userId))
      .limit(1);

    const cacheStalMs = CACHE_TTL_HOURS * 60 * 60 * 1000;
    if (cached && Date.now() - new Date(cached.computedAt).getTime() < cacheStalMs) {
      return {
        eligible: true as const,
        diagnosis: cached.diagnosis,
        packSongIds: cached.packSongIds,
        roundsAnalyzed: cached.roundsAnalyzed,
        weakestGenre: cached.weakestGenre,
        weakestDecade: cached.weakestDecade,
        weakestCategory: cached.weakestCategory,
      };
    }

    // Fetch last ~30 rounds joined to song metadata.
    const rounds = await db
      .select({
        roundId: roundResults.id,
        lyricPoints: roundResults.lyricPoints,
        artistPoints: roundResults.artistPoints,
        yearPoints: roundResults.yearPoints,
        totalRoundPoints: roundResults.totalRoundPoints,
        songId: roundResults.songId,
        genre: songs.genre,
        decade: songs.decadeRange,
      })
      .from(roundResults)
      .innerJoin(songs, eq(roundResults.songId, songs.id))
      .where(eq(roundResults.activePlayerId, userId))
      .orderBy(desc(roundResults.id))
      .limit(30);

    if (rounds.length < MIN_ROUNDS_FOR_DIAGNOSIS) {
      return {
        eligible: false as const,
        roundsPlayed: rounds.length,
        roundsRequired: MIN_ROUNDS_FOR_DIAGNOSIS,
      };
    }

    const weakest = pickWeakestCell(rounds);
    if (!weakest) {
      return {
        eligible: false as const,
        roundsPlayed: rounds.length,
        roundsRequired: MIN_ROUNDS_FOR_DIAGNOSIS,
      };
    }

    // Pick 5 songs from the weakest cell, preferring songs the user hasn't
    // played in the analyzed window. Fall back to any songs in the cell if
    // there aren't enough fresh ones.
    const playedIds = new Set(rounds.map((r) => r.songId));
    const candidates = await db
      .select({ id: songs.id })
      .from(songs)
      .where(
        and(
          eq(songs.genre, weakest.genre),
          eq(songs.decadeRange, weakest.decade),
          eq(songs.isActive, true),
          eq(songs.approvalStatus, "approved")
        )
      );

    const fresh = candidates.filter((c) => !playedIds.has(c.id));
    const pool = fresh.length >= PACK_SIZE ? fresh : candidates;
    const shuffled = [...pool].sort(() => Math.random() - 0.5).slice(0, PACK_SIZE);
    const packSongIds = shuffled.map((s) => s.id);

    if (packSongIds.length === 0) {
      return {
        eligible: false as const,
        roundsPlayed: rounds.length,
        roundsRequired: MIN_ROUNDS_FOR_DIAGNOSIS,
      };
    }

    const summary = buildSummary(rounds);
    const diagnosis = await generateDiagnosis(weakest, summary);

    // Upsert into user_insights.
    if (cached) {
      await db
        .update(userInsights)
        .set({
          diagnosis,
          packSongIds,
          roundsAnalyzed: rounds.length,
          weakestGenre: weakest.genre,
          weakestDecade: weakest.decade,
          weakestCategory: weakest.category,
          computedAt: new Date(),
        })
        .where(eq(userInsights.userId, userId));
    } else {
      await db.insert(userInsights).values({
        userId,
        diagnosis,
        packSongIds,
        roundsAnalyzed: rounds.length,
        weakestGenre: weakest.genre,
        weakestDecade: weakest.decade,
        weakestCategory: weakest.category,
      });
    }

    return {
      eligible: true as const,
      diagnosis,
      packSongIds,
      roundsAnalyzed: rounds.length,
      weakestGenre: weakest.genre,
      weakestDecade: weakest.decade,
      weakestCategory: weakest.category,
    };
  }),

  /**
   * Debits 4 GN and creates a solo game room pre-seeded with the songs from
   * the user's cached weakness pack. The user must have a valid user_insights
   * row (i.e., getMyWeaknessDiagnosis must have been called first).
   *
   * Returns the new room code.
   */
  playWeaknessPack: publicProcedure.mutation(async ({ ctx }) => {
    if (!ctx.user?.id) {
      throw new TRPCError({ code: "UNAUTHORIZED", message: "Sign in to play a Practice Pack." });
    }

    const db = await getDb();
    if (!db) {
      throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "Database unavailable." });
    }

    const userId = ctx.user.id;

    // Require a cached insight row with songs.
    const [insight] = await db
      .select()
      .from(userInsights)
      .where(eq(userInsights.userId, userId))
      .limit(1);

    if (!insight || !insight.packSongIds || insight.packSongIds.length === 0) {
      throw new TRPCError({
        code: "BAD_REQUEST",
        message: "No personalized pack available — play a few more rounds first.",
      });
    }

    // Check GN balance.
    const [bal] = await db
      .select()
      .from(goldenNoteBalances)
      .where(eq(goldenNoteBalances.userId, userId))
      .limit(1);

    if (!bal || bal.balance < PACK_PRICE_GN) {
      throw new TRPCError({
        code: "PAYMENT_REQUIRED",
        message: `Need ${PACK_PRICE_GN} Golden Notes. You have ${bal?.balance ?? 0}.`,
      });
    }

    const newBalance = bal.balance - PACK_PRICE_GN;

    // Debit GN and record transaction.
    await db
      .update(goldenNoteBalances)
      .set({
        balance: newBalance,
        lifetimeSpent: bal.lifetimeSpent + PACK_PRICE_GN,
        updatedAt: new Date(),
      })
      .where(eq(goldenNoteBalances.userId, userId));

    await db.insert(goldenNoteTransactions).values({
      userId,
      amount: -PACK_PRICE_GN,
      kind: "spend_advanced_mode",
      reason: `Weakness pack: ${insight.weakestGenre ?? ""} ${insight.weakestDecade ?? ""} ${insight.weakestCategory ?? ""}`.trim(),
      balanceAfter: newBalance,
    });

    // Create the custom-pack room.
    const roomCode = nanoid(6).toUpperCase();

    const [created] = await db
      .insert(gameRooms)
      .values({
        roomCode,
        hostUserId: userId,
        hostGuestToken: null,
        mode: "solo",
        status: "active",
        currentRound: 1,
        currentPlayerIndex: 0,
        roundsTotal: insight.packSongIds.length,
        timerSeconds: 30,
        difficulty: "medium",
        explicitFilter: false,
        selectedGenres: JSON.stringify([insight.weakestGenre]),
        selectedDecades: JSON.stringify([insight.weakestDecade]),
        rankingMode: "total_points",
        customPackSongIds: insight.packSongIds,
        usedSongIds: "[]",
      })
      .returning();

    // Add the host as the sole player (mirrors createRoom pattern).
    await db.insert(roomPlayers).values({
      roomId: created.id,
      userId,
      guestToken: null,
      guestName: null,
      joinOrder: 0,
      currentScore: 0,
      currentStreak: 0,
      isReady: true, // solo mode — start immediately
      isActive: true,
    });

    return { roomCode: created.roomCode };
  }),
});
