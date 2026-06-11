import { describe, it, expect } from "vitest";
import { availableDecades } from "./decadeFilter";

const ALL = [
  "1940–1950",
  "1950–1960",
  "1960–1970",
  "1970–1980",
  "1980–1990",
  "1990–2000",
  "2000–2010",
  "2010–2020",
  "2020–Present",
];

describe("availableDecades", () => {
  it("returns allDecades when counts is undefined (loading passthrough)", () => {
    expect(availableDecades(undefined, ["Pop"], ALL)).toEqual(ALL);
  });

  it("returns allDecades when selectedGenres is empty", () => {
    const counts = { Pop: { "1990–2000": 10 } };
    expect(availableDecades(counts, [], ALL)).toEqual(ALL);
  });

  it("qualifies a decade when the sum across selected genres meets minSongs", () => {
    const counts = {
      Pop: { "1990–2000": 3 },
      Rock: { "1990–2000": 2 },
    };
    // 3 + 2 = 5 exactly — should qualify
    const result = availableDecades(counts, ["Pop", "Rock"], ALL);
    expect(result).toContain("1990–2000");
  });

  it("hides a decade when the sum across selected genres is below minSongs while another decade qualifies", () => {
    const counts = {
      Pop: {
        "1990–2000": 2,  // 2 < 5 — should be hidden
        "2000–2010": 10, // 10 ≥ 5 — qualifies, so no fallback kicks in
      },
      Rock: { "1990–2000": 1 },
    };
    // 2+1=3 < 5 for 1990–2000, but 2000–2010 has 10 so qualified list is non-empty
    // → no ≥1 fallback, so 1990–2000 stays hidden
    const result = availableDecades(counts, ["Pop", "Rock"], ALL);
    expect(result).not.toContain("1990–2000");
    expect(result).toContain("2000–2010");
  });

  it("only sums the selected genres (ignores other genres in counts)", () => {
    const counts = {
      Pop: {
        "1980–1990": 2,  // 2 < 5 for Pop alone
        "2000–2010": 10, // gives us a qualifying decade so no fallback
      },
      Rock: { "1980–1990": 10 }, // 10 songs — but Rock is not selected
    };
    const result = availableDecades(counts, ["Pop"], ALL);
    // Pop alone contributes only 2 < 5 for 1980–1990
    expect(result).not.toContain("1980–1990");
    // 2000–2010 qualifies for Pop alone
    expect(result).toContain("2000–2010");
  });

  it("qualifies all decades when 'Mixed' is in selectedGenres (sums every genre)", () => {
    const counts = {
      Pop: { "1990–2000": 3 },
      Rock: { "1990–2000": 2 },
      // 1980–1990 has only 1 total across all genres
      Jazz: { "1980–1990": 1 },
    };
    // Mixed → treat as all genres
    const result = availableDecades(counts, ["Mixed"], ALL);
    // 1990–2000: 3+2 = 5 qualifies; 1980–1990: 1 < 5 but ≥1 → falls through to ≥1-song fallback
    expect(result).toContain("1990–2000");
  });

  it("uses custom minSongs threshold", () => {
    const counts = {
      Pop: {
        "2000–2010": 3,  // 3 songs
        "2010–2020": 10, // ensures qualified list is non-empty so no fallback at minSongs=4
      },
    };
    // With minSongs=3, exactly 3 should qualify
    expect(availableDecades(counts, ["Pop"], ALL, 3)).toContain("2000–2010");
    // With minSongs=4, 3 < 4 so 2000–2010 is excluded; 2010–2020 still qualifies → no fallback
    expect(availableDecades(counts, ["Pop"], ALL, 4)).not.toContain("2000–2010");
    expect(availableDecades(counts, ["Pop"], ALL, 4)).toContain("2010–2020");
  });

  it("falls back to decades with ≥1 song when none meet minSongs", () => {
    const counts = {
      Pop: { "1990–2000": 2, "2000–2010": 1 },
    };
    // Both below minSongs=5 → fallback: return any decade with ≥1 song
    const result = availableDecades(counts, ["Pop"], ALL);
    expect(result).toContain("1990–2000");
    expect(result).toContain("2000–2010");
    // A decade with 0 songs should still be excluded in the ≥1 fallback
    expect(result).not.toContain("1940–1950");
  });

  it("returns allDecades as last resort when even the ≥1 fallback is empty", () => {
    // Counts exist but no songs at all for any decade
    const counts = { Pop: {} };
    const result = availableDecades(counts, ["Pop"], ALL);
    expect(result).toEqual(ALL);
  });

  it("treats a decade missing from the counts object as 0 songs", () => {
    const counts = {
      Pop: { "1990–2000": 10 },
    };
    const result = availableDecades(counts, ["Pop"], ALL);
    // 1940–1950 is not in counts → 0 songs → should not appear (except via fallback)
    // Since 1990–2000 has 10 ≥ 5, there's at least one qualifying decade → no fallback
    expect(result).not.toContain("1940–1950");
    expect(result).toContain("1990–2000");
  });
});
