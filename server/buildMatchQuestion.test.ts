import { describe, it, expect } from "vitest";
import { buildMatchQuestion, type MatchQuestion } from "./_core/buildMatchQuestion";
import type { Variant } from "./_core/variantReader";
import type { SongRow } from "./_core/songSelection";

// ---------------------------------------------------------------------------
// Minimal fixture helpers
// ---------------------------------------------------------------------------

function makeSong(overrides: Partial<SongRow> = {}): SongRow {
  return {
    id: 1,
    title: "Correct Title",
    artistName: "Correct Artist",
    releaseYear: 1990,
    lyricPrompt: "and I ran",
    lyricAnswer: "I ran so far away",
    genre: "Pop",
    decadeRange: "1990s",
    difficulty: "medium",
    isActive: true,
    approvalStatus: "approved",
    lyricSectionType: "chorus",
    explicitFlag: false,
    displayCount: 0,
    lastShownAt: null,
    artistMetadataId: null,
    lyricVariants: null,
    distractors: null,
    customPackSongIds: null,
    gamePrefs: null,
    // These fields exist on the full SongRow but we need only the above for
    // buildMatchQuestion. Add remaining required columns as nulls/defaults:
    ...overrides,
  } as unknown as SongRow;
}

function makeVariant(overrides: Partial<Variant> = {}): Variant {
  return {
    prompt: "I ran all night and day",
    answer: "I ran so far away",
    distractors: ["couldn't get away", "had nowhere to stay", "just had to play"],
    sectionType: "chorus",
    ...overrides,
  };
}

function makePool(count = 6): SongRow[] {
  return Array.from({ length: count }, (_, i) =>
    makeSong({
      id: 100 + i,
      title: `Distractor Title ${i}`,
      artistName: `Distractor Artist ${i}`,
      releaseYear: 1985 + i,
      lyricAnswer: `distractor answer ${i}`,
    }),
  );
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("buildMatchQuestion", () => {
  const song = makeSong();
  const variant = makeVariant();
  const candidateSongs: SongRow[] = [song, ...makePool()];

  let q: MatchQuestion;

  it("returns a question without throwing", () => {
    q = buildMatchQuestion({ song, variant, candidateSongs, difficulty: "medium" });
    expect(q).toBeDefined();
  });

  it("includes songId and promptLyric", () => {
    const result = buildMatchQuestion({ song, variant, candidateSongs, difficulty: "medium" });
    expect(result.songId).toBe(song.id);
    expect(result.promptLyric).toBe(variant.prompt);
  });

  it("titleOptions has exactly 4 entries and includes the correct title", () => {
    const result = buildMatchQuestion({ song, variant, candidateSongs, difficulty: "medium" });
    expect(result.titleOptions).toHaveLength(4);
    expect(result.titleOptions).toContain(song.title);
  });

  it("artistOptions has exactly 4 entries and includes the correct artist", () => {
    const result = buildMatchQuestion({ song, variant, candidateSongs, difficulty: "medium" });
    expect(result.artistOptions).toHaveLength(4);
    expect(result.artistOptions).toContain(song.artistName);
  });

  it("yearOptions has exactly 4 entries and includes the correct year", () => {
    const result = buildMatchQuestion({ song, variant, candidateSongs, difficulty: "medium" });
    expect(result.yearOptions).toHaveLength(4);
    expect(result.yearOptions).toContain(song.releaseYear);
  });

  it("lyricOptions has exactly 4 entries and includes the correct answer", () => {
    const result = buildMatchQuestion({ song, variant, candidateSongs, difficulty: "medium" });
    expect(result.lyricOptions).toHaveLength(4);
    expect(result.lyricOptions).toContain(variant.answer);
  });

  it("carries no isCorrect / correct / answer field that flags the right option", () => {
    const result = buildMatchQuestion({ song, variant, candidateSongs, difficulty: "medium" });
    // Flat keys — none should be named isCorrect, correct, or answer
    const keys = Object.keys(result);
    expect(keys).not.toContain("isCorrect");
    expect(keys).not.toContain("correct");
    expect(keys).not.toContain("answer");
    // Option arrays must be plain string/number arrays — not objects with flags
    for (const opt of result.titleOptions) {
      expect(typeof opt).toBe("string");
    }
    for (const opt of result.artistOptions) {
      expect(typeof opt).toBe("string");
    }
    for (const opt of result.yearOptions) {
      expect(typeof opt).toBe("number");
    }
    for (const opt of result.lyricOptions) {
      expect(typeof opt).toBe("string");
    }
  });

  it("option arrays have no duplicates", () => {
    const result = buildMatchQuestion({ song, variant, candidateSongs, difficulty: "medium" });
    expect(new Set(result.titleOptions).size).toBe(result.titleOptions.length);
    expect(new Set(result.artistOptions).size).toBe(result.artistOptions.length);
    expect(new Set(result.yearOptions).size).toBe(result.yearOptions.length);
    // lyricOptions dedup is case-insensitive; check exact strings are unique
    expect(new Set(result.lyricOptions).size).toBe(result.lyricOptions.length);
  });

  it("works with high difficulty", () => {
    const result = buildMatchQuestion({ song, variant, candidateSongs, difficulty: "high" });
    expect(result.difficulty).toBe("high");
    expect(result.lyricOptions).toContain(variant.answer);
  });

  it("works with low difficulty", () => {
    const result = buildMatchQuestion({ song, variant, candidateSongs, difficulty: "low" });
    expect(result.difficulty).toBe("low");
    expect(result.titleOptions).toContain(song.title);
  });

  it("uses stored variant distractors for lyricOptions when available", () => {
    const result = buildMatchQuestion({ song, variant, candidateSongs, difficulty: "high" });
    // variant has 3 stored distractors — all 3 should appear in lyricOptions
    for (const d of variant.distractors) {
      expect(result.lyricOptions).toContain(d);
    }
    // And the correct answer should also be present
    expect(result.lyricOptions).toContain(variant.answer);
  });

  it("falls back to pool distractors when variant has fewer than 3 stored", () => {
    const sparseVariant = makeVariant({ distractors: ["only one distractor"] });
    const result = buildMatchQuestion({
      song,
      variant: sparseVariant,
      candidateSongs,
      difficulty: "high",
    });
    // Should still produce 4 lyric options
    expect(result.lyricOptions).toHaveLength(4);
    expect(result.lyricOptions).toContain(sparseVariant.answer);
  });
});
