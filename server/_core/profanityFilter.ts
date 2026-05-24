// Tier-1 profanity filter. Uses `obscenity` (regex + leetspeak handling)
// to make a binary block/flag decision per message body. Tier-2 (Claude
// Haiku escalation for ambiguous cases) is gated behind an env flag and
// lands in Phase 6 — not used here.
//
// Output contract:
//   - `status: "clean"` — pass; insert with flag_status='clean'
//   - `status: "flagged"` and `block: true` — reject the insert; user sees
//     "Message contains blocked language. Please revise."
//   - `status: "flagged"` and `block: false` — currently not produced by
//     Tier 1; reserved for future tuning that lets borderline content
//     through with flag_status='flagged'.

import {
  RegExpMatcher,
  englishDataset,
  englishRecommendedTransformers,
} from "obscenity";

const matcher = new RegExpMatcher({
  ...englishDataset.build(),
  ...englishRecommendedTransformers,
});

const ALLOWLIST = new Set<string>([
  // Music vocabulary that the default obscenity dictionary would otherwise flag.
  "hell", "hells", "damn", "damned", "killer",
]);

export interface ProfanityAssessment {
  status: "clean" | "flagged";
  reason: string | null;
  block: boolean;
}

export function assessProfanity(body: string): ProfanityAssessment {
  const trimmed = body.trim();
  if (trimmed.length === 0) {
    return { status: "clean", reason: null, block: false };
  }

  const matches = matcher.getAllMatches(trimmed);
  if (matches.length === 0) {
    return { status: "clean", reason: null, block: false };
  }

  // Filter out hits whose underlying word is in the allowlist.
  const meaningful = matches.filter((m) => {
    const metadata = englishDataset.getPayloadWithPhraseMetadata(m);
    const word = metadata.phraseMetadata?.originalWord ?? "";
    return !ALLOWLIST.has(word.toLowerCase());
  });

  if (meaningful.length === 0) {
    return { status: "clean", reason: null, block: false };
  }

  return {
    status: "flagged",
    reason: `matched: ${meaningful.length} term(s)`,
    block: true,
  };
}
