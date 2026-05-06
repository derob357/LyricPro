// scripts/_lib/verify-variant.mjs
// Shared variant-verification logic extracted from verify-lyrics.mjs.
//
// Public API:
//   normalize(s)
//     → lowercase, fold smart quotes, strip non-[a-z0-9'\s], collapse spaces.
//
//   verifyVariant(needle, canonicalLyrics)
//     → { ok: boolean,
//         matchType: "exact" | "fuzzy" | null,
//         editRate: number | null }
//
// Both `needle` and `canonicalLyrics` are passed in raw (un-normalized) — the
// helper normalizes them internally. Threshold matches the audit: ≤10% edit
// rate (CER) on a sliding window.
//
// Pure functions, no I/O. Safe to call from any context.

const FUZZY_MAX_ERROR_RATE = 0.1; // ≤10% CER → fuzzy PASS

export function normalize(s) {
  return String(s ?? "")
    .toLowerCase()
    .replace(/[‘’“”]/g, "'") // smart quotes → straight
    .replace(/[^a-z0-9'\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

// Iterative DP Levenshtein, two-row memory.
function levenshtein(a, b) {
  const m = a.length;
  const n = b.length;
  if (m === 0) return n;
  if (n === 0) return m;
  let prev = new Array(n + 1);
  let curr = new Array(n + 1);
  for (let j = 0; j <= n; j++) prev[j] = j;
  for (let i = 1; i <= m; i++) {
    curr[0] = i;
    const ai = a.charCodeAt(i - 1);
    for (let j = 1; j <= n; j++) {
      const cost = ai === b.charCodeAt(j - 1) ? 0 : 1;
      const del = prev[j] + 1;
      const ins = curr[j - 1] + 1;
      const sub = prev[j - 1] + cost;
      curr[j] = del < ins ? (del < sub ? del : sub) : ins < sub ? ins : sub;
    }
    [prev, curr] = [curr, prev];
  }
  return prev[n];
}

// Slide a window of needle.length across haystack, find min Levenshtein.
function minWindowLevenshtein(needle, haystack) {
  const nLen = needle.length;
  const hLen = haystack.length;
  if (nLen === 0) {
    return { minDistance: 0, editRate: 0 };
  }
  if (hLen <= nLen) {
    const d = levenshtein(needle, haystack);
    return { minDistance: d, editRate: d / nLen };
  }
  let best = Infinity;
  for (let i = 0; i + nLen <= hLen; i++) {
    const window = haystack.slice(i, i + nLen);
    const d = levenshtein(needle, window);
    if (d < best) {
      best = d;
      if (best === 0) break;
    }
  }
  return { minDistance: best, editRate: best / nLen };
}

// Verify a needle (typically `prompt + " " + answer`) against canonical
// lyrics. Returns ok=true iff the normalized needle is either a substring
// (exact) or within ≤10% CER (fuzzy) of normalized canonical.
export function verifyVariant(needle, canonicalLyrics) {
  const normNeedle = normalize(needle);
  const normHay = normalize(canonicalLyrics);

  if (normNeedle.length === 0) {
    return { ok: false, matchType: null, editRate: null };
  }

  if (normHay.includes(normNeedle)) {
    return { ok: true, matchType: "exact", editRate: 0 };
  }

  const { editRate } = minWindowLevenshtein(normNeedle, normHay);
  if (editRate <= FUZZY_MAX_ERROR_RATE) {
    return {
      ok: true,
      matchType: "fuzzy",
      editRate: Number(editRate.toFixed(4)),
    };
  }
  return {
    ok: false,
    matchType: null,
    editRate: Number(editRate.toFixed(4)),
  };
}
