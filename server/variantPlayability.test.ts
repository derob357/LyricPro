import { describe, it, expect } from "vitest";
import { playableVariantIndexes } from "./_core/variantPlayability";

const v = (prompt: string, answer: string, difficulty?: "low" | "medium" | "high") =>
  ({ prompt, answer, distractors: [], sectionType: "chorus", ...(difficulty ? { difficulty } : {}) });

describe("playableVariantIndexes", () => {
  it("untagged variants keep the legacy heuristic (medium needs ≥6 combined words)", () => {
    const variants = [v("one two", "three"), v("one two three four", "five six")];
    expect(playableVariantIndexes(variants, "medium")).toEqual([1]);
    expect(playableVariantIndexes(variants, "low")).toEqual([0, 1]);
  });
  it("explicit tag wins: tagged variant playable only at its difficulty", () => {
    const variants = [v("a b c d e", "f g", "high"), v("a b c d e", "f g")];
    expect(playableVariantIndexes(variants, "high")).toEqual([0, 1]);
    expect(playableVariantIndexes(variants, "medium")).toEqual([1]); // tagged-high excluded
  });
  it("falls back to ALL variants when the filter empties the set (never brick a song)", () => {
    const variants = [v("a", "b", "high")];
    expect(playableVariantIndexes(variants, "low")).toEqual([0]);
  });
});
