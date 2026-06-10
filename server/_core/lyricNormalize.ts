/** Content-PRESERVING lyric normalization for admin input + cleanup.
 *  Unlike scoring.normalizeText (which strips everything for matching),
 *  this keeps case, accents, and meaningful punctuation -- it only fixes
 *  artifacts: curly quotes, zero-width/control chars, whitespace runs,
 *  decomposed unicode. */

const QUOTE_MAP: Record<string, string> = {
  "‘": "'", "’": "'", "‚": "'", "‛": "'",
  "“": '"', "”": '"', "„": '"', "‟": '"',
  "′": "'", "″": '"',
};

export function normalizeLyricText(text: string): string {
  let t = text.normalize("NFC");
  t = t.replace(/[‘’‚‛“”„‟′″]/g, (c) => QUOTE_MAP[c] ?? c);
  // Delete zero-width/invisible chars so they don't produce spurious spaces between adjacent chars.
  // Replace other control chars with a space (they act as word breaks).
  t = t.replace(/[\u200B-\u200D\uFEFF]/g, "");
  t = t.replace(/[\u0000-\u001F\u007F]/g, " ");
  t = t.replace(/\s+/g, " ").trim();
  return t;
}

export interface LyricValidation { ok: boolean; issues: string[]; }

export function validateLyricFields(prompt: string, answer: string): LyricValidation {
  const p = normalizeLyricText(prompt);
  const a = normalizeLyricText(answer);
  const issues: string[] = [];
  if (!a) return { ok: false, issues: ["Lyric answer is empty after normalization."] };
  if (!p) issues.push("Lyric prompt is empty after normalization.");
  if (a.split(" ").length > Math.max(8, p.split(" ").length * 2)) {
    issues.push("Answer is much longer than the prompt -- check the split point.");
  }
  return { ok: !!p && !!a, issues };
}
