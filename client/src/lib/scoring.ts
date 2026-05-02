/**
 * LyricPro Ai Scoring Engine
 * Handles fuzzy matching, year proximity, and point calculation
 */

// ── Normalize text for fuzzy comparison ──────────────────────────────────────
export function normalizeText(text: string): string {
  return text
    .toLowerCase()
    .replace(/[^\w\s]/g, "") // remove punctuation
    .replace(/\s+/g, " ")    // collapse spaces
    .trim();
}

// ── Lyric match result ────────────────────────────────────────────────────────
export type LyricMatchResult = "full" | "partial" | "none";

/**
 * Returns:
 *  "full"    → 10 pts  (≥75% of key words matched)
 *  "partial" → 5 pts   (≥50% matched, or missing ≤2 words from a full match)
 *  "none"    → 0 pts
 */
export function matchLyric(userAnswer: string, correctAnswer: string): LyricMatchResult {
  const user = normalizeText(userAnswer);
  const correct = normalizeText(correctAnswer);

  if (!user || !correct) return "none";

  // Exact match after normalization
  if (user === correct) return "full";

  // Filter to meaningful words (length > 2)
  const correctWords = correct.split(" ").filter(w => w.length > 2);
  const userWords = user.split(" ");

  if (correctWords.length === 0) return "none";

  const matchedWords = correctWords.filter(cw =>
    userWords.some(uw => uw === cw || levenshtein(uw, cw) <= 1)
  );

  const matchRatio = matchedWords.length / correctWords.length;
  const missingCount = correctWords.length - matchedWords.length;

  if (matchRatio >= 0.75) return "full";
  // Near-miss: ≥50% match OR only 1-2 words missing from a longer lyric
  if (matchRatio >= 0.50 || (missingCount <= 2 && correctWords.length >= 4)) return "partial";
  return "none";
}

// ── Artist match result ───────────────────────────────────────────────────────
export type ArtistMatchResult = "full" | "primary_only" | "none";

/**
 * Returns:
 *  "full"         → 10 pts  (exact or alias match, including first-name-only)
 *  "primary_only" → 8 pts   (matched primary artist when song has a featured artist)
 *  "none"         → 0 pts
 *
 * Featured artist detection: correctArtist contains " ft.", " feat.", " featuring", " x ", " & ", " and "
 * First-name match: user answer matches the first word of the artist name
 */
export function matchArtist(
  userAnswer: string,
  correctArtist: string,
  aliases?: string[]
): ArtistMatchResult {
  const user = normalizeText(userAnswer);
  const correct = normalizeText(correctArtist);

  if (!user || !correct) return "none";

  // Direct match
  if (user === correct) return "full";

  // Normalize "and" vs "&"
  const normalizeAnd = (s: string) => s.replace(/\band\b/g, "&").replace(/\s+/g, " ");
  if (normalizeAnd(user) === normalizeAnd(correct)) return "full";

  // Check aliases
  if (aliases) {
    for (const alias of aliases) {
      if (user === normalizeText(alias)) return "full";
    }
  }

  // First-name-only match: "Kanye" matches "Kanye West"
  const correctFirstName = correct.split(" ")[0];
  if (correctFirstName && correctFirstName.length >= 3 && user === correctFirstName) return "full";

  // Fuzzy match for close spellings (e.g. "Beyoncé" vs "Beyonce")
  if (levenshtein(user, correct) <= Math.floor(correct.length * 0.2)) return "full";

  // Featured artist detection — split on common ft. separators
  const featSeparators = /\s+(?:ft\.?|feat\.?|featuring|x)\s+/i;
  if (featSeparators.test(correctArtist) || correctArtist.includes(" & ") || /\band\b/i.test(correctArtist)) {
    // Extract primary artist (everything before the separator)
    const primaryRaw = correctArtist.split(featSeparators)[0]
      .split(" & ")[0]
      .replace(/\band\b.*/i, "")
      .trim();
    const primary = normalizeText(primaryRaw);

    if (primary && (
      user === primary ||
      normalizeAnd(user) === normalizeAnd(primary) ||
      levenshtein(user, primary) <= Math.floor(primary.length * 0.2) ||
      user === primary.split(" ")[0]  // first-name of primary
    )) {
      return "primary_only";
    }
  }

  return "none";
}

// ── Year proximity scoring ────────────────────────────────────────────────────
export function scoreYear(userYear: number | null, correctYear: number): number {
  if (!userYear || isNaN(userYear)) return 0;
  return userYear === correctYear ? 20 : 0;
}

// ── Full round scoring ────────────────────────────────────────────────────────
export interface ScoreResult {
  lyricPoints: number;
  artistPoints: number;
  yearPoints: number;
  speedBonus: number;
  streakBonus: number;
  total: number;
  lyricCorrect: boolean;
  lyricPartial: boolean;
  artistCorrect: boolean;
  artistPartial: boolean;
  /** Number of questions answered correctly (0-3), used for celebration level */
  correctCount: number;
}

export function calculateRoundScore(params: {
  lyricAnswer: string;
  artistAnswer: string;
  yearAnswer: string;
  correctLyric: string;
  correctArtist: string;
  correctYear: number;
  artistAliases?: string[];
  responseTimeSeconds: number;
  timerSeconds: number;
  currentStreak: number;
  rankingMode: "total_points" | "speed_bonus" | "streak_bonus";
  passUsed: boolean;
}): ScoreResult {
  if (params.passUsed) {
    return {
      lyricPoints: 0, artistPoints: 0, yearPoints: 0,
      speedBonus: 0, streakBonus: 0, total: 0,
      lyricCorrect: false, lyricPartial: false,
      artistCorrect: false, artistPartial: false,
      correctCount: 0,
    };
  }

  const lyricMatch = matchLyric(params.lyricAnswer, params.correctLyric);
  const artistMatch = matchArtist(params.artistAnswer, params.correctArtist, params.artistAliases);
  const yearPoints = scoreYear(parseInt(params.yearAnswer) || null, params.correctYear);

  const lyricCorrect = lyricMatch === "full";
  const lyricPartial = lyricMatch === "partial";
  const artistCorrect = artistMatch === "full";
  const artistPartial = artistMatch === "primary_only";

  const lyricPoints = lyricCorrect ? 10 : lyricPartial ? 5 : 0;
  const artistPoints = artistCorrect ? 10 : artistPartial ? 8 : 0;

  // Speed bonus: up to 5 extra points for fast answers
  let speedBonus = 0;
  if (params.rankingMode === "speed_bonus" && (lyricCorrect || lyricPartial)) {
    const timeRatio = 1 - (params.responseTimeSeconds / params.timerSeconds);
    speedBonus = Math.round(timeRatio * 5);
  }

  // Streak bonus: +2 per consecutive correct answer
  let streakBonus = 0;
  if (params.rankingMode === "streak_bonus" && lyricCorrect && params.currentStreak >= 2) {
    streakBonus = Math.min(params.currentStreak * 2, 10);
  }

  const total = lyricPoints + artistPoints + yearPoints + speedBonus + streakBonus;

  // Count fully-correct answers for celebration level (partial lyric/artist count as correct for celebration)
  const correctCount =
    (lyricCorrect || lyricPartial ? 1 : 0) +
    (artistCorrect || artistPartial ? 1 : 0) +
    (yearPoints > 0 ? 1 : 0);

  return {
    lyricPoints, artistPoints, yearPoints,
    speedBonus, streakBonus, total,
    lyricCorrect, lyricPartial,
    artistCorrect, artistPartial,
    correctCount,
  };
}

// ── Levenshtein distance ──────────────────────────────────────────────────────
export function levenshtein(a: string, b: string): number {
  const m = a.length, n = b.length;
  const dp: number[][] = Array.from({ length: m + 1 }, (_, i) =>
    Array.from({ length: n + 1 }, (_, j) => (i === 0 ? j : j === 0 ? i : 0))
  );
  for (let i = 1; i <= m; i++) {
    for (let j = 1; j <= n; j++) {
      dp[i][j] = a[i - 1] === b[j - 1]
        ? dp[i - 1][j - 1]
        : 1 + Math.min(dp[i - 1][j], dp[i][j - 1], dp[i - 1][j - 1]);
    }
  }
  return dp[m][n];
}

// ── Rank tier calculation ─────────────────────────────────────────────────────
export function getRankTier(lifetimeScore: number): { tier: string; color: string; next: number } {
  if (lifetimeScore >= 10000) return { tier: "Legend", color: "text-gradient-gold", next: Infinity };
  if (lifetimeScore >= 5000) return { tier: "Master", color: "neon-purple", next: 10000 };
  if (lifetimeScore >= 2000) return { tier: "Expert", color: "neon-cyan", next: 5000 };
  if (lifetimeScore >= 750) return { tier: "Pro", color: "text-blue-400", next: 2000 };
  if (lifetimeScore >= 250) return { tier: "Rising Star", color: "text-green-400", next: 750 };
  return { tier: "Rookie", color: "text-muted-foreground", next: 250 };
}
