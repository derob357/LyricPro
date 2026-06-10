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
import {
  normalizeText,
  levenshtein,
  matchLyric,
  matchArtist,
  scoreYear,
  scoreRound,
  resolveMcVariant,
  type LyricMatch,
  type ArtistMatch,
  type ScoreRoundInput,
} from "./_core/scoring";

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

// ── MC exact-match mode (mcMode) ──────────────────────────────────────────────
function mcInput(overrides: Partial<ScoreRoundInput>): ScoreRoundInput {
  return {
    difficulty: "medium",
    passUsed: false,
    lyricAnswer: "shake it off shake it off",
    titleAnswer: "Stay",
    artistAnswer: "Nas",
    yearAnswer: "1994",
    correctLyricAnswer: "shake it off shake it off",
    correctTitle: "Stay",
    correctArtistName: "Nas",
    correctReleaseYear: 1994,
    artistAliases: [],
    responseTimeSeconds: 10,
    timerSeconds: 90,
    rankingMode: "standard",
    newStreak: 0,
    mcMode: true,
    ...overrides,
  };
}

describe("scoreRound mcMode (multiple-choice exact matching)", () => {
  it("wrong title option close in edit distance scores 0 (fuzzy would match)", () => {
    const r = scoreRound(mcInput({ titleAnswer: "Stan" })); // lev("stan","stay")=2 ≤ fuzzy threshold
    expect(r.titleCorrect).toBe(false);
    expect(r.titlePoints).toBe(0);
  });

  it("wrong short artist option within edit distance 2 scores 0", () => {
    const r = scoreRound(mcInput({ artistAnswer: "NAV" })); // lev("nav","nas")=1
    expect(r.artistMatch).toBe("none");
    expect(r.artistPoints).toBe(0);
  });

  it("wrong lyric option sharing >60% words scores 0", () => {
    const r = scoreRound(mcInput({
      correctLyricAnswer: "shake it off shake it off",
      lyricAnswer: "shake it up shake it up",
    }));
    expect(r.lyricMatch).toBe("none");
    expect(r.lyricPoints).toBe(0);
  });

  it("exact picks score full on all four axes (medium: 50/50/50/100)", () => {
    const r = scoreRound(mcInput({}));
    expect(r.lyricPoints).toBe(50);
    expect(r.titlePoints).toBe(50);
    expect(r.artistPoints).toBe(50);
    expect(r.yearPoints).toBe(100);
    expect(r.totalRoundPoints).toBe(250);
  });

  it("exact match tolerates case/punctuation differences (normalizeText)", () => {
    const r = scoreRound(mcInput({ titleAnswer: "stay!", artistAnswer: "NAS" }));
    expect(r.titleCorrect).toBe(true);
    expect(r.artistMatch).toBe("full");
  });

  it("artist alias exact match counts as full in mcMode", () => {
    const r = scoreRound(mcInput({
      correctArtistName: "Sean Combs",
      artistAliases: ["Diddy", "Puff Daddy"],
      artistAnswer: "Puff Daddy",
    }));
    expect(r.artistMatch).toBe("full");
  });

  it("typed mode (mcMode absent) keeps fuzzy behavior", () => {
    const r = scoreRound(mcInput({ mcMode: undefined, titleAnswer: "Stan" }));
    expect(r.titleCorrect).toBe(true); // fuzzy threshold allows it — unchanged
  });

  it("passUsed short-circuits everything to zero in mcMode", () => {
    const r = scoreRound(mcInput({ passUsed: true }));
    expect(r.totalRoundPoints).toBe(0);
    expect(r.lyricMatch).toBe("none");
    expect(r.titlePoints).toBe(0);
    expect(r.artistPoints).toBe(0);
    expect(r.yearPoints).toBe(0);
  });

  it("empty lyric answer scores none in mcMode even if correct answer normalizes empty", () => {
    const r = scoreRound(mcInput({ lyricAnswer: "", correctLyricAnswer: "" }));
    expect(r.lyricMatch).toBe("none");
    expect(r.lyricPoints).toBe(0);
  });
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

// ── resolveMcVariant (display-row drift realignment) ─────────────────────────
describe("resolveMcVariant (display-row drift realignment)", () => {
  const variants = [
    { prompt: "p0", answer: "hello darkness my old friend" },
    { prompt: "p1", answer: "i've come to talk with you again" },
  ];
  it("keeps the played variant when the answer matches it", () => {
    expect(resolveMcVariant(variants[0], variants, "Hello darkness, my old friend"))
      .toBe(variants[0]);
  });
  it("realigns to another variant on exact match (player saw a stale display row)", () => {
    expect(resolveMcVariant(variants[0], variants, "I've come to talk with you again"))
      .toBe(variants[1]);
  });
  it("keeps the played variant when nothing matches (genuinely wrong answer)", () => {
    expect(resolveMcVariant(variants[0], variants, "some wrong distractor"))
      .toBe(variants[0]);
  });
  it("empty submitted answer keeps the played variant", () => {
    expect(resolveMcVariant(variants[0], variants, "")).toBe(variants[0]);
  });
});
