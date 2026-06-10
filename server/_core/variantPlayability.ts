// Variant playability filter for the game router.
//
// Extracted verbatim from the inline helpers `isVariantPlayable` +
// `playableVariantIndicesFrom` that previously lived in
// `server/routers/game.ts` (~87-114).
//
// Rules (MUST NOT change without a broader gameplay audit):
//   1. Empty prompt → never playable (at any difficulty).
//   2. Untagged variant (no `difficulty` field) → legacy heuristic:
//      - medium: prompt + answer combined must be ≥ 6 words.
//      - low/high: length-agnostic; any non-empty prompt is fine.
//        (Low serves short iconic hooks; High is about depth, not length.)
//   3. Tagged variant (has a `difficulty` field):
//      - Only playable when variant.difficulty === requested difficulty.
//      - Rule 1 (empty prompt) still applies first.
//   4. Empty-set fallback: if the filter would return no indexes, return
//      ALL indexes instead so a mis-tagged song never becomes unplayable.

import type { Variant } from "./variantReader";
import type { Difficulty } from "./scoring";

/**
 * Returns the subset of `variants` that are playable at the given
 * `difficulty`.  Indexes refer to positions in the original `variants`
 * array — callers that store a `variantIndex` (e.g. `song_displays`) depend
 * on these being stable original positions.
 */
export function playableVariantIndexes(
  variants: Variant[],
  difficulty: Difficulty,
): number[] {
  const out: number[] = [];
  for (let i = 0; i < variants.length; i++) {
    if (isVariantPlayable(variants[i], difficulty)) out.push(i);
  }
  // Empty-set fallback: never brick a song due to an aggressive tag or a
  // corner-case where every variant is excluded.
  if (out.length === 0) {
    return variants.map((_, i) => i);
  }
  return out;
}

// ── Internal helpers (verbatim logic from game.ts ~92-114) ───────────────────

function isVariantPlayable(v: Variant, difficulty: Difficulty): boolean {
  const prompt = String(v?.prompt ?? "").trim();
  const answer = String(v?.answer ?? "").trim();
  // Rule 1: hollow prompt is never playable.
  if (!prompt) return false;

  // Rule 3: if the variant carries an explicit difficulty tag, it is only
  // playable when that tag matches the requested difficulty.
  if (v.difficulty !== undefined) {
    return v.difficulty === difficulty;
  }

  // Rule 2: untagged — legacy heuristic.
  if (difficulty !== "medium") return true;
  const lineWords = (prompt + " " + answer).trim().split(/\s+/).filter(Boolean).length;
  return lineWords >= 6;
}
