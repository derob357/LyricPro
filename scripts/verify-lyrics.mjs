// scripts/verify-lyrics.mjs
// Phase 1 — Lyric Verification Audit (READ-ONLY).
//
// Pulls every active+approved song's stored lyric variants and checks each
// variant's (prompt + answer) against canonical lyrics fetched from external
// sources, in this order: LRClib (primary), Musixmatch (partial-coverage
// fallback), Genius (HTML-scrape fallback). First success wins; if all three
// miss, the song is NO_SOURCE.
//
// Verification:
//   - normalize(text) lowercases, fold smart quotes, strip non-[a-z0-9'\s], collapse spaces.
//   - PASS exact: normalized needle is substring of normalized canonical.
//   - PASS fuzzy: min sliding-window Levenshtein / needleLen ≤ 0.10 (≤10% CER).
//   - FAIL: otherwise.
//
// Output:
//   - scripts/verify-lyrics.report.json  (structured report; no canonical lyrics persisted)
//   - scripts/verify-lyrics.checkpoint.json  (per-song results; resumable)
//
// Usage:
//   node scripts/verify-lyrics.mjs                     # full run
//   node scripts/verify-lyrics.mjs --limit 5           # smoke
//   node scripts/verify-lyrics.mjs --reset             # wipe checkpoint, start fresh
//   node scripts/verify-lyrics.mjs --limit 5 --reset   # both
//
// No DB writes. No persisted canonical lyrics — those live in memory only.

import postgres from "postgres";
import dotenv from "dotenv";
import fs from "node:fs";
import path from "node:path";

dotenv.config();

// ─── Config ───────────────────────────────────────────────────────────────────
const DB_URL =
  process.env.SUPABASE_SESSION_POOLER_STRING ??
  process.env.SUPABASE_DIRECT_CONNECTION_STRING ??
  process.env.DATABASE_URL;
if (!DB_URL) {
  console.error("Set SUPABASE_SESSION_POOLER_STRING in .env");
  process.exit(1);
}

const MUSIXMATCH_API_KEY = process.env.MUSIXMATCH_API_KEY ?? "";
const GENIUS_ACCESS_TOKEN = process.env.GENIUS_ACCESS_TOKEN ?? "";

const CHECKPOINT_PATH = path.resolve("scripts/verify-lyrics.checkpoint.json");
const REPORT_PATH = path.resolve("scripts/verify-lyrics.report.json");

// Per-source semaphores. LRClib can comfortably handle 5 in flight; Musixmatch
// and Genius rate-limit harder so they get 1 in-flight + a 1s gap.
const SONG_CONCURRENCY = 5;
const LRCLIB_CONCURRENCY = 5;
const MUSIXMATCH_CONCURRENCY = 1;
const GENIUS_CONCURRENCY = 1;
const MUSIXMATCH_GAP_MS = 1000;
const GENIUS_GAP_MS = 1000;
const SONG_DISPATCH_GAP_MS = 100;

const FUZZY_MAX_ERROR_RATE = 0.1; // ≤10% CER → fuzzy PASS
const USER_AGENT =
  "LyricPro Ai/verify-lyrics 1.0 (deric@intentionai.ai)";

// ─── CLI args ─────────────────────────────────────────────────────────────────
const args = process.argv.slice(2);
function getFlag(name) {
  return args.includes(`--${name}`);
}
function getOpt(name) {
  const i = args.findIndex((a) => a === `--${name}`);
  if (i >= 0 && i + 1 < args.length) return args[i + 1];
  return null;
}
const RESET = getFlag("reset");
const LIMIT = parseInt(getOpt("limit") ?? "0", 10);

// ─── Tiny utils ───────────────────────────────────────────────────────────────
function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

// Per-source semaphore: only N tasks in flight at once. Optional minGapMs
// enforces a wait between *starts* (rate-limit-style).
function makeSemaphore(maxConcurrent, minGapMs = 0) {
  let active = 0;
  let lastStart = 0;
  const queue = [];
  function tryRun() {
    while (active < maxConcurrent && queue.length > 0) {
      const { fn, resolve, reject } = queue.shift();
      active += 1;
      const now = Date.now();
      const wait = Math.max(0, minGapMs - (now - lastStart));
      lastStart = now + wait;
      const start = wait === 0 ? Promise.resolve() : sleep(wait);
      start
        .then(fn)
        .then(resolve, reject)
        .finally(() => {
          active -= 1;
          tryRun();
        });
    }
  }
  return function acquire(fn) {
    return new Promise((resolve, reject) => {
      queue.push({ fn, resolve, reject });
      tryRun();
    });
  };
}

const lrclibSem = makeSemaphore(LRCLIB_CONCURRENCY);
const musixmatchSem = makeSemaphore(MUSIXMATCH_CONCURRENCY, MUSIXMATCH_GAP_MS);
const geniusSem = makeSemaphore(GENIUS_CONCURRENCY, GENIUS_GAP_MS);

// ─── Normalization + Levenshtein ──────────────────────────────────────────────
function normalize(s) {
  return String(s ?? "")
    .toLowerCase()
    .replace(/[‘’“”]/g, "'") // smart quotes → straight
    .replace(/[^a-z0-9'\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

// Iterative DP Levenshtein, two-row memory. Pure JS, no deps.
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
// Returns { minDistance, editRate }. If haystack < needle, returns
// straight Levenshtein on the whole thing.
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
  // Stride of 1 keeps the spec exact; cost is fine at this scale.
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

// ─── Fetchers ─────────────────────────────────────────────────────────────────

// LRClib — primary, free, no auth.
async function fetchLrclib(title, artist) {
  const url = `https://lrclib.net/api/get?artist_name=${encodeURIComponent(
    artist
  )}&track_name=${encodeURIComponent(title)}`;
  return lrclibSem(async () => {
    let res;
    try {
      res = await fetch(url, {
        headers: { "User-Agent": USER_AGENT, Accept: "application/json" },
      });
    } catch (err) {
      return { ok: false, reason: `network: ${String(err)}` };
    }
    if (res.status === 404) return { ok: false, reason: "404 not found" };
    if (!res.ok) return { ok: false, reason: `http ${res.status}` };
    let body;
    try {
      body = await res.json();
    } catch (err) {
      return { ok: false, reason: `parse: ${String(err)}` };
    }
    const lyrics = body?.plainLyrics;
    if (!lyrics || typeof lyrics !== "string" || lyrics.trim().length === 0) {
      return { ok: false, reason: "empty plainLyrics" };
    }
    return { ok: true, lyrics };
  });
}

// Musixmatch — fallback. Free tier returns ~30% with a copyright footer that
// must be stripped (the line of asterisks Musixmatch appends).
async function fetchMusixmatch(title, artist) {
  if (!MUSIXMATCH_API_KEY) return { ok: false, reason: "no api key" };
  const url = `https://api.musixmatch.com/ws/1.1/matcher.lyrics.get?q_track=${encodeURIComponent(
    title
  )}&q_artist=${encodeURIComponent(artist)}&apikey=${encodeURIComponent(
    MUSIXMATCH_API_KEY
  )}`;
  return musixmatchSem(async () => {
    let res;
    try {
      res = await fetch(url, {
        headers: { "User-Agent": USER_AGENT, Accept: "application/json" },
      });
    } catch (err) {
      return { ok: false, reason: `network: ${String(err)}` };
    }
    if (!res.ok) return { ok: false, reason: `http ${res.status}` };
    let body;
    try {
      body = await res.json();
    } catch (err) {
      return { ok: false, reason: `parse: ${String(err)}` };
    }
    const status = body?.message?.header?.status_code;
    if (status !== 200) return { ok: false, reason: `mm status ${status}` };
    const raw = body?.message?.body?.lyrics?.lyrics_body;
    if (!raw || typeof raw !== "string" || raw.trim().length === 0) {
      return { ok: false, reason: "empty lyrics_body" };
    }
    // Strip the "*******" footer Musixmatch appends to free-tier snippets.
    // The footer starts at the first line consisting of >= 5 asterisks.
    const idx = raw.search(/^\*{5,}/m);
    const lyrics = idx >= 0 ? raw.slice(0, idx).trim() : raw.trim();
    if (lyrics.length === 0) return { ok: false, reason: "all-footer" };
    return { ok: true, lyrics, partial: true };
  });
}

// Genius — fallback. Search API to find the path, then HTML scrape for
// `<div data-lyrics-container="true">…</div>` blocks. If GENIUS_ACCESS_TOKEN
// is empty we silently skip (per spec).
function fuzzyArtistMatch(a, b) {
  const norm = (s) =>
    String(s ?? "")
      .toLowerCase()
      .trim();
  const x = norm(a);
  const y = norm(b);
  if (!x || !y) return false;
  if (x === y || x.includes(y) || y.includes(x)) return true;
  const d = levenshtein(x, y);
  const maxLen = Math.max(x.length, y.length);
  return d / maxLen <= 0.2; // ≤20% Levenshtein, lowercased
}

// Strip HTML to plain text. Convert <br> and block-level tags to newlines,
// then drop remaining tags and decode the few entities Genius actually emits.
function htmlToText(html) {
  let s = String(html);
  // Block-level breaks → newline.
  s = s.replace(/<br\s*\/?>/gi, "\n");
  s = s.replace(/<\/(p|div|li|h[1-6])>/gi, "\n");
  // Drop everything else.
  s = s.replace(/<[^>]+>/g, "");
  // Decode common entities.
  s = s
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#039;/g, "'")
    .replace(/&apos;/g, "'")
    .replace(/&nbsp;/g, " ")
    .replace(/&#x27;/g, "'");
  return s;
}

async function fetchGenius(title, artist) {
  if (!GENIUS_ACCESS_TOKEN) return { ok: false, reason: "no api token" };
  const q = `${title} ${artist}`;
  return geniusSem(async () => {
    // 1. Search.
    let searchRes;
    try {
      searchRes = await fetch(
        `https://api.genius.com/search?q=${encodeURIComponent(q)}`,
        {
          headers: {
            Authorization: `Bearer ${GENIUS_ACCESS_TOKEN}`,
            "User-Agent": USER_AGENT,
            Accept: "application/json",
          },
        }
      );
    } catch (err) {
      return { ok: false, reason: `network search: ${String(err)}` };
    }
    if (!searchRes.ok) {
      return { ok: false, reason: `search http ${searchRes.status}` };
    }
    let searchBody;
    try {
      searchBody = await searchRes.json();
    } catch (err) {
      return { ok: false, reason: `parse search: ${String(err)}` };
    }
    const hits = searchBody?.response?.hits ?? [];
    if (hits.length === 0) return { ok: false, reason: "no hits" };

    // Pick top hit whose primary_artist fuzzy-matches our artist.
    const match = hits.find((h) =>
      fuzzyArtistMatch(h?.result?.primary_artist?.name, artist)
    );
    if (!match) return { ok: false, reason: "no artist-matched hit" };
    const songPath = match?.result?.path;
    if (!songPath) return { ok: false, reason: "hit missing path" };

    // 2. Fetch song page HTML and pull every data-lyrics-container block.
    let pageRes;
    try {
      pageRes = await fetch(`https://genius.com${songPath}`, {
        headers: {
          "User-Agent": USER_AGENT,
          Accept: "text/html,application/xhtml+xml",
        },
      });
    } catch (err) {
      return { ok: false, reason: `network page: ${String(err)}` };
    }
    if (!pageRes.ok) return { ok: false, reason: `page http ${pageRes.status}` };
    let html;
    try {
      html = await pageRes.text();
    } catch (err) {
      return { ok: false, reason: `read page: ${String(err)}` };
    }

    // /s flag = "dot matches newline" so the inner content can span lines.
    const blockRe =
      /<div[^>]*data-lyrics-container="true"[^>]*>([\s\S]*?)<\/div>/gi;
    const blocks = [];
    let m;
    while ((m = blockRe.exec(html)) !== null) {
      blocks.push(htmlToText(m[1]));
    }
    if (blocks.length === 0) {
      return { ok: false, reason: "no lyric blocks in HTML" };
    }
    const lyrics = blocks.join("\n").trim();
    if (lyrics.length === 0) return { ok: false, reason: "empty after strip" };
    return { ok: true, lyrics };
  });
}

// Try sources in order; return { source, lyrics } or { source: "none" }.
async function fetchCanonical(title, artist) {
  const lr = await fetchLrclib(title, artist);
  if (lr.ok) return { source: "lrclib", lyrics: lr.lyrics, partial: false };

  const mm = await fetchMusixmatch(title, artist);
  if (mm.ok)
    return { source: "musixmatch", lyrics: mm.lyrics, partial: !!mm.partial };

  const gn = await fetchGenius(title, artist);
  if (gn.ok) return { source: "genius", lyrics: gn.lyrics, partial: false };

  return {
    source: "none",
    lyrics: null,
    partial: false,
    reasons: { lrclib: lr.reason, musixmatch: mm.reason, genius: gn.reason },
  };
}

// ─── Verification ─────────────────────────────────────────────────────────────
function verifyVariant(variant, normalizedCanonical) {
  const needleRaw = `${variant.prompt ?? ""} ${variant.answer ?? ""}`.trim();
  const needle = normalize(needleRaw);
  const needleLength = needle.length;

  if (needleLength === 0) {
    return {
      outcome: "FAIL_NOT_FOUND",
      matchType: null,
      editRate: null,
      needleLength: 0,
    };
  }

  if (normalizedCanonical.includes(needle)) {
    return {
      outcome: "PASS",
      matchType: "exact",
      editRate: 0,
      needleLength,
    };
  }

  const { editRate } = minWindowLevenshtein(needle, normalizedCanonical);
  if (editRate <= FUZZY_MAX_ERROR_RATE) {
    return {
      outcome: "PASS",
      matchType: "fuzzy",
      editRate: Number(editRate.toFixed(4)),
      needleLength,
    };
  }
  return {
    outcome: "FAIL_NOT_FOUND",
    matchType: null,
    editRate: Number(editRate.toFixed(4)),
    needleLength,
  };
}

// ─── Checkpoint ───────────────────────────────────────────────────────────────
function loadCheckpoint() {
  if (!fs.existsSync(CHECKPOINT_PATH)) return { results: {} };
  try {
    return JSON.parse(fs.readFileSync(CHECKPOINT_PATH, "utf8"));
  } catch {
    return { results: {} };
  }
}
function saveCheckpoint(cp) {
  const tmp = `${CHECKPOINT_PATH}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(cp, null, 2));
  fs.renameSync(tmp, CHECKPOINT_PATH);
}

// ─── Per-song ─────────────────────────────────────────────────────────────────
async function processSong(song) {
  const variants = Array.isArray(song.lyricVariants) ? song.lyricVariants : [];
  // If song has no variants at all, treat as PASS-with-zero-variants. The
  // spec doesn't explicitly cover this but a song with 0 variants can't have
  // any FAILS, so it's PASS by definition. We still attempt to fetch lyrics
  // so sourceUsage stays accurate? — actually no: skip the network call to
  // keep the audit lean. Mark NO_SOURCE so it's flagged for follow-up.
  if (variants.length === 0) {
    return {
      songId: song.id,
      title: song.title,
      artistName: song.artistName,
      genre: song.genre,
      decadeRange: song.decadeRange,
      status: "NO_SOURCE",
      lyricsSource: "none",
      lyricsCharCount: 0,
      variants: [],
      _note: "no variants stored",
    };
  }

  const fetched = await fetchCanonical(song.title, song.artistName);

  if (fetched.source === "none") {
    return {
      songId: song.id,
      title: song.title,
      artistName: song.artistName,
      genre: song.genre,
      decadeRange: song.decadeRange,
      status: "NO_SOURCE",
      lyricsSource: "none",
      lyricsCharCount: 0,
      variants: variants.map((v, i) => ({
        index: i,
        prompt: v.prompt ?? "",
        answer: v.answer ?? "",
        sectionType: v.sectionType ?? null,
        outcome: "NO_SOURCE_SKIPPED",
        matchType: null,
        editRate: null,
        needleLength: normalize(`${v.prompt ?? ""} ${v.answer ?? ""}`).length,
      })),
      _missReasons: fetched.reasons,
    };
  }

  const normalizedCanonical = normalize(fetched.lyrics);
  const variantResults = variants.map((v, i) => {
    const r = verifyVariant(v, normalizedCanonical);
    return {
      index: i,
      prompt: v.prompt ?? "",
      answer: v.answer ?? "",
      sectionType: v.sectionType ?? null,
      ...r,
    };
  });
  const anyFail = variantResults.some((v) => v.outcome === "FAIL_NOT_FOUND");
  return {
    songId: song.id,
    title: song.title,
    artistName: song.artistName,
    genre: song.genre,
    decadeRange: song.decadeRange,
    status: anyFail ? "HAS_FAILS" : "PASS",
    lyricsSource: fetched.source,
    lyricsCharCount: fetched.lyrics.length,
    lyricsPartial: !!fetched.partial,
    variants: variantResults,
  };
}

// ─── Bucket aggregation ───────────────────────────────────────────────────────
function aggregateByKey(results, keyFn) {
  const map = new Map();
  for (const r of results) {
    const k = keyFn(r) ?? "(unknown)";
    if (!map.has(k)) {
      map.set(k, { key: k, songs: 0, pass: 0, hasFails: 0, noSource: 0 });
    }
    const b = map.get(k);
    b.songs += 1;
    if (r.status === "PASS") b.pass += 1;
    else if (r.status === "HAS_FAILS") b.hasFails += 1;
    else if (r.status === "NO_SOURCE") b.noSource += 1;
  }
  return [...map.values()].map((b) => ({
    ...b,
    passRate: b.songs > 0 ? Number((b.pass / b.songs).toFixed(4)) : 0,
  }));
}

// ─── Main ─────────────────────────────────────────────────────────────────────
async function main() {
  if (RESET && fs.existsSync(CHECKPOINT_PATH)) {
    fs.unlinkSync(CHECKPOINT_PATH);
    console.log(`[reset] removed ${CHECKPOINT_PATH}`);
  }

  const cp = loadCheckpoint();
  const sql = postgres(DB_URL, { max: 4 });

  const allSongs = await sql`
    SELECT id, title, "artistName", genre, "decadeRange", "lyricVariants"
    FROM songs
    WHERE "isActive" = true AND "approvalStatus" = 'approved'
    ORDER BY id ASC
  `;

  // Filter to those NOT yet in checkpoint.
  const todo = allSongs.filter((s) => !cp.results[s.id]);
  const slice = LIMIT > 0 ? todo.slice(0, LIMIT) : todo;

  console.log("─".repeat(60));
  console.log("verify-lyrics — Phase 1 audit (READ-ONLY)");
  console.log(`  total active+approved: ${allSongs.length}`);
  console.log(
    `  already in checkpoint: ${
      Object.keys(cp.results).length
    } (will be reused, not re-fetched)`
  );
  console.log(`  pending this run:      ${todo.length}`);
  console.log(
    `  processing this run:   ${slice.length}${
      LIMIT > 0 ? ` (--limit ${LIMIT})` : ""
    }`
  );
  console.log(`  song concurrency:      ${SONG_CONCURRENCY}`);
  console.log(`  musixmatch key:        ${MUSIXMATCH_API_KEY ? "set" : "unset"}`);
  console.log(`  genius token:          ${GENIUS_ACCESS_TOKEN ? "set" : "unset (skipping)"}`);
  console.log(`  checkpoint:            ${CHECKPOINT_PATH}`);
  console.log(`  report:                ${REPORT_PATH}`);
  console.log("─".repeat(60));

  // Pull-driven worker pool: SONG_CONCURRENCY workers each pull the next song
  // off `slice`. SONG_DISPATCH_GAP_MS is enforced as a min-gap between
  // *starts* (across all workers) — not a per-worker sleep.
  const total = slice.length;
  const startedAt = Date.now();
  let nextIdx = 0;
  let completed = 0;
  let lastDispatchAt = 0;

  async function nextSong() {
    if (nextIdx >= total) return null;
    const idx = nextIdx;
    nextIdx += 1;
    const wait = Math.max(0, SONG_DISPATCH_GAP_MS - (Date.now() - lastDispatchAt));
    if (wait > 0) await sleep(wait);
    lastDispatchAt = Date.now();
    return slice[idx];
  }

  async function worker() {
    for (;;) {
      const song = await nextSong();
      if (!song) return;
      try {
        const result = await processSong(song);
        cp.results[song.id] = result;
      } catch (err) {
        cp.results[song.id] = {
          songId: song.id,
          title: song.title,
          artistName: song.artistName,
          genre: song.genre,
          decadeRange: song.decadeRange,
          status: "NO_SOURCE",
          lyricsSource: "none",
          lyricsCharCount: 0,
          variants: [],
          _error: String(err),
        };
      }
      saveCheckpoint(cp);
      completed += 1;
      const r = cp.results[song.id];
      const elapsed = ((Date.now() - startedAt) / 1000).toFixed(1);
      const tag = `[${completed}/${total} ${elapsed}s]`;
      console.log(
        `  ${tag} "${r.title}" by ${r.artistName} — ${r.status} via ${r.lyricsSource}`
      );
    }
  }

  const workers = Array.from({ length: Math.min(SONG_CONCURRENCY, total) }, () =>
    worker()
  );
  await Promise.all(workers);

  await sql.end();

  // Build the report. We pull every result currently in the checkpoint —
  // that way `--limit` smoke runs produce a report of the smoke set, and
  // resumed full runs report on everything done so far.
  const allResults = Object.values(cp.results);

  const totals = {
    songsExamined: allResults.length,
    songsPass: 0,
    songsHasFails: 0,
    songsNoSource: 0,
    variantsExamined: 0,
    variantsPass: 0,
    variantsFail: 0,
    variantsNoSourceSkipped: 0,
    sourceUsage: { lrclib: 0, musixmatch: 0, genius: 0, none: 0 },
  };
  for (const r of allResults) {
    if (r.status === "PASS") totals.songsPass += 1;
    else if (r.status === "HAS_FAILS") totals.songsHasFails += 1;
    else totals.songsNoSource += 1;
    totals.sourceUsage[r.lyricsSource] =
      (totals.sourceUsage[r.lyricsSource] ?? 0) + 1;
    for (const v of r.variants ?? []) {
      totals.variantsExamined += 1;
      if (v.outcome === "PASS") totals.variantsPass += 1;
      else if (v.outcome === "FAIL_NOT_FOUND") totals.variantsFail += 1;
      else if (v.outcome === "NO_SOURCE_SKIPPED")
        totals.variantsNoSourceSkipped += 1;
    }
  }

  const byGenreRaw = aggregateByKey(allResults, (r) => r.genre);
  const byDecadeRaw = aggregateByKey(allResults, (r) => r.decadeRange);
  const byGenre = byGenreRaw
    .map((b) => ({
      genre: b.key,
      songs: b.songs,
      pass: b.pass,
      hasFails: b.hasFails,
      noSource: b.noSource,
      passRate: b.passRate,
    }))
    .sort((a, b) => a.genre.localeCompare(b.genre));
  const byDecade = byDecadeRaw
    .map((b) => ({
      decadeRange: b.key,
      songs: b.songs,
      pass: b.pass,
      hasFails: b.hasFails,
      noSource: b.noSource,
      passRate: b.passRate,
    }))
    .sort((a, b) => a.decadeRange.localeCompare(b.decadeRange));

  // Sort songs by id for stable output. Strip private "_*" debug fields and
  // trim memory-only payloads (no canonical lyrics — only the per-variant
  // outcomes the spec specifies).
  const songs = allResults
    .slice()
    .sort((a, b) => (a.songId ?? 0) - (b.songId ?? 0))
    .map((r) => ({
      songId: r.songId,
      title: r.title,
      artistName: r.artistName,
      genre: r.genre,
      decadeRange: r.decadeRange,
      status: r.status,
      lyricsSource: r.lyricsSource,
      lyricsCharCount: r.lyricsCharCount,
      ...(r.lyricsPartial ? { lyricsPartial: true } : {}),
      variants: r.variants ?? [],
    }));

  const report = {
    generatedAt: new Date().toISOString(),
    totals,
    byGenre,
    byDecade,
    songs,
  };

  fs.writeFileSync(REPORT_PATH, JSON.stringify(report, null, 2));

  // ─── stdout summary ─────────────────────────────────────────────────────────
  console.log("");
  console.log("═".repeat(60));
  console.log("FINAL REPORT");
  console.log("═".repeat(60));
  console.log(`songs examined:    ${totals.songsExamined}`);
  console.log(
    `  PASS:            ${totals.songsPass}`
  );
  console.log(
    `  HAS_FAILS:       ${totals.songsHasFails}`
  );
  console.log(
    `  NO_SOURCE:       ${totals.songsNoSource}`
  );
  console.log(`variants examined: ${totals.variantsExamined}`);
  console.log(`  PASS:            ${totals.variantsPass}`);
  console.log(`  FAIL:            ${totals.variantsFail}`);
  console.log(
    `  NO_SOURCE_SKIPPED: ${totals.variantsNoSourceSkipped}`
  );
  console.log(
    `source usage:      lrclib=${totals.sourceUsage.lrclib} musixmatch=${totals.sourceUsage.musixmatch} genius=${totals.sourceUsage.genius} none=${totals.sourceUsage.none}`
  );

  const hasFails = allResults.filter((r) => r.status === "HAS_FAILS");
  console.log("");
  console.log(`first ${Math.min(5, hasFails.length)} HAS_FAILS songs:`);
  for (const r of hasFails.slice(0, 5)) {
    const failingCount = r.variants.filter(
      (v) => v.outcome === "FAIL_NOT_FOUND"
    ).length;
    console.log(
      `  #${r.songId} "${r.title}" — ${r.artistName} (${failingCount} variant fail${failingCount === 1 ? "" : "s"}, source=${r.lyricsSource})`
    );
  }

  const noSource = allResults.filter((r) => r.status === "NO_SOURCE");
  console.log("");
  console.log(`first ${Math.min(5, noSource.length)} NO_SOURCE songs:`);
  for (const r of noSource.slice(0, 5)) {
    console.log(`  #${r.songId} "${r.title}" — ${r.artistName}`);
  }

  console.log("");
  console.log(`report written to: ${REPORT_PATH}`);
  console.log(`checkpoint at:     ${CHECKPOINT_PATH}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
