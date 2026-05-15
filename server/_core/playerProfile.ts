// AI Player Intelligence — Phase 1: Profile Builder
//
// Computes a behavioural profile for a user from their last 50 completed
// games. Called fire-and-forget at game completion. The profile is stored
// in player_profiles and consumed by later phases (suggestions, commentary).

import { eq, desc, and, sql, gte } from "drizzle-orm";
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnyDb = PostgresJsDatabase<any>;
import type { PostgresJsDatabase } from "drizzle-orm/postgres-js";
import {
  roundResults,
  gameRooms,
  roomPlayers,
  songs,
  users,
  playerProfiles,
  goldenNoteBalances,
} from "../../drizzle/schema";

// ─── Types ──────────────────────────────────────────────────────────────────

type Stage = "lyric" | "title" | "artist" | "year";
type TimeOfDay = "morning" | "afternoon" | "evening" | "night";
type DifficultyProgression = "stuck" | "climbing" | "peaked";

export interface PlayerProfileData {
  strongestGenres: string[];
  weakestGenres: string[];
  strongestDecades: string[];
  weakestDecades: string[];
  bestStage: Stage;
  worstStage: Stage;

  preferredDifficulty: string;
  hasTriedMultiplayer: boolean;
  hasTriedTeamMode: boolean;
  avgSessionGames: number;
  playTimePreference: TimeOfDay;
  isStreakPlayer: boolean;
  isSpeedPlayer: boolean;
  genreDiversity: number;
  difficultyProgression: DifficultyProgression;

  totalGames: number;
  daysSinceLastGame: number;
  consecutiveDaysPlayed: number;
  goldenNotesSpent: number;
  goldenNotesBalance: number;
}

// ─── Main entry point ───────────────────────────────────────────────────────

export async function computePlayerProfile(
  db: AnyDb,
  userId: number,
): Promise<void> {
  // Check if recompute is needed (skip if games haven't changed).
  const [userRow] = await db
    .select({ gamesPlayed: users.gamesPlayed })
    .from(users)
    .where(eq(users.id, userId))
    .limit(1);
  if (!userRow) return;

  const [existing] = await db
    .select({ gamesAtCompute: playerProfiles.gamesAtCompute })
    .from(playerProfiles)
    .where(eq(playerProfiles.userId, userId))
    .limit(1);
  if (existing && existing.gamesAtCompute >= userRow.gamesPlayed) return;

  // ── Fetch last 50 games worth of round results ───────────────────────────
  // Get the most recent 50 distinct roomIds this user participated in.
  const recentRoomRows = await db
    .select({ roomId: roomPlayers.roomId })
    .from(roomPlayers)
    .where(eq(roomPlayers.userId, userId))
    .orderBy(desc(roomPlayers.joinedAt))
    .limit(50);
  const roomIds = recentRoomRows.map(r => r.roomId);
  if (roomIds.length === 0) return;

  // Fetch room metadata for those games.
  const roomRows = await db
    .select({
      id: gameRooms.id,
      mode: gameRooms.mode,
      difficulty: gameRooms.difficulty,
      selectedGenres: gameRooms.selectedGenres,
      selectedDecades: gameRooms.selectedDecades,
      rankingMode: gameRooms.rankingMode,
      createdAt: gameRooms.createdAt,
      status: gameRooms.status,
      roundsTotal: gameRooms.roundsTotal,
      currentRound: gameRooms.currentRound,
    })
    .from(gameRooms)
    .where(sql`${gameRooms.id} IN (${sql.join(roomIds.map(id => sql`${id}`), sql`, `)})`);
  const roomMap = new Map(roomRows.map(r => [r.id, r]));

  // Fetch all round_results for this player in those rooms.
  const playerRows = await db
    .select({ id: roomPlayers.id, roomId: roomPlayers.roomId })
    .from(roomPlayers)
    .where(
      and(
        eq(roomPlayers.userId, userId),
        sql`${roomPlayers.roomId} IN (${sql.join(roomIds.map(id => sql`${id}`), sql`, `)})`,
      ),
    );
  const playerIdSet = new Set(playerRows.map(p => p.id));
  const playerRoomMap = new Map(playerRows.map(p => [p.id, p.roomId]));

  const results = await db
    .select({
      activePlayerId: roundResults.activePlayerId,
      songId: roundResults.songId,
      lyricPoints: roundResults.lyricPoints,
      artistPoints: roundResults.artistPoints,
      yearPoints: roundResults.yearPoints,
      speedBonusPoints: roundResults.speedBonusPoints,
      streakBonusPoints: roundResults.streakBonusPoints,
      totalRoundPoints: roundResults.totalRoundPoints,
      responseTimeSeconds: roundResults.responseTimeSeconds,
      passUsed: roundResults.passUsed,
      roomId: roundResults.roomId,
      createdAt: roundResults.createdAt,
    })
    .from(roundResults)
    .where(
      sql`${roundResults.roomId} IN (${sql.join(roomIds.map(id => sql`${id}`), sql`, `)})`,
    );

  // Filter to this player's results only.
  const myResults = results.filter(r => r.activePlayerId && playerIdSet.has(r.activePlayerId));
  if (myResults.length === 0) return;

  // Fetch song metadata for genre/decade mapping.
  const songIds = Array.from(new Set(myResults.map(r => r.songId)));
  const songRows = await db
    .select({
      id: songs.id,
      genre: songs.genre,
      decadeRange: songs.decadeRange,
    })
    .from(songs)
    .where(sql`${songs.id} IN (${sql.join(songIds.map(id => sql`${id}`), sql`, `)})`);
  const songMap = new Map(songRows.map(s => [s.id, s]));

  // ── Compute genre accuracy ───────────────────────────────────────────────
  const genreStats = new Map<string, { correct: number; total: number }>();
  const decadeStats = new Map<string, { correct: number; total: number }>();
  let totalLyricPts = 0, totalTitlePts = 0, totalArtistPts = 0, totalYearPts = 0;
  let totalLyricRounds = 0, totalTitleRounds = 0, totalArtistRounds = 0, totalYearRounds = 0;
  let totalResponseTime = 0;
  let responseTimeCount = 0;
  const genresPlayed = new Set<string>();
  let longestStreak = 0;
  let currentStreak = 0;

  for (const r of myResults) {
    const song = songMap.get(r.songId);
    if (!song) continue;
    const room = roomMap.get(r.roomId ?? 0);

    // Genre stats
    genresPlayed.add(song.genre);
    const gs = genreStats.get(song.genre) ?? { correct: 0, total: 0 };
    gs.total++;
    if (r.totalRoundPoints > 0) gs.correct++;
    genreStats.set(song.genre, gs);

    // Decade stats
    const decade = song.decadeRange ?? "Unknown";
    const ds = decadeStats.get(decade) ?? { correct: 0, total: 0 };
    ds.total++;
    if (r.totalRoundPoints > 0) ds.correct++;
    decadeStats.set(decade, ds);

    // Stage accuracy — titlePoints is not stored separately, derive it
    const titlePts = r.totalRoundPoints - r.lyricPoints - r.artistPoints -
      r.yearPoints - r.speedBonusPoints - r.streakBonusPoints;

    // Determine the max possible per-stage from difficulty
    const diff = room?.difficulty ?? "medium";
    const maxPts = {
      low: { lyric: 25, title: 25, artist: 25, year: 50 },
      medium: { lyric: 50, title: 50, artist: 50, year: 100 },
      high: { lyric: 50, title: 50, artist: 100, year: 200 },
    }[diff] ?? { lyric: 50, title: 50, artist: 50, year: 100 };

    if (!r.passUsed) {
      totalLyricPts += r.lyricPoints;
      totalLyricRounds += maxPts.lyric;
      totalTitlePts += Math.max(0, titlePts);
      totalTitleRounds += maxPts.title;
      totalArtistPts += r.artistPoints;
      totalArtistRounds += maxPts.artist;
      totalYearPts += r.yearPoints;
      totalYearRounds += maxPts.year;
    }

    // Response time
    if (r.responseTimeSeconds && r.responseTimeSeconds > 0) {
      totalResponseTime += r.responseTimeSeconds;
      responseTimeCount++;
    }

    // Streak tracking (simplified: consecutive non-zero rounds)
    if (r.lyricPoints > 0) {
      currentStreak++;
      longestStreak = Math.max(longestStreak, currentStreak);
    } else {
      currentStreak = 0;
    }
  }

  // ── Rank genres and decades ──────────────────────────────────────────────
  const rankByAccuracy = (stats: Map<string, { correct: number; total: number }>) => {
    return Array.from(stats.entries())
      .filter(([, v]) => v.total >= 3) // need at least 3 rounds to rank
      .map(([k, v]) => ({ key: k, accuracy: v.correct / v.total }))
      .sort((a, b) => b.accuracy - a.accuracy);
  };

  const genreRanked = rankByAccuracy(genreStats);
  const decadeRanked = rankByAccuracy(decadeStats);

  const strongestGenres = genreRanked.slice(0, 2).map(g => g.key);
  const weakestGenres = genreRanked.slice(-2).map(g => g.key);
  const strongestDecades = decadeRanked.slice(0, 2).map(d => d.key);
  const weakestDecades = decadeRanked.slice(-2).map(d => d.key);

  // ── Stage accuracy ranking ───────────────────────────────────────────────
  const stageAccuracy: Record<Stage, number> = {
    lyric: totalLyricRounds > 0 ? totalLyricPts / totalLyricRounds : 0,
    title: totalTitleRounds > 0 ? totalTitlePts / totalTitleRounds : 0,
    artist: totalArtistRounds > 0 ? totalArtistPts / totalArtistRounds : 0,
    year: totalYearRounds > 0 ? totalYearPts / totalYearRounds : 0,
  };
  const stageRanked = (Object.entries(stageAccuracy) as [Stage, number][])
    .sort((a, b) => b[1] - a[1]);
  const bestStage = stageRanked[0][0];
  const worstStage = stageRanked[stageRanked.length - 1][0];

  // ── Behavioral patterns ──────────────────────────────────────────────────
  const diffCounts = new Map<string, number>();
  const modeCounts = new Map<string, number>();
  const playDates = new Set<string>();
  const hourCounts = { morning: 0, afternoon: 0, evening: 0, night: 0 };

  for (const room of roomRows) {
    const d = room.difficulty;
    diffCounts.set(d, (diffCounts.get(d) ?? 0) + 1);
    modeCounts.set(room.mode, (modeCounts.get(room.mode) ?? 0) + 1);
    if (room.createdAt) {
      const date = new Date(room.createdAt);
      playDates.add(date.toISOString().slice(0, 10));
      const hour = date.getHours();
      if (hour >= 5 && hour < 12) hourCounts.morning++;
      else if (hour >= 12 && hour < 17) hourCounts.afternoon++;
      else if (hour >= 17 && hour < 21) hourCounts.evening++;
      else hourCounts.night++;
    }
  }

  const preferredDifficulty = Array.from(diffCounts.entries())
    .sort((a, b) => b[1] - a[1])[0]?.[0] ?? "medium";
  const hasTriedMultiplayer = modeCounts.has("multiplayer") || modeCounts.has("team");
  const hasTriedTeamMode = modeCounts.has("team");
  const playTimePreference = (Object.entries(hourCounts) as [TimeOfDay, number][])
    .sort((a, b) => b[1] - a[1])[0][0];

  const avgResponseTime = responseTimeCount > 0
    ? totalResponseTime / responseTimeCount
    : 30;
  const isSpeedPlayer = avgResponseTime < 8;
  const isStreakPlayer = longestStreak >= 5;

  // Genre diversity: unique genres played / total available genres (cap at 9)
  const genreDiversityRaw = genresPlayed.size / 9;
  const genreDiversity = Math.min(genreDiversityRaw, 1);

  // Difficulty progression: compare first-half vs second-half difficulty
  const diffMap: Record<string, number> = { low: 1, medium: 2, high: 3 };
  const roomsSorted = [...roomRows].sort((a, b) =>
    new Date(a.createdAt!).getTime() - new Date(b.createdAt!).getTime());
  const mid = Math.floor(roomsSorted.length / 2);
  const firstHalfAvg = roomsSorted.slice(0, Math.max(mid, 1))
    .reduce((s, r) => s + (diffMap[r.difficulty] ?? 2), 0) / Math.max(mid, 1);
  const secondHalfAvg = roomsSorted.slice(mid)
    .reduce((s, r) => s + (diffMap[r.difficulty] ?? 2), 0) / Math.max(roomsSorted.length - mid, 1);
  let difficultyProgression: DifficultyProgression = "stuck";
  if (secondHalfAvg > firstHalfAvg + 0.3) difficultyProgression = "climbing";
  else if (secondHalfAvg >= 2.5 && firstHalfAvg >= 2.5) difficultyProgression = "peaked";

  // Session grouping: games within 2 hours of each other = same session
  const sortedDates = Array.from(playDates).sort();
  const avgSessionGames = sortedDates.length > 0
    ? roomRows.length / sortedDates.length
    : 0;

  // Consecutive days played (streak ending at most recent date)
  let consecutiveDaysPlayed = 0;
  if (sortedDates.length > 0) {
    consecutiveDaysPlayed = 1;
    for (let i = sortedDates.length - 1; i > 0; i--) {
      const curr = new Date(sortedDates[i]);
      const prev = new Date(sortedDates[i - 1]);
      const diffDays = (curr.getTime() - prev.getTime()) / (1000 * 60 * 60 * 24);
      if (diffDays <= 1.5) consecutiveDaysPlayed++;
      else break;
    }
  }

  // Days since last game
  const lastGameDate = sortedDates[sortedDates.length - 1];
  const daysSinceLastGame = lastGameDate
    ? Math.floor((Date.now() - new Date(lastGameDate).getTime()) / (1000 * 60 * 60 * 24))
    : 999;

  // ── Golden Notes ─────────────────────────────────────────────────────────
  let goldenNotesBalance = 0;
  let goldenNotesSpent = 0;
  try {
    const [gnRow] = await db
      .select({
        balance: goldenNoteBalances.balance,
        totalSpent: goldenNoteBalances.lifetimeSpent,
      })
      .from(goldenNoteBalances)
      .where(eq(goldenNoteBalances.userId, userId))
      .limit(1);
    if (gnRow) {
      goldenNotesBalance = gnRow.balance;
      goldenNotesSpent = gnRow.totalSpent;
    }
  } catch {
    // Table may not exist in all envs; non-critical.
  }

  // ── Assemble and upsert ──────────────────────────────────────────────────
  const profile: PlayerProfileData = {
    strongestGenres,
    weakestGenres,
    strongestDecades,
    weakestDecades,
    bestStage,
    worstStage,
    preferredDifficulty,
    hasTriedMultiplayer,
    hasTriedTeamMode,
    avgSessionGames: Math.round(avgSessionGames * 10) / 10,
    playTimePreference,
    isStreakPlayer,
    isSpeedPlayer,
    genreDiversity: Math.round(genreDiversity * 100) / 100,
    difficultyProgression,
    totalGames: userRow.gamesPlayed,
    daysSinceLastGame,
    consecutiveDaysPlayed,
    goldenNotesSpent,
    goldenNotesBalance,
  };

  await db
    .insert(playerProfiles)
    .values({
      userId,
      profile: profile as unknown as Record<string, unknown>,
      computedAt: new Date(),
      gamesAtCompute: userRow.gamesPlayed,
    })
    .onConflictDoUpdate({
      target: playerProfiles.userId,
      set: {
        profile: profile as unknown as Record<string, unknown>,
        computedAt: new Date(),
        gamesAtCompute: userRow.gamesPlayed,
      },
    });
}
