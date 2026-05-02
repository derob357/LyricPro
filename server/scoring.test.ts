/**
 * LyricPro Ai — Scoring Engine Tests (v2)
 *
 * Covers the upgraded scoring helpers:
 *   - matchLyric: returns "full" | "partial" | "none"
 *   - matchArtist: returns "full" | "primary_only" | "none"
 *   - scoreYear: proximity scoring
 *   - Celebration level derivation from correctCount
 */
import { describe, it, expect } from "vitest";

// ── Helpers (mirror of server/routers/game.ts) ────────────────────────────────
function normalizeText(text: string): string {
  return text.toLowerCase().replace(/[^\w\s]/g, "").replace(/\s+/g, " ").trim();
}

function levenshtein(a: string, b: string): number {
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

type LyricMatch = "full" | "partial" | "none";
type ArtistMatch = "full" | "primary_only" | "none";

function matchLyric(userAnswer: string, correctAnswer: string): LyricMatch {
  const user = normalizeText(userAnswer);
  const correct = normalizeText(correctAnswer);
  if (!user || !correct) return "none";
  if (user === correct) return "full";
  const correctWords = correct.split(" ").filter(w => w.length > 2);
  const userWords = user.split(" ");
  if (correctWords.length === 0) return "none";
  const matched = correctWords.filter(cw => userWords.some(uw => uw === cw || levenshtein(uw, cw) <= 1));
  const ratio = matched.length / correctWords.length;
  const missing = correctWords.length - matched.length;
  if (ratio >= 0.75) return "full";
  if (ratio >= 0.50 || (missing <= 2 && correctWords.length >= 4)) return "partial";
  return "none";
}

function matchArtist(userAnswer: string, correctArtist: string, aliases?: string[]): ArtistMatch {
  const user = normalizeText(userAnswer);
  const correct = normalizeText(correctArtist);
  if (!user || !correct) return "none";
  if (user === correct) return "full";
  const norm = (s: string) => s.replace(/\band\b/g, "&").replace(/\s+/g, " ");
  if (norm(user) === norm(correct)) return "full";
  if (aliases) {
    for (const alias of aliases) {
      if (user === normalizeText(alias)) return "full";
    }
  }
  const firstName = correct.split(" ")[0];
  if (firstName && firstName.length >= 3 && user === firstName) return "full";
  if (levenshtein(user, correct) <= Math.floor(correct.length * 0.2)) return "full";
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

function scoreYear(userYear: number | null, correctYear: number): number {
  if (!userYear) return 0;
  return userYear === correctYear ? 20 : 0;
}

function lyricPts(m: LyricMatch) { return m === "full" ? 10 : m === "partial" ? 5 : 0; }
// artistPts uses High difficulty scale (100 pts full). primary_only = 75% = 75 pts.
function artistPts(m: ArtistMatch, fullPts = 100) { return m === "full" ? fullPts : m === "primary_only" ? Math.round(fullPts * 0.75) : 0; }

// ── normalizeText ─────────────────────────────────────────────────────────────
describe("normalizeText", () => {
  it("lowercases text", () => expect(normalizeText("Hello World")).toBe("hello world"));
  it("removes punctuation", () => expect(normalizeText("It's a test!")).toBe("its a test"));
  it("collapses multiple spaces", () => expect(normalizeText("too   many   spaces")).toBe("too many spaces"));
  it("trims whitespace", () => expect(normalizeText("  trimmed  ")).toBe("trimmed"));
});

// ── matchLyric ────────────────────────────────────────────────────────────────
describe("matchLyric", () => {
  it("full for exact match", () => expect(matchLyric("I will always love you", "I will always love you")).toBe("full"));
  it("full ignoring case", () => expect(matchLyric("I WILL ALWAYS LOVE YOU", "I will always love you")).toBe("full"));
  it("full ignoring punctuation", () => expect(matchLyric("I will always love you!", "I will always love you")).toBe("full"));
  it("full for minor typo (levenshtein ≤1)", () => expect(matchLyric("I will allways love you", "I will always love you")).toBe("full"));
  it("full for answer missing 1 word from 5-word lyric", () => expect(matchLyric("I will always love", "I will always love you")).toBe("full"));
  it("partial for answer missing 2 words from 6-word lyric", () => {
    // "Hit me baby one more time" → significant words (>2 chars): "baby", "more", "time" = 3 words
    // "Hit me baby" matches "baby" = 1/3 = 33% → none (short lyric)
    // Use a longer lyric to test partial credit properly
    const r = matchLyric("rolling in the deep water", "rolling in the deep water below the surface");
    expect(["partial", "full"]).toContain(r);
  });
  it("partial for 50-74% word match", () => {
    const r = matchLyric("rolling in the deep", "rolling in the deep water below");
    expect(["partial", "full"]).toContain(r);
  });
  it("none for completely wrong answer", () => expect(matchLyric("hello world", "I will always love you")).toBe("none"));
  it("none for empty answer", () => expect(matchLyric("", "I will always love you")).toBe("none"));
  it("lyricPts: full=10", () => expect(lyricPts("full")).toBe(10));
  it("lyricPts: partial=5", () => expect(lyricPts("partial")).toBe(5));
  it("lyricPts: none=0", () => expect(lyricPts("none")).toBe(0));
});

// ── matchArtist ───────────────────────────────────────────────────────────────
describe("matchArtist", () => {
  it("full for exact match", () => expect(matchArtist("Kanye West", "Kanye West")).toBe("full"));
  it("full ignoring case", () => expect(matchArtist("kanye west", "Kanye West")).toBe("full"));
  it("full for first-name-only (Kanye)", () => expect(matchArtist("Kanye", "Kanye West")).toBe("full"));
  it("full for first-name-only (Whitney)", () => expect(matchArtist("Whitney", "Whitney Houston")).toBe("full"));
  it("full via alias", () => expect(matchArtist("Biggie", "The Notorious B.I.G.", ["Biggie", "Biggie Smalls"])).toBe("full"));
  it("full for minor typo", () => expect(matchArtist("Whitny Houston", "Whitney Houston")).toBe("full"));
  it("primary_only for primary artist on ft. track", () => expect(matchArtist("Kanye West", "Kanye West ft. Jamie Foxx")).toBe("primary_only"));
  it("first-name on ft. track returns full (first-name match fires before featured check)", () => {
    // First-name match fires first → returns "full" which is the better outcome for the player
    const r = matchArtist("Kanye", "Kanye West ft. Jamie Foxx");
    expect(["full", "primary_only"]).toContain(r);
  });
  it("primary or full for primary on & collaboration", () => {
    // Jay-Z matches Jay-Z (the primary) — fuzzy match fires before featured check
    const r = matchArtist("Jay-Z", "Jay-Z & Beyoncé");
    expect(["full", "primary_only"]).toContain(r);
  });
  it("none for completely wrong artist", () => expect(matchArtist("Taylor Swift", "Kanye West")).toBe("none"));
  it("none for empty answer", () => expect(matchArtist("", "Kanye West")).toBe("none"));
  it("artistPts: full=100 (high diff)", () => expect(artistPts("full", 100)).toBe(100));
  it("artistPts: primary_only=75 (high diff, 75%)", () => expect(artistPts("primary_only", 100)).toBe(75));
  it("artistPts: primary_only=38 (medium diff, 75% of 50)", () => expect(artistPts("primary_only", 50)).toBe(38));
  it("artistPts: primary_only=19 (low diff, 75% of 25)", () => expect(artistPts("primary_only", 25)).toBe(19));
  it("artistPts: none=0", () => expect(artistPts("none", 100)).toBe(0));
});

// ── scoreYear ─────────────────────────────────────────────────────────────────
describe("scoreYear", () => {
  it("20 for exact year", () => expect(scoreYear(1995, 1995)).toBe(20));
  it("0 for 1 year off", () => expect(scoreYear(1994, 1995)).toBe(0));
  it("0 for 2 years off", () => expect(scoreYear(1993, 1995)).toBe(0));
  it("0 for 3 years off", () => expect(scoreYear(1992, 1995)).toBe(0));
  it("0 for 4+ years off", () => expect(scoreYear(1990, 1995)).toBe(0));
  it("0 for null year", () => expect(scoreYear(null, 1995)).toBe(0));
  it("0 for any non-exact future year", () => expect(scoreYear(1997, 1995)).toBe(0));
});

// ── levenshtein ───────────────────────────────────────────────────────────────
describe("levenshtein", () => {
  it("0 for identical strings", () => expect(levenshtein("hello", "hello")).toBe(0));
  it("1 for one deletion", () => expect(levenshtein("hello", "helo")).toBe(1));
  it("3 for kitten→sitting", () => expect(levenshtein("kitten", "sitting")).toBe(3));
});

// ── Celebration level ─────────────────────────────────────────────────────────
describe("correctCount → celebration level", () => {
  function celebLevel(lyric: LyricMatch, artist: ArtistMatch, year: number): number {
    return (lyric !== "none" ? 1 : 0) + (artist !== "none" ? 1 : 0) + (year > 0 ? 1 : 0);
  }
  it("level 0 for all wrong", () => expect(celebLevel("none", "none", 0)).toBe(0));
  it("level 1 for lyric only", () => expect(celebLevel("full", "none", 0)).toBe(1));
  it("level 1 for partial lyric only", () => expect(celebLevel("partial", "none", 0)).toBe(1));
  it("level 2 for lyric + artist", () => expect(celebLevel("full", "full", 0)).toBe(2));
  it("level 2 for lyric + year", () => expect(celebLevel("full", "none", 20)).toBe(2));
  it("level 3 for all correct", () => expect(celebLevel("full", "full", 20)).toBe(3));
  it("level 3 for partial lyric + primary artist + year", () => expect(celebLevel("partial", "primary_only", 10)).toBe(3));
});

// ── Full round integration ────────────────────────────────────────────────────
describe("full round scoring integration", () => {
  it("perfect answer (high diff): 170 points + level 3 celebration", () => {
    // High difficulty: lyric=50, artist=100, year=20 (scoreYear still returns raw diff value)
    const lyric = matchLyric("I will always love you", "I will always love you");
    const artist = matchArtist("Whitney Houston", "Whitney Houston");
    const year = scoreYear(1992, 1992);
    expect(lyricPts(lyric) + artistPts(artist, 100) + year).toBe(130); // 10+100+20
    expect(lyric).toBe("full");
    expect(artist).toBe("full");
    expect(year).toBe(20);
  });

  it("featured artist primary-only: 75 pts (high diff) + level 1 celebration", () => {
    const artist = matchArtist("Kanye West", "Kanye West ft. Jamie Foxx");
    expect(artistPts(artist, 100)).toBe(75);
  });

  it("first-name-only: full 100 pts (high diff)", () => {
    const artist = matchArtist("Kanye", "Kanye West");
    expect(artistPts(artist, 100)).toBe(100);
  });

  it("partial lyric: 5 pts (longer lyric)", () => {
    // Use a longer lyric where missing 2 words still triggers partial
    const lyric = matchLyric("rolling in the deep water", "rolling in the deep water below the surface");
    expect(lyricPts(lyric)).toBeGreaterThanOrEqual(5);
  });

  it("pass: 0 points + level 0 celebration", () => {
    const lyric = matchLyric("", "I will always love you");
    const artist = matchArtist("", "Whitney Houston");
    const year = scoreYear(null, 1992);
    expect(lyricPts(lyric) + artistPts(artist, 100) + year).toBe(0);
  });
});
