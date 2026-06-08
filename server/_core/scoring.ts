/**
 * Shared scoring helpers for LyricPro Ai.
 *
 * Moved VERBATIM from server/routers/game.ts (normalizeText, levenshtein,
 * matchLyric, matchArtist, scoreYear) and the inline point-computation block
 * from submitAnswer (lifted into scoreRound).  Both solo-game (game.ts) and
 * the multiplayer match engine (matchEngine.ts) import from here so there is
 * a single source of truth.
 *
 * DO NOT alter the scoring logic in this file without a corresponding update
 * to the tests in server/scoring.test.ts.
 */

export type Difficulty = "low" | "medium" | "high";
export type LyricMatch = "full" | "partial" | "none";
export type ArtistMatch = "full" | "primary_only" | "none";

export function normalizeText(text: string): string {
  return text.toLowerCase().replace(/[^\w\s]/g, "").replace(/\s+/g, " ").trim();
}

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

export function matchLyric(userAnswer: string, correctAnswer: string): LyricMatch {
  const user = normalizeText(userAnswer);
  const correct = normalizeText(correctAnswer);
  if (!user || !correct) return "none";
  if (user === correct) return "full";
  // Allow up to 25% edit distance for full match (handles minor typos/punctuation)
  if (levenshtein(user, correct) <= Math.floor(correct.length * 0.25)) return "full";
  const correctWords = correct.split(" ").filter(w => w.length > 2);
  const userWords = user.split(" ");
  if (correctWords.length === 0) return "none";
  // Allow levenshtein distance of 2 per word for typos
  const matched = correctWords.filter(cw => userWords.some(uw => uw === cw || levenshtein(uw, cw) <= 2));
  const ratio = matched.length / correctWords.length;
  const missing = correctWords.length - matched.length;
  // 60% word match = full (generous for voice input and minor typos)
  if (ratio >= 0.60) return "full";
  if (ratio >= 0.40 || (missing <= 2 && correctWords.length >= 3)) return "partial";
  return "none";
}

export function matchArtist(userAnswer: string, correctArtist: string, aliases?: string[]): ArtistMatch {
  const user = normalizeText(userAnswer);
  const correct = normalizeText(correctArtist);
  if (!user || !correct) return "none";

  const norm = (s: string) => s.replace(/\band\b/g, "&").replace(/\s+/g, " ");

  // Helper: check if a single normalized user token matches the correct artist
  const tokenMatches = (token: string): boolean => {
    if (!token || token.length < 2) return false;
    if (token === correct) return true;
    if (norm(token) === norm(correct)) return true;
    // Alias match
    if (aliases?.some(a => token === normalizeText(a))) return true;
    // First-name-only match
    const firstName = correct.split(" ")[0];
    if (firstName && firstName.length >= 3 && (token === firstName || levenshtein(token, firstName) <= 1)) return true;
    // Fuzzy full match — 30% edit distance
    if (levenshtein(token, correct) <= Math.max(2, Math.floor(correct.length * 0.30))) return true;
    return false;
  };

  // Direct full match
  if (tokenMatches(user)) return "full";

  // Multi-artist answer: split by "and", "&", ",", "ft", "feat"
  // e.g. "Ol dirty bastard and Mariah Carey" → check each part
  const splitRe = /\s+(?:and|&|ft\.?|feat\.?|featuring|x|,)\s+/i;
  const parts = user.split(splitRe).map(p => p.trim()).filter(p => p.length > 1);
  if (parts.length > 1) {
    for (const part of parts) {
      if (tokenMatches(part)) return "full";
    }
  }

  // Featured artist: primary-only (user named only the primary, not the featured)
  const featRe = /\s+(?:ft\.?|feat\.?|featuring|x)\s+/i;
  if (featRe.test(correctArtist) || correctArtist.includes(" & ") || /\band\b/i.test(correctArtist)) {
    const primaryRaw = correctArtist.split(featRe)[0].split(" & ")[0].replace(/\band\b.*/i, "").trim();
    const primary = normalizeText(primaryRaw);
    if (primary && (
      user === primary ||
      norm(user) === norm(primary) ||
      levenshtein(user, primary) <= Math.floor(primary.length * 0.2) ||
      user === primary.split(" ")[0]
    )) return "primary_only";
  }
  return "none";
}

// NOTE: The standalone scoreYear helper reflects actual game behavior — only an
// exact match scores points. The pts table has yearClose2=0 and yearClose3=0
// across all difficulty tiers, so near-misses score 0. The in-game year points
// are computed via the pts table inside scoreRound, not by calling this helper
// directly.  This function exists for test coverage and future caller convenience.
export function scoreYear(userYear: number | null, correctYear: number): number {
  if (!userYear) return 0;
  return userYear === correctYear ? 20 : 0;
}

// ── scoreRound ────────────────────────────────────────────────────────────────
// Pure function: takes all primitives needed to score one round, returns the
// per-axis points + bonuses + total.  The DB insert in submitAnswer (and the
// future matchEngine) writes these values directly.
//
// Input design notes:
//   - `difficulty` drives the pts table (same table that lived inline in game.ts)
//   - `passUsed` short-circuits all scoring to zeroes (same guard as before)
//   - `correctLyricAnswer` is the variant answer the player was shown
//     (playedVariant.answer in game.ts — NOT the song-level legacy field)
//   - `newStreak` is post-insurance streak: caller must resolve streak
//     insurance before calling scoreRound, then pass the resulting streak value
//   - `rankingMode` gates speed_bonus and streak_bonus exactly as before

export interface ScoreRoundInput {
  difficulty: Difficulty;
  passUsed: boolean;
  lyricAnswer: string;
  titleAnswer: string;
  artistAnswer: string;
  yearAnswer: string;
  correctLyricAnswer: string;
  correctTitle: string;
  correctArtistName: string;
  correctReleaseYear: number;
  artistAliases: string[];
  responseTimeSeconds: number;
  timerSeconds: number;
  rankingMode: string;
  /** Post-insurance streak value. Pass 0 if player object unavailable. */
  newStreak: number;
  /** lyricCorrect flag — derived from lyricMatch but needed for streak bonus gate.
   *  Caller should pass the lyricMatch === "full" check, or leave undefined to
   *  let scoreRound derive it internally (default). */
}

export interface ScoreRoundResult {
  lyricPoints: number;
  titlePoints: number;
  artistPoints: number;
  yearPoints: number;
  speedBonusPoints: number;
  streakBonusPoints: number;
  totalRoundPoints: number;
  // Derived match results (needed by submitAnswer for response + correctCount)
  lyricMatch: LyricMatch;
  artistMatch: ArtistMatch;
  titleCorrect: boolean;
  titlePartial: boolean;
}

export function scoreRound(input: ScoreRoundInput): ScoreRoundResult {
  const {
    difficulty: diff,
    passUsed,
    lyricAnswer,
    titleAnswer,
    artistAnswer,
    yearAnswer,
    correctLyricAnswer,
    correctTitle,
    correctArtistName,
    correctReleaseYear,
    artistAliases,
    responseTimeSeconds,
    timerSeconds,
    rankingMode,
    newStreak,
  } = input;

  // Difficulty-based point values
  // All difficulties score the same 4 stages (Lyric, Title, Artist, Year);
  // difficulty is a points multiplier only. Lyric and Title share the same
  // per-difficulty value.
  // Low:    Lyric=25,  Title=25,  Artist=25,  Year=50
  // Medium: Lyric=50,  Title=50,  Artist=50,  Year=100
  // High:   Lyric=50,  Title=50,  Artist=100, Year=200
  const pts = {
    // artistPartial = full artist points (primary-only match = full credit per spec)
    low:    { lyric: 25, lyricPartial: 15, artist: 25,  artistPartial: 25,  title: 25, titlePartial: 15, year: 50,  yearClose2: 0,  yearClose3: 0 },
    medium: { lyric: 50, lyricPartial: 30, artist: 50,  artistPartial: 50,  title: 50, titlePartial: 30, year: 100, yearClose2: 0,  yearClose3: 0 },
    high:   { lyric: 50, lyricPartial: 25, artist: 100, artistPartial: 100, title: 50, titlePartial: 30, year: 200, yearClose2: 0,  yearClose3: 0 },
  }[diff];

  // Score the answer
  let lyricPoints = 0, titlePoints = 0, artistPoints = 0, yearPoints = 0, speedBonus = 0, streakBonus = 0;
  let lyricMatch: LyricMatch = "none";
  let artistMatch: ArtistMatch = "none";
  let titleCorrect = false;
  let titlePartial = false;

  if (!passUsed) {
    // Lyric scoring (all difficulties) — use the variant the player saw,
    // not the legacy column, so variant rotation scores correctly.
    lyricMatch = matchLyric(lyricAnswer, correctLyricAnswer);
    lyricPoints = lyricMatch === "full" ? pts.lyric : lyricMatch === "partial" ? pts.lyricPartial : 0;

    // Title scoring (Low/Medium/High all score title)
    const titleNorm = normalizeText(titleAnswer);
    const correctTitleNorm = normalizeText(correctTitle);
    if (titleNorm && correctTitleNorm) {
      // Full match: exact, or up to 30% edit distance (generous for typos/voice input)
      const titleEditDist = levenshtein(titleNorm, correctTitleNorm);
      const titleThreshold = Math.max(2, Math.floor(correctTitleNorm.length * 0.30));
      if (titleNorm === correctTitleNorm || titleEditDist <= titleThreshold) {
        titleCorrect = true;
        titlePoints = pts.title;
      } else {
        // Partial: significant word overlap (allow levenshtein 2 per word)
        const titleWords = correctTitleNorm.split(" ").filter(w => w.length > 1);
        const userTitleWords = titleNorm.split(" ");
        if (titleWords.length > 0) {
          const matched = titleWords.filter(tw => userTitleWords.some(uw => uw === tw || levenshtein(uw, tw) <= 2));
          if (matched.length / titleWords.length >= 0.5) {
            titlePartial = true;
            titlePoints = pts.titlePartial;
          }
        }
      }
    }

    artistMatch = matchArtist(artistAnswer, correctArtistName, artistAliases);
    artistPoints = artistMatch === "full" ? pts.artist : artistMatch === "primary_only" ? pts.artistPartial : 0;

    // Year scoring with new point values
    const userYear = parseInt(yearAnswer) || null;
    if (userYear) {
      const diff2 = Math.abs(userYear - correctReleaseYear);
      if (diff2 === 0) yearPoints = pts.year;
      else if (diff2 <= 2) yearPoints = pts.yearClose2;
      else if (diff2 <= 3) yearPoints = pts.yearClose3;
    }

    // Speed bonus
    const anyCorrect = lyricMatch !== "none" || titleCorrect || titlePartial || artistMatch !== "none" || yearPoints > 0;
    if (rankingMode === "speed_bonus" && anyCorrect) {
      const timeRatio = 1 - (responseTimeSeconds / timerSeconds);
      speedBonus = Math.max(0, Math.round(timeRatio * (diff === "high" ? 20 : diff === "medium" ? 10 : 5)));
    }
  }

  // Streak bonus (caller passes post-insurance newStreak)
  const lyricCorrect = lyricMatch === "full";
  if (rankingMode === "streak_bonus" && lyricCorrect && newStreak >= 2) {
    streakBonus = Math.min(newStreak * 2, 10);
  }

  const totalRoundPoints = lyricPoints + titlePoints + artistPoints + yearPoints + speedBonus + streakBonus;

  return {
    lyricPoints,
    titlePoints,
    artistPoints,
    yearPoints,
    speedBonusPoints: speedBonus,
    streakBonusPoints: streakBonus,
    totalRoundPoints,
    lyricMatch,
    artistMatch,
    titleCorrect,
    titlePartial,
  };
}
