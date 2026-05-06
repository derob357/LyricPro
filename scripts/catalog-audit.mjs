// scripts/catalog-audit.mjs
// Phase 0 — Catalog Stocktake.
//
// Read-only audit. Cross-references the live `songs` table against two
// hand-curated reference workbooks (a 400-song low-difficulty bank and a
// hip-hop lyric-sets template) and writes scripts/catalog-audit.report.json.
//
// No DB writes. Idempotent. Re-running produces the same output.
//
// Usage:
//   node scripts/catalog-audit.mjs

import postgres from "postgres";
import dotenv from "dotenv";
import fs from "node:fs";
import path from "node:path";
import xlsx from "xlsx";

dotenv.config();

// ── DB connection ────────────────────────────────────────────────────────────
const DB_URL =
  process.env.SUPABASE_SESSION_POOLER_STRING ??
  process.env.SUPABASE_DIRECT_CONNECTION_STRING ??
  process.env.DATABASE_URL;
if (!DB_URL) {
  console.error("Set SUPABASE_SESSION_POOLER_STRING in .env");
  process.exit(1);
}

// ── Workbook paths ───────────────────────────────────────────────────────────
const BANK400_PATH =
  "/Users/drob/Documents/Lyric Pro/Lyric_Pro_Low_Difficulty_400_Song_Bank_Licensing_Safe.xlsx";
const HIPHOP_PATH =
  "/Users/drob/Documents/Lyric Pro/Lyric_Pro_HipHop_Lyric_Sets_Template.xlsx";
const REPORT_PATH = path.resolve("scripts/catalog-audit.report.json");

// ── Normalization ────────────────────────────────────────────────────────────
// Apply identically to DB rows and workbook rows. Goal: reliable counts via
// exact-match-after-normalize, not maximum recall. Punctuation is stripped
// EXCEPT apostrophes (so "rock 'n' roll" stays matchable).
function normalize(input) {
  if (input == null) return "";
  let s = String(input).toLowerCase().trim();

  // Strip trailing parenthetical features: "(feat. X)", "(featuring X)",
  // and any other trailing parens (e.g. "(Remix)", "(Live)") for stability.
  s = s.replace(/\s*\([^)]*\)\s*$/g, "").trim();

  // Strip trailing " feat. ..." / " featuring ..." / " ft. ..." that aren't
  // wrapped in parens (workbook uses "2Pac featuring Dr. Dre" plainly).
  s = s.replace(/\s+(feat\.?|ft\.?|featuring)\s+.*$/i, "").trim();

  // Strip leading "the ".
  if (s.startsWith("the ")) s = s.slice(4);

  // Normalize curly/typographic apostrophes to straight apostrophes so
  // smart-quote variants collide with ASCII variants.
  s = s.replace(/[‘’ʼ]/g, "'");

  // Strip punctuation, keeping word chars, whitespace, and apostrophes.
  // Both sides go through the same rule so word-internal vs. word-edge
  // apostrophes don't matter for matching.
  s = s.replace(/[^\w\s']/g, " ");

  // Collapse whitespace.
  s = s.replace(/\s+/g, " ").trim();
  return s;
}

function makeKey(title, artist) {
  return `${normalize(title)}|||${normalize(artist)}`;
}

// ── Workbook loaders ─────────────────────────────────────────────────────────
function loadBank400() {
  const wb = xlsx.readFile(BANK400_PATH);
  const sheet = wb.Sheets["Master Bank"];
  if (!sheet) throw new Error(`Master Bank sheet missing in ${BANK400_PATH}`);
  const rows = xlsx.utils.sheet_to_json(sheet, { header: 1, defval: null });
  // Header row 0; data rows 1..400.
  const out = [];
  for (let i = 1; i < rows.length; i++) {
    const r = rows[i];
    if (!r) continue;
    const [category, title, artist, year] = r;
    if (!title || !artist) continue;
    out.push({
      category: category ?? null,
      title: String(title),
      artist: String(artist),
      year: Number.isFinite(year) ? Number(year) : null,
    });
  }
  return out;
}

function loadHipHopTemplate() {
  const wb = xlsx.readFile(HIPHOP_PATH);
  const sheet = wb.Sheets["Hip Hop Lyric Sets"];
  if (!sheet) throw new Error(`Hip Hop Lyric Sets sheet missing in ${HIPHOP_PATH}`);
  const rows = xlsx.utils.sheet_to_json(sheet, { header: 1, defval: null });
  // Header row 3; data rows 4 onward.
  const out = [];
  for (let i = 4; i < rows.length; i++) {
    const r = rows[i];
    if (!r) continue;
    const [category, title, artist, year] = r;
    if (!title || !artist) continue;
    out.push({
      category: category ?? null,
      title: String(title),
      artist: String(artist),
      year: Number.isFinite(year) ? Number(year) : null,
    });
  }
  return out;
}

// ── Run ──────────────────────────────────────────────────────────────────────
const sql = postgres(DB_URL, { ssl: "require", max: 1 });

let report;
try {
  const bank400 = loadBank400();
  const hipHop = loadHipHopTemplate();

  const dbSongs = await sql`
    SELECT id, title, "artistName", genre, "releaseYear", "decadeRange"
    FROM songs
    WHERE "isActive" = true AND "approvalStatus" = 'approved'
  `;

  // Index workbooks by exact normalized key, plus a title-only index for
  // suggested-match (artist near-miss) detection.
  const bank400ByKey = new Map();
  const bank400ByTitle = new Map();
  for (const e of bank400) {
    const key = makeKey(e.title, e.artist);
    if (!bank400ByKey.has(key)) bank400ByKey.set(key, e);
    const tk = normalize(e.title);
    if (!bank400ByTitle.has(tk)) bank400ByTitle.set(tk, []);
    bank400ByTitle.get(tk).push(e);
  }
  const hipHopByKey = new Map();
  const hipHopByTitle = new Map();
  for (const e of hipHop) {
    const key = makeKey(e.title, e.artist);
    if (!hipHopByKey.has(key)) hipHopByKey.set(key, e);
    const tk = normalize(e.title);
    if (!hipHopByTitle.has(tk)) hipHopByTitle.set(tk, []);
    hipHopByTitle.get(tk).push(e);
  }

  // Tag each DB song with its match status against each bank.
  const dbHitsBank400 = new Set();   // workbook keys hit by DB
  const dbHitsHipHop = new Set();
  const dbInBank400 = [];            // db song ids matched
  const dbInHipHop = [];
  const dbInEither = new Set();
  const dbNotInAny = [];
  const suggested = [];

  for (const s of dbSongs) {
    const key = makeKey(s.title, s.artistName);
    const titleKey = normalize(s.title);
    const inBank = bank400ByKey.has(key);
    const inHip = hipHopByKey.has(key);
    if (inBank) {
      dbHitsBank400.add(key);
      dbInBank400.push(s);
    }
    if (inHip) {
      dbHitsHipHop.add(key);
      dbInHipHop.push(s);
    }
    if (inBank || inHip) {
      dbInEither.add(s.id);
    } else {
      dbNotInAny.push(s);
      // Title-match-artist-near-miss suggestions for human review.
      const bankTitleHits = bank400ByTitle.get(titleKey) ?? [];
      for (const cand of bankTitleHits) {
        suggested.push({
          dbSong: { id: s.id, title: s.title, artistName: s.artistName },
          bankCandidate: {
            title: cand.title,
            artist: cand.artist,
            source: "bank400",
          },
          reason: "title-match-artist-near-miss",
        });
      }
      const hipTitleHits = hipHopByTitle.get(titleKey) ?? [];
      for (const cand of hipTitleHits) {
        suggested.push({
          dbSong: { id: s.id, title: s.title, artistName: s.artistName },
          bankCandidate: {
            title: cand.title,
            artist: cand.artist,
            source: "hipHopTemplate",
          },
          reason: "title-match-artist-near-miss",
        });
      }
    }
  }

  // Workbook entries with no DB match.
  const bank400Missing = [];
  for (const e of bank400) {
    const key = makeKey(e.title, e.artist);
    if (!dbHitsBank400.has(key)) {
      bank400Missing.push({
        title: e.title,
        artist: e.artist,
        category: e.category,
        year: e.year,
      });
    }
  }
  const hipHopMissing = [];
  for (const e of hipHop) {
    const key = makeKey(e.title, e.artist);
    if (!dbHitsHipHop.has(key)) {
      hipHopMissing.push({
        title: e.title,
        artist: e.artist,
        category: e.category,
        year: e.year,
      });
    }
  }

  // Build the union of bank keys for the "matched in either" rollup.
  const bankUnionKeys = new Set([...bank400ByKey.keys(), ...hipHopByKey.keys()]);
  function dbInUnion(s) {
    return bankUnionKeys.has(makeKey(s.title, s.artistName));
  }

  // Group by genre.
  const byGenreMap = new Map();
  for (const s of dbSongs) {
    const g = s.genre ?? "(unknown)";
    if (!byGenreMap.has(g)) byGenreMap.set(g, { dbCount: 0, matchedInBank: 0 });
    const bucket = byGenreMap.get(g);
    bucket.dbCount += 1;
    if (dbInUnion(s)) bucket.matchedInBank += 1;
  }
  const byGenre = [...byGenreMap.entries()]
    .map(([genre, v]) => ({
      genre,
      dbCount: v.dbCount,
      matchedInBank: v.matchedInBank,
      matchRate: v.dbCount === 0 ? 0 : v.matchedInBank / v.dbCount,
    }))
    .sort((a, b) => b.dbCount - a.dbCount);

  // Group by decade.
  const byDecadeMap = new Map();
  for (const s of dbSongs) {
    const d = s.decadeRange ?? "(unknown)";
    if (!byDecadeMap.has(d)) byDecadeMap.set(d, { dbCount: 0, matchedInBank: 0 });
    const bucket = byDecadeMap.get(d);
    bucket.dbCount += 1;
    if (dbInUnion(s)) bucket.matchedInBank += 1;
  }
  const byDecade = [...byDecadeMap.entries()]
    .map(([decadeRange, v]) => ({
      decadeRange,
      dbCount: v.dbCount,
      matchedInBank: v.matchedInBank,
      matchRate: v.dbCount === 0 ? 0 : v.matchedInBank / v.dbCount,
    }))
    .sort((a, b) => a.decadeRange.localeCompare(b.decadeRange));

  report = {
    generatedAt: new Date().toISOString(),
    totals: {
      dbSongsActive: dbSongs.length,
      bank400Songs: bank400.length,
      hipHopTemplateSongs: hipHop.length,
      dbSongsInBank400: dbInBank400.length,
      dbSongsInHipHopTemplate: dbInHipHop.length,
      dbSongsInEitherBank: dbInEither.size,
      bank400SongsMissingFromDb: bank400Missing.length,
      hipHopTemplateSongsMissingFromDb: hipHopMissing.length,
    },
    byGenre,
    byDecade,
    bank400MissingFromDb: bank400Missing,
    hipHopTemplateMissingFromDb: hipHopMissing,
    dbSongsNotInAnyBank: dbNotInAny.map((s) => ({
      id: s.id,
      title: s.title,
      artistName: s.artistName,
      genre: s.genre,
      decadeRange: s.decadeRange,
    })),
    suggestedMatches: suggested,
  };

  fs.writeFileSync(REPORT_PATH, JSON.stringify(report, null, 2));
} finally {
  await sql.end({ timeout: 5 });
}

// ── Human-readable summary ───────────────────────────────────────────────────
const t = report.totals;
const lines = [];
lines.push("Catalog audit complete.");
lines.push(`  DB active+approved songs:           ${t.dbSongsActive}`);
lines.push(`  Bank-400 entries:                   ${t.bank400Songs}`);
lines.push(`  Hip-hop template entries:           ${t.hipHopTemplateSongs}`);
lines.push(`  DB songs in Bank-400:               ${t.dbSongsInBank400}`);
lines.push(`  DB songs in hip-hop template:       ${t.dbSongsInHipHopTemplate}`);
lines.push(`  DB songs in either bank:            ${t.dbSongsInEitherBank}`);
lines.push(`  Bank-400 missing from DB:           ${t.bank400SongsMissingFromDb}`);
lines.push(`  Hip-hop template missing from DB:   ${t.hipHopTemplateSongsMissingFromDb}`);
lines.push(`  Suggested (title-match) reviews:    ${report.suggestedMatches.length}`);
lines.push("");
lines.push("By genre (matched / total = rate):");
for (const g of report.byGenre) {
  lines.push(
    `  ${g.genre.padEnd(14)} ${String(g.matchedInBank).padStart(4)} / ${String(g.dbCount).padStart(4)}  =  ${(g.matchRate * 100).toFixed(1)}%`,
  );
}
lines.push("");
lines.push("By decade (matched / total = rate):");
for (const d of report.byDecade) {
  lines.push(
    `  ${String(d.decadeRange).padEnd(14)} ${String(d.matchedInBank).padStart(4)} / ${String(d.dbCount).padStart(4)}  =  ${(d.matchRate * 100).toFixed(1)}%`,
  );
}
lines.push("");
lines.push(`First ${Math.min(10, report.bank400MissingFromDb.length)} of ${report.bank400MissingFromDb.length} Bank-400 entries missing from DB:`);
for (const e of report.bank400MissingFromDb.slice(0, 10)) {
  lines.push(`  - ${e.title} — ${e.artist} (${e.year ?? "?"}) [${e.category ?? "?"}]`);
}
lines.push("");
lines.push(`First ${Math.min(10, report.hipHopTemplateMissingFromDb.length)} of ${report.hipHopTemplateMissingFromDb.length} hip-hop template entries missing from DB:`);
for (const e of report.hipHopTemplateMissingFromDb.slice(0, 10)) {
  lines.push(`  - ${e.title} — ${e.artist} (${e.year ?? "?"}) [${e.category ?? "?"}]`);
}
lines.push("");
lines.push(`Report: ${REPORT_PATH}`);

console.log(lines.join("\n"));
