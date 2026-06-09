// server/_core/buildMatchQuestion.ts
// Builds the answer-free MC question payload for a match round. Mirrors the
// shape getNextSong returns to the client (lyricPrompt, lyricOptions,
// titleOptions, artistOptions, yearOptions), MINUS any correct-answer marker.
//
// Anti-cheat contract:
//   - The correct value is present in each option array as one entry among
//     distractors — that is intentional and required so the client can render
//     the multiple-choice UI.
//   - NO field in MatchQuestion carries a flag such as isCorrect, correct, or
//     answer that would reveal which option is the right one.
//   - lyricAnswer (the correct fill-in text) is NOT included.

import type { Variant } from "./variantReader";
import type { SongRow } from "./songSelection";

export interface MatchQuestion {
  songId: number;
  /** The lyric shown to the player (blanked on High difficulty). Mirrors
   *  `lyricPrompt` from getNextSong. */
  promptLyric: string;
  difficulty: "low" | "medium" | "high";
  /** 4 shuffled title strings. The correct title is among them, unlabelled. */
  titleOptions: string[];
  /** 4 shuffled artist-name strings. The correct artist is among them, unlabelled. */
  artistOptions: string[];
  /** 4 shuffled release-year numbers. The correct year is among them, unlabelled. */
  yearOptions: number[];
  /** 4 shuffled lyric-answer strings (fill-the-gap). The correct answer is
   *  among them, unlabelled. Only rendered at High difficulty. */
  lyricOptions: string[];
}

// ---------------------------------------------------------------------------
// Internal helpers (mirrors game.ts's local pickDistractors + shuffle)
// ---------------------------------------------------------------------------

function shuffle<T>(arr: T[]): T[] {
  return [...arr].sort(() => Math.random() - 0.5);
}

/**
 * Returns up to `n` distinct distractor strings from `pool`, excluding
 * the `correct` value (case-insensitive dedup).
 */
function pickDistractors(
  n: number,
  pool: SongRow[],
  keyOf: (s: SongRow) => string,
  correct: string,
): string[] {
  const shuffled = shuffle(pool);
  const out: string[] = [];
  const seen = new Set<string>([correct.toLowerCase()]);
  for (const s of shuffled) {
    const v = keyOf(s);
    if (!v) continue;
    if (seen.has(v.toLowerCase())) continue;
    seen.add(v.toLowerCase());
    out.push(v);
    if (out.length >= n) break;
  }
  return out;
}

// ---------------------------------------------------------------------------
// Public builder
// ---------------------------------------------------------------------------

export function buildMatchQuestion(args: {
  song: SongRow;
  /** The variant at index 0 for this song (all match players see the same
   *  variant — no per-player rotation in synchronized multiplayer). */
  variant: Variant;
  /** The full candidate pool returned by selectSongForRoom (used to build
   *  distractor options). Includes the picked song; it is excluded inside. */
  candidateSongs: SongRow[];
  difficulty: "low" | "medium" | "high";
}): MatchQuestion {
  const { song, variant, candidateSongs, difficulty } = args;

  // Distractor pool: same candidate pool minus the picked song itself.
  const distractorPool = candidateSongs.filter((s) => s.id !== song.id);

  // --- Title options --------------------------------------------------------
  const titleOptions = shuffle([
    song.title,
    ...pickDistractors(3, distractorPool, (s) => s.title, song.title),
  ]);

  // --- Artist options -------------------------------------------------------
  const artistOptions = shuffle([
    song.artistName,
    ...pickDistractors(3, distractorPool, (s) => s.artistName, song.artistName),
  ]);

  // --- Year options (mirrors game.ts year logic exactly) -------------------
  const yearOffsets = [2, 4, 6].map((d) =>
    song.releaseYear + (Math.random() > 0.5 ? d : -d),
  );
  const yearSet = new Set<number>([song.releaseYear, ...yearOffsets]);
  for (let tries = 0; tries < 12 && yearSet.size < 4; tries++) {
    yearSet.add(song.releaseYear + (Math.floor(Math.random() * 20) - 10));
  }
  let fallbackOffset = 7;
  while (yearSet.size < 4 && fallbackOffset < 40) {
    yearSet.add(song.releaseYear + fallbackOffset);
    fallbackOffset++;
  }
  const yearOptions = shuffle(Array.from(yearSet));

  // --- Lyric options (High difficulty fill-the-gap; mirrors game.ts) -------
  const variantAnswer = variant.answer;
  const answerNormalized = variantAnswer.toLowerCase().trim();
  const seenDistractors = new Set<string>([answerNormalized]);

  const stored = Array.isArray(variant.distractors)
    ? variant.distractors.filter((d): d is string => {
        if (typeof d !== "string") return false;
        const norm = d.toLowerCase().trim();
        if (norm.length === 0) return false;
        if (seenDistractors.has(norm)) return false;
        seenDistractors.add(norm);
        return true;
      })
    : [];

  const lyricDistractors =
    stored.length >= 3
      ? stored.slice(0, 3)
      : [
          ...stored,
          ...pickDistractors(
            3 - stored.length,
            distractorPool,
            (s) => s.lyricAnswer ?? "",
            variantAnswer,
          ),
        ];

  const lyricOptions = shuffle([variantAnswer, ...lyricDistractors]);

  // NOTE: promptLyric mirrors getNextSong's `lyricPrompt` field.
  // At High difficulty the client renders a fill-in-the-blank (the answer is
  // omitted from the prompt by design — this matches the solo game.ts path
  // where `pickedVariant.prompt` already has the blank structure). We pass the
  // variant's prompt directly; the blank presentation is handled client-side.
  return {
    songId: song.id,
    promptLyric: variant.prompt,
    difficulty,
    titleOptions,
    artistOptions,
    yearOptions,
    lyricOptions,
  };
}
