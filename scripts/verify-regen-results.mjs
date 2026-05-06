// scripts/verify-regen-results.mjs
// Phase 3 Followup — Independent Re-Verification of Regenerated Variants.
//
// READ-ONLY audit. Confirms the rescue results from
// scripts/regenerate-failing-variants.mjs by re-fetching canonical lyrics and
// re-verifying every variant currently in the DB for:
//   1. Songs the regen marked "kept-active" (rescued).
//   2. (Optional, default on) Songs that originally PASSED in verify-lyrics
//      — they shouldn't have been touched, so they should still verify.
//
// Surfaces:
//   - FALSE_RESCUE       : regen claimed kept-active but ≥1 variant fails now.
//   - REGRESSED_PASS     : a song that originally PASSED but now fails.
//   - NEWLY_NO_SOURCE    : source had lyrics during regen, gone now.
//
// Output:
//   scripts/verify-regen-results.report.json
//
// Usage:
//   node scripts/verify-regen-results.mjs                       # full audit
//   node scripts/verify-regen-results.mjs --limit 5             # smoke (rescued only)
//   node scripts/verify-regen-results.mjs --no-pass-spotcheck   # skip PASS spot-check
//   node scripts/verify-regen-results.mjs --regen-report PATH   # override regen report path (for fixtures)
//
// Idempotent. No checkpoint — just re-run for fresh state.

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
  console.error(
    "Set SUPABASE_SESSION_POOLER_STRING (or SUPABASE_DIRECT_CONNECTION_STRING / DATABASE_URL) in .env"
  );
  process.exit(1);
}

const MUSIXMATCH_API_KEY = process.env.MUSIXMATCH_API_KEY ?? "";
const GENIUS_ACCESS_TOKEN = process.env.GENIUS_ACCESS_TOKEN ?? "";

const DEFAULT_REGEN_REPORT_PATH = path.resolve(
  "scripts/regenerate-failing-variants.report.json"
);
const DEFAULT_VERIFY_REPORT_PATH = path.resolve(
  "scripts/verify-lyrics.report.json"
);
const RESULT_PATH = path.resolve("scripts/verify-regen-results.report.json");

const SONG_CONCURRENCY = 5;

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
const NO_PASS_SPOTCHECK = getFlag("no-pass-spotcheck");
const LIMIT_RAW = getOpt("limit");
const LIMIT = LIMIT_RAW != null ? parseInt(LIMIT_RAW, 10) : 0;
const REGEN_REPORT_PATH = path.resolve(
  getOpt("regen-report") ?? DEFAULT_REGEN_REPORT_PATH
);
const VERIFY_REPORT_PATH = path.resolve(
  getOpt("verify-report") ?? DEFAULT_VERIFY_REPORT_PATH
);

if (LIMIT_RAW != null && (!Number.isFinite(LIMIT) || LIMIT < 0)) {
  console.error(`--limit must be a non-negative integer (got: ${LIMIT_RAW})`);
  process.exit(1);
}

// ─── Report helpers ──────────────────────────────────────────────────────────
function readJsonOrExit(filePath, friendlyName, hint) {
  if (!fs.existsSync(filePath)) {
    console.error(`${friendlyName} not found: ${filePath}`);
    if (hint) console.error(hint);
    process.exit(2);
  }
  try {
    return JSON.parse(fs.readFileSync(filePath, "utf8"));
  } catch (err) {
    console.error(`Failed to parse ${filePath}: ${err.message}`);
    process.exit(2);
  }
}

// Phase 3 writes either "perSong" (real apply runs) or, in our mock fixtures,
// "songs". Accept both keys defensively.
function extractRescuedSongs(regenReport) {
  const list =
    (Array.isArray(regenReport.perSong) && regenReport.perSong) ||
    (Array.isArray(regenReport.songs) && regenReport.songs) ||
    [];
  return list.filter((s) => s && s.decision === "kept-active");
}

function extractPassSongs(verifyReport) {
  if (!verifyReport || !Array.isArray(verifyReport.songs)) return [];
  return verifyReport.songs.filter((s) => s && s.status === "PASS");
}

// ─── Per-song verification ───────────────────────────────────────────────────
async function verifyOneSong({ sql, songRef }) {
  // songRef: { songId, title, artistName, genre?, decadeRange?, lyricsSource? }
  const songId = songRef.songId;

  // SELECT only — read-only.
  const [row] = await sql`
    SELECT id, title, "artistName", genre, "decadeRange",
           "lyricVariants", "isActive"
    FROM songs
    WHERE id = ${songId}
    LIMIT 1
  `;

  if (!row) {
    return {
      songId,
      title: songRef.title ?? null,
      artistName: songRef.artistName ?? null,
      genre: songRef.genre ?? null,
      decadeRange: songRef.decadeRange ?? null,
      isActive: null,
      lyricsSource: "none",
      missingInDb: true,
      variantResults: [],
      anyFail: false,
      noSourceNow: false,
    };
  }

  const liveVariants = Array.isArray(row.lyricVariants) ? row.lyricVariants : [];

  // Empty array → nothing to verify; treat as "no variants" (not a fail).
  if (liveVariants.length === 0) {
    return {
      songId,
      title: row.title,
      artistName: row.artistName,
      genre: row.genre,
      decadeRange: row.decadeRange,
      isActive: row.isActive,
      lyricsSource: "none",
      missingInDb: false,
      variantResults: [],
      anyFail: false,
      noSourceNow: false,
      _note: "no variants on row",
    };
  }

  const fetched = await fetchCanonicalLyrics({
    title: row.title,
    artist: row.artistName,
    musixmatchKey: MUSIXMATCH_API_KEY,
    geniusToken: GENIUS_ACCESS_TOKEN,
  });

  if (fetched.source === "none" || !fetched.lyrics) {
    return {
      songId,
      title: row.title,
      artistName: row.artistName,
      genre: row.genre,
      decadeRange: row.decadeRange,
      isActive: row.isActive,
      lyricsSource: "none",
      missingInDb: false,
      variantResults: liveVariants.map((v, i) => ({
        index: i,
        prompt: v.prompt ?? "",
        answer: v.answer ?? "",
        sectionType: v.sectionType ?? null,
        outcome: "NO_SOURCE_SKIPPED",
        matchType: null,
        editRate: null,
      })),
      anyFail: false,
      noSourceNow: true,
      _missReasons: fetched.reasons ?? null,
    };
  }

  const variantResults = liveVariants.map((v, i) => {
    const needleRaw = `${v.prompt ?? ""} ${v.answer ?? ""}`.trim();
    const r = verifyVariant(needleRaw, fetched.lyrics);
    return {
      index: i,
      prompt: v.prompt ?? "",
      answer: v.answer ?? "",
      sectionType: v.sectionType ?? null,
      outcome: r.ok ? "PASS" : "FAIL",
      matchType: r.matchType,
      editRate: r.editRate,
    };
  });

  const anyFail = variantResults.some((v) => v.outcome === "FAIL");

  return {
    songId,
    title: row.title,
    artistName: row.artistName,
    genre: row.genre,
    decadeRange: row.decadeRange,
    isActive: row.isActive,
    lyricsSource: fetched.source,
    lyricsCharCount: fetched.lyrics.length,
    missingInDb: false,
    variantResults,
    anyFail,
    noSourceNow: false,
  };
}

// ─── Concurrency runner ──────────────────────────────────────────────────────
async function runWithConcurrency({ items, label, sql, onResult }) {
  const total = items.length;
  if (total === 0) return [];
  const startedAt = Date.now();
  let nextIdx = 0;
  let completed = 0;
  const results = [];

  async function nextItem() {
    if (nextIdx >= total) return null;
    return items[nextIdx++];
  }

  async function worker() {
    for (;;) {
      const songRef = await nextItem();
      if (!songRef) return;
      let result;
      try {
        result = await verifyOneSong({ sql, songRef });
      } catch (err) {
        result = {
          songId: songRef.songId,
          title: songRef.title ?? null,
          artistName: songRef.artistName ?? null,
          genre: songRef.genre ?? null,
          decadeRange: songRef.decadeRange ?? null,
          isActive: null,
          lyricsSource: "none",
          missingInDb: false,
          variantResults: [],
          anyFail: false,
          noSourceNow: false,
          _error: String(err?.message ?? err),
        };
      }
      results.push(result);
      onResult?.(result);
      completed += 1;
      const elapsed = ((Date.now() - startedAt) / 1000).toFixed(1);
      const tag = `[${label} ${completed}/${total} ${elapsed}s]`;
      const status = result.missingInDb
        ? "MISSING_IN_DB"
        : result.noSourceNow
          ? "NEWLY_NO_SOURCE"
          : result.anyFail
            ? "FAIL"
            : "PASS";
      console.log(
        `  ${tag} #${result.songId} "${result.title ?? "?"}" — ${status} via ${result.lyricsSource}`
      );
    }
  }

  const workers = Array.from(
    { length: Math.min(SONG_CONCURRENCY, total) },
    () => worker()
  );
  await Promise.all(workers);
  return results;
}

// ─── Bucket aggregation ──────────────────────────────────────────────────────
function aggregateByKey(records, keyFn) {
  const map = new Map();
  for (const r of records) {
    const k = keyFn(r) ?? "(unknown)";
    if (!map.has(k)) {
      map.set(k, {
        key: k,
        rescuedAudited: 0,
        passSpotChecked: 0,
        falseRescues: 0,
        regressedPasses: 0,
        newlyNoSource: 0,
      });
    }
    const b = map.get(k);
    if (r.bucket === "rescued") {
      b.rescuedAudited += 1;
      if (r.anyFail) b.falseRescues += 1;
    } else if (r.bucket === "pass") {
      b.passSpotChecked += 1;
      if (r.anyFail) b.regressedPasses += 1;
    }
    if (r.noSourceNow) b.newlyNoSource += 1;
  }
  return [...map.values()];
}

// ─── Main ────────────────────────────────────────────────────────────────────
async function main() {
  console.log("═".repeat(60));
  console.log("VERIFY REGEN RESULTS — Phase 3 Followup (READ-ONLY)");
  console.log("═".repeat(60));
  console.log(`mode:               READ-ONLY (SELECT only, no DB writes)`);
  console.log(`limit:              ${LIMIT > 0 ? LIMIT : "none"}`);
  console.log(`pass spot-check:    ${NO_PASS_SPOTCHECK ? "skipped" : "enabled"}`);
  console.log(`regen report:       ${REGEN_REPORT_PATH}`);
  console.log(`verify report:      ${VERIFY_REPORT_PATH}`);
  console.log(`result:             ${RESULT_PATH}`);
  console.log(`musixmatch key:     ${MUSIXMATCH_API_KEY ? "set" : "unset"}`);
  console.log(`genius token:       ${GENIUS_ACCESS_TOKEN ? "set" : "unset"}`);
  console.log(`song concurrency:   ${SONG_CONCURRENCY}`);
  console.log("");

  // ─── Inputs ────────────────────────────────────────────────────────────────
  if (!fs.existsSync(REGEN_REPORT_PATH)) {
    console.error(
      `Regen report not found: ${REGEN_REPORT_PATH}\n` +
        `Run Phase 3 first (scripts/regenerate-failing-variants.mjs --apply).\n` +
        `Or pass --regen-report <path> to point at an alternate file.`
    );
    process.exit(2);
  }
  const regenReport = readJsonOrExit(
    REGEN_REPORT_PATH,
    "Regen report",
    "Run Phase 3 first."
  );
  const rescuedAll = extractRescuedSongs(regenReport);
  let rescued = rescuedAll.slice();
  if (LIMIT > 0) rescued = rescued.slice(0, LIMIT);

  let passSongs = [];
  if (!NO_PASS_SPOTCHECK) {
    if (fs.existsSync(VERIFY_REPORT_PATH)) {
      const verifyReport = readJsonOrExit(
        VERIFY_REPORT_PATH,
        "Verify-lyrics report"
      );
      passSongs = extractPassSongs(verifyReport);
    } else {
      console.warn(
        `Note: ${VERIFY_REPORT_PATH} not found; skipping PASS spot-check.`
      );
    }
  }

  console.log(`rescued songs in regen report: ${rescuedAll.length}`);
  console.log(`rescued songs to audit:        ${rescued.length}${LIMIT > 0 ? ` (--limit ${LIMIT})` : ""}`);
  console.log(`pass songs to spot-check:      ${passSongs.length}${NO_PASS_SPOTCHECK ? " (skipped)" : ""}`);
  console.log("");

  if (rescued.length === 0 && passSongs.length === 0) {
    console.log("Nothing to audit. Exiting.");
    return;
  }

  // ─── DB connection ─────────────────────────────────────────────────────────
  const sql = postgres(DB_URL, { ssl: "require", max: 4 });

  let rescuedResults = [];
  let passResults = [];

  try {
    if (rescued.length > 0) {
      console.log(`auditing ${rescued.length} rescued song(s)…`);
      rescuedResults = await runWithConcurrency({
        items: rescued.map((s) => ({
          songId: s.songId,
          title: s.title,
          artistName: s.artistName,
          lyricsSource: s.lyricsSource ?? null,
        })),
        label: "RESCUED",
        sql,
      });
    }

    if (passSongs.length > 0) {
      console.log("");
      console.log(`spot-checking ${passSongs.length} originally-PASS song(s)…`);
      passResults = await runWithConcurrency({
        items: passSongs.map((s) => ({
          songId: s.songId,
          title: s.title,
          artistName: s.artistName,
          genre: s.genre,
          decadeRange: s.decadeRange,
          lyricsSource: s.lyricsSource ?? null,
        })),
        label: "PASS",
        sql,
      });
    }
  } finally {
    await sql.end({ timeout: 5 });
  }

  // ─── Tag bucket and roll up ────────────────────────────────────────────────
  for (const r of rescuedResults) r.bucket = "rescued";
  for (const r of passResults) r.bucket = "pass";

  // For rescued songs the regen report doesn't always carry genre/decade — pull
  // from the DB row we just SELECTed (already populated in result).
  // For PASS songs we have genre/decade from the original verify report; fall
  // back to DB row if missing.

  const falseRescues = rescuedResults.filter((r) => r.anyFail);
  const regressedPasses = passResults.filter((r) => r.anyFail);
  const newlyNoSource = [...rescuedResults, ...passResults].filter(
    (r) => r.noSourceNow
  );

  let variantsExamined = 0;
  let variantsPass = 0;
  let variantsFail = 0;
  let variantsNoSourceSkipped = 0;
  for (const r of [...rescuedResults, ...passResults]) {
    for (const v of r.variantResults ?? []) {
      variantsExamined += 1;
      if (v.outcome === "PASS") variantsPass += 1;
      else if (v.outcome === "FAIL") variantsFail += 1;
      else if (v.outcome === "NO_SOURCE_SKIPPED") variantsNoSourceSkipped += 1;
    }
  }

  const rescuedSongsAllVariantsPass = rescuedResults.filter(
    (r) => !r.anyFail && !r.noSourceNow && !r.missingInDb
  ).length;

  const totals = {
    rescuedSongsAudited: rescuedResults.length,
    passSongsSpotChecked: passResults.length,
    rescuedSongsAllVariantsPass,
    falseRescues: falseRescues.length,
    regressedPasses: regressedPasses.length,
    newlyNoSource: newlyNoSource.length,
    variantsExamined,
    variantsPass,
    variantsFail,
    variantsNoSourceSkipped,
  };

  // Bucketed aggregations.
  const allRecords = [...rescuedResults, ...passResults];
  const byGenre = aggregateByKey(allRecords, (r) => r.genre)
    .map((b) => ({
      genre: b.key,
      rescuedAudited: b.rescuedAudited,
      passSpotChecked: b.passSpotChecked,
      falseRescues: b.falseRescues,
      regressedPasses: b.regressedPasses,
      newlyNoSource: b.newlyNoSource,
    }))
    .sort((a, b) => String(a.genre).localeCompare(String(b.genre)));
  const byDecade = aggregateByKey(allRecords, (r) => r.decadeRange)
    .map((b) => ({
      decadeRange: b.key,
      rescuedAudited: b.rescuedAudited,
      passSpotChecked: b.passSpotChecked,
      falseRescues: b.falseRescues,
      regressedPasses: b.regressedPasses,
      newlyNoSource: b.newlyNoSource,
    }))
    .sort((a, b) => String(a.decadeRange).localeCompare(String(b.decadeRange)));

  // ─── Surface lists ─────────────────────────────────────────────────────────
  const falseRescuesOut = falseRescues.map((r) => ({
    songId: r.songId,
    title: r.title,
    artistName: r.artistName,
    genre: r.genre,
    decadeRange: r.decadeRange,
    lyricsSource: r.lyricsSource,
    failingVariants: (r.variantResults ?? [])
      .filter((v) => v.outcome === "FAIL")
      .map((v) => ({
        index: v.index,
        prompt: v.prompt,
        answer: v.answer,
        sectionType: v.sectionType,
        editRate: v.editRate,
      })),
  }));

  const regressedPassesOut = regressedPasses.map((r) => ({
    songId: r.songId,
    title: r.title,
    artistName: r.artistName,
    genre: r.genre,
    decadeRange: r.decadeRange,
    lyricsSource: r.lyricsSource,
    failingVariants: (r.variantResults ?? [])
      .filter((v) => v.outcome === "FAIL")
      .map((v) => ({
        index: v.index,
        prompt: v.prompt,
        answer: v.answer,
        sectionType: v.sectionType,
        editRate: v.editRate,
      })),
  }));

  const newlyNoSourceOut = newlyNoSource.map((r) => ({
    songId: r.songId,
    title: r.title,
    artistName: r.artistName,
    genre: r.genre,
    decadeRange: r.decadeRange,
    bucket: r.bucket,
    missReasons: r._missReasons ?? null,
  }));

  const finalReport = {
    generatedAt: new Date().toISOString(),
    inputs: {
      regenReport: path.relative(process.cwd(), REGEN_REPORT_PATH),
      originalVerifyReport: NO_PASS_SPOTCHECK
        ? null
        : path.relative(process.cwd(), VERIFY_REPORT_PATH),
    },
    flags: {
      limit: LIMIT > 0 ? LIMIT : null,
      noPassSpotcheck: NO_PASS_SPOTCHECK,
    },
    totals,
    byGenre,
    byDecade,
    falseRescues: falseRescuesOut,
    regressedPasses: regressedPassesOut,
    newlyNoSource: newlyNoSourceOut,
  };

  fs.writeFileSync(RESULT_PATH, JSON.stringify(finalReport, null, 2));

  // ─── stdout summary ────────────────────────────────────────────────────────
  console.log("");
  console.log("═".repeat(60));
  console.log("VERIFY REGEN RESULTS — SUMMARY");
  console.log("═".repeat(60));
  console.log(`rescued songs audited:           ${totals.rescuedSongsAudited}`);
  console.log(`pass songs spot-checked:         ${totals.passSongsSpotChecked}`);
  console.log(
    `rescued songs all variants pass: ${totals.rescuedSongsAllVariantsPass}`
  );
  console.log(`false rescues:                   ${totals.falseRescues}`);
  console.log(`regressed passes:                ${totals.regressedPasses}`);
  console.log(`newly no-source:                 ${totals.newlyNoSource}`);
  console.log(`variants examined:               ${totals.variantsExamined}`);
  console.log(`  variants PASS:                 ${totals.variantsPass}`);
  console.log(`  variants FAIL:                 ${totals.variantsFail}`);
  console.log(`  variants NO_SOURCE_SKIPPED:    ${totals.variantsNoSourceSkipped}`);
  console.log("");

  if (falseRescuesOut.length > 0) {
    console.log(`first ${Math.min(5, falseRescuesOut.length)} FALSE_RESCUES:`);
    for (const fr of falseRescuesOut.slice(0, 5)) {
      console.log(
        `  #${fr.songId} "${fr.title}" — ${fr.artistName} (${fr.failingVariants.length} fail, source=${fr.lyricsSource})`
      );
    }
    console.log("");
  }

  if (regressedPassesOut.length > 0) {
    console.log(
      `first ${Math.min(5, regressedPassesOut.length)} REGRESSED_PASSES:`
    );
    for (const rp of regressedPassesOut.slice(0, 5)) {
      console.log(
        `  #${rp.songId} "${rp.title}" — ${rp.artistName} (${rp.failingVariants.length} fail, source=${rp.lyricsSource})`
      );
    }
    console.log("");
  }

  console.log(`report written to: ${RESULT_PATH}`);
  console.log("");

  if (totals.falseRescues === 0 && totals.regressedPasses === 0) {
    console.log(
      "EXIT_GREEN: regen audit clean — all rescued songs verify against canonical lyrics."
    );
  } else {
    console.log(
      "EXIT_DIRTY: discrepancies found — review falseRescues / regressedPasses in the report."
    );
  }
}

main().catch((err) => {
  console.error("FATAL:", err);
  process.exit(1);
});
