// scripts/verify-lyrics.mjs
// Phase 1 — Lyric Verification Audit (READ-ONLY).
//
// Pulls every active+approved song's stored lyric variants and checks each
// variant's (prompt + answer) against canonical lyrics fetched from external
// sources, in this order: LRClib (primary), Musixmatch (partial-coverage
// fallback), Genius (HTML-scrape fallback). First success wins; if all three
// miss, the song is NO_SOURCE.
//
// Lyric-source chain + verify logic live in scripts/_lib/* and are shared
// with scripts/regenerate-failing-variants.mjs.
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

import { fetchCanonicalLyrics } from "./_lib/lyrics-sources.mjs";
import { normalize, verifyVariant } from "./_lib/verify-variant.mjs";

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

const SONG_CONCURRENCY = 5;
const SONG_DISPATCH_GAP_MS = 100;

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

// ─── Verification adapter ─────────────────────────────────────────────────────
// Wraps the shared verifyVariant so we keep the legacy report shape:
//   { outcome: "PASS"|"FAIL_NOT_FOUND", matchType, editRate, needleLength }
function verifyVariantRecord(variant, canonicalLyrics) {
  const needleRaw = `${variant.prompt ?? ""} ${variant.answer ?? ""}`.trim();
  const needle = normalize(needleRaw);
  const needleLength = needle.length;
  const r = verifyVariant(needleRaw, canonicalLyrics);
  return {
    outcome: r.ok ? "PASS" : "FAIL_NOT_FOUND",
    matchType: r.matchType,
    editRate: r.editRate,
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

  const fetched = await fetchCanonicalLyrics({
    title: song.title,
    artist: song.artistName,
    musixmatchKey: MUSIXMATCH_API_KEY,
    geniusToken: GENIUS_ACCESS_TOKEN,
  });

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

  const variantResults = variants.map((v, i) => {
    const r = verifyVariantRecord(v, fetched.lyrics);
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

  console.log("");
  console.log("═".repeat(60));
  console.log("FINAL REPORT");
  console.log("═".repeat(60));
  console.log(`songs examined:    ${totals.songsExamined}`);
  console.log(`  PASS:            ${totals.songsPass}`);
  console.log(`  HAS_FAILS:       ${totals.songsHasFails}`);
  console.log(`  NO_SOURCE:       ${totals.songsNoSource}`);
  console.log(`variants examined: ${totals.variantsExamined}`);
  console.log(`  PASS:            ${totals.variantsPass}`);
  console.log(`  FAIL:            ${totals.variantsFail}`);
  console.log(`  NO_SOURCE_SKIPPED: ${totals.variantsNoSourceSkipped}`);
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
