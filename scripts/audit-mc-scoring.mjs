/**
 * scripts/audit-mc-scoring.mjs
 *
 * READ-ONLY audit: quantifies historical MC-scoring anomalies in round_results.
 *
 * Two anomaly classes are detected per scored axis:
 *   OVERMATCH — user answer != correct but points > 0  (fuzzy match gave undeserved credit)
 *   UNDERMATCH — user answer == correct but points = 0  (variant drift / exact-match miss)
 *
 * NOTE — schema reality vs. plan's guesses:
 *   The plan assumed a "title" axis (titleAnswer / titlePoints). This column does NOT
 *   exist in round_results. Only three per-axis answer columns are stored:
 *     userLyricAnswer  / lyricPoints
 *     userArtistAnswer / artistPoints
 *     userYearAnswer   / yearPoints
 *   The lyric axis IS included here (point-in-time answer vs. songs.lyricAnswer).
 *   Lyric results may show false positives due to variant drift — a user may have
 *   answered against lyricVariants[N] rather than songs.lyricAnswer. Those are noted
 *   in the output.
 *
 * CAVEAT — artist OVERMATCH lines may be legitimate alias matches.  Cross-check
 *   against artist_metadata.aliases before treating them as bugs.
 *
 * Usage:
 *   node scripts/audit-mc-scoring.mjs [--days 14]
 *
 * Database is PRODUCTION (single-Supabase topology). This script is strictly
 * read-only: SELECT queries only — no INSERT, UPDATE, DELETE, or DDL.
 */

import postgres from "postgres";
import dotenv from "dotenv";

dotenv.config();

// ── CLI args ──────────────────────────────────────────────────────────────────
const daysArg = (() => {
  const idx = process.argv.indexOf("--days");
  if (idx !== -1 && process.argv[idx + 1]) {
    const v = parseInt(process.argv[idx + 1], 10);
    if (!isNaN(v) && v > 0) return v;
    console.warn(`Invalid --days value; using default 14`);
  }
  return 14;
})();

const LIMIT = 2000;

// ── DB connection (env-fallback chain copied from apply-answer-method-mc-migration.mjs) ──
const DB_URL =
  process.env.SUPABASE_SESSION_POOLER_STRING ??
  process.env.SUPABASE_DIRECT_CONNECTION_STRING ??
  process.env.DATABASE_URL;

if (!DB_URL) {
  console.error(
    "ERROR: Set SUPABASE_SESSION_POOLER_STRING (or _DIRECT_CONNECTION_STRING / DATABASE_URL) in .env"
  );
  process.exit(1);
}

const sql = postgres(DB_URL, { max: 1, prepare: false });

// ── normalizeText — must be identical to server/_core/scoring.ts ──────────────
function normalizeText(text) {
  if (text == null) return "";
  return String(text)
    .toLowerCase()
    .replace(/[^\w\s]/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

// ── Main ───────────────────────────────────────────────────────────────────────
try {
  console.log(`\n=== LyricPro MC Scoring Anomaly Audit ===`);
  console.log(`Window : last ${daysArg} day(s)`);
  console.log(`Limit  : ${LIMIT} rows (newest first)`);
  console.log(`Mode   : READ-ONLY (SELECT only)\n`);
  console.log(
    "NOTE: title axis omitted — round_results has no userTitleAnswer / titlePoints columns.\n" +
    "NOTE: lyric OVERMATCH lines may reflect variant drift (answer matched a non-primary variant).\n" +
    "NOTE: artist OVERMATCH lines may be legitimate alias matches — cross-check artist_metadata.aliases.\n"
  );

  // Fetch MC-method round_results within the window, joined to songs.
  // Only rows where answerMethod = 'mc' are candidates for the new exact-match
  // regime; rows without 'mc' were always fuzzy-scored and are out of scope.
  // However, before the 'mc' enum value existed (Tasks 1-2), all rounds used
  // 'typed' method even when they were multiple-choice — so we intentionally
  // audit ALL answer methods to catch the pre-enum era.
  const rows = await sql`
    SELECT
      rr.id,
      rr."roomId",
      rr."roundNumber",
      rr."songId",
      rr."userLyricAnswer",
      rr."userArtistAnswer",
      rr."userYearAnswer",
      rr."answerMethod",
      rr."lyricPoints",
      rr."artistPoints",
      rr."yearPoints",
      rr."createdAt",
      s.title        AS "songTitle",
      s."artistName" AS "songArtist",
      s."releaseYear" AS "songYear",
      s."lyricAnswer" AS "correctLyric"
    FROM round_results rr
    JOIN songs s ON s.id = rr."songId"
    WHERE rr."createdAt" >= NOW() - INTERVAL '1 day' * ${daysArg}
    ORDER BY rr."createdAt" DESC
    LIMIT ${LIMIT}
  `;

  console.log(`Fetched ${rows.length} row(s) from round_results.\n`);

  if (rows.length === 0) {
    console.log("No round_results in the specified window. Nothing to audit.");
    await sql.end();
    process.exit(0);
  }

  // ── Anomaly detection ──────────────────────────────────────────────────────
  const findings = [];

  for (const row of rows) {
    const rowFindings = [];

    const dateStr = new Date(row.createdAt).toISOString().slice(0, 19).replace("T", " ");
    const room = row.roomId ?? "solo";
    const method = row.answerMethod;

    // ── Lyric axis ──
    if (row.userLyricAnswer !== null && row.userLyricAnswer !== undefined) {
      const userNorm = normalizeText(row.userLyricAnswer);
      const correctNorm = normalizeText(row.correctLyric);
      const hasPoints = row.lyricPoints > 0;

      if (userNorm && correctNorm) {
        if (userNorm !== correctNorm && hasPoints) {
          rowFindings.push({
            axis: "lyric",
            type: "OVERMATCH",
            submitted: row.userLyricAnswer,
            correct: row.correctLyric,
            points: row.lyricPoints,
            note: "submitted != correct (normalized) but points > 0; may be variant drift",
          });
        } else if (userNorm === correctNorm && !hasPoints) {
          rowFindings.push({
            axis: "lyric",
            type: "UNDERMATCH",
            submitted: row.userLyricAnswer,
            correct: row.correctLyric,
            points: row.lyricPoints,
            note: "submitted == correct (normalized) but points = 0",
          });
        }
      }
    }

    // ── Artist axis ──
    if (row.userArtistAnswer !== null && row.userArtistAnswer !== undefined) {
      const userNorm = normalizeText(row.userArtistAnswer);
      const correctNorm = normalizeText(row.songArtist);
      const hasPoints = row.artistPoints > 0;

      if (userNorm && correctNorm) {
        if (userNorm !== correctNorm && hasPoints) {
          rowFindings.push({
            axis: "artist",
            type: "OVERMATCH",
            submitted: row.userArtistAnswer,
            correct: row.songArtist,
            points: row.artistPoints,
            note: "submitted != correct (normalized) but points > 0; may be a valid alias — verify artist_metadata.aliases",
          });
        } else if (userNorm === correctNorm && !hasPoints) {
          rowFindings.push({
            axis: "artist",
            type: "UNDERMATCH",
            submitted: row.userArtistAnswer,
            correct: row.songArtist,
            points: row.artistPoints,
            note: "submitted == correct (normalized) but points = 0",
          });
        }
      }
    }

    // ── Year axis ──
    if (row.userYearAnswer !== null && row.userYearAnswer !== undefined) {
      const submittedYear = parseInt(row.userYearAnswer, 10);
      // songs.releaseYear is a Postgres integer — the driver returns a JS number, so numeric comparison is correct.
      const correctYear = row.songYear;
      const hasPoints = row.yearPoints > 0;

      if (!isNaN(submittedYear) && correctYear) {
        if (submittedYear !== correctYear && hasPoints) {
          rowFindings.push({
            axis: "year",
            type: "OVERMATCH",
            submitted: submittedYear,
            correct: correctYear,
            points: row.yearPoints,
            note: `submitted year ${submittedYear} != correct ${correctYear} but points > 0`,
          });
        } else if (submittedYear === correctYear && !hasPoints) {
          rowFindings.push({
            axis: "year",
            type: "UNDERMATCH",
            submitted: submittedYear,
            correct: correctYear,
            points: row.yearPoints,
            note: `submitted year ${submittedYear} == correct but points = 0`,
          });
        }
      }
    }

    if (rowFindings.length > 0) {
      for (const f of rowFindings) {
        findings.push({
          roundResultId: row.id,
          room,
          method,
          song: `"${row.songTitle}" — ${row.songArtist} (${row.songYear})`,
          date: dateStr,
          ...f,
        });
      }
    }
  }

  // ── Print sample findings (up to 10) ──────────────────────────────────────
  const sampleSize = Math.min(findings.length, 10);
  if (sampleSize > 0) {
    console.log(`--- Sample Findings (up to 10 of ${findings.length}) ---\n`);
    for (let i = 0; i < sampleSize; i++) {
      const f = findings[i];
      console.log(
        `[${i + 1}] rr.id=${f.roundResultId}  room=${f.room}  method=${f.method}  ${f.date}`
      );
      console.log(`    Song   : ${f.song}`);
      console.log(`    Axis   : ${f.axis}  TYPE: ${f.type}  points=${f.points}`);
      console.log(`    Submitted : ${f.submitted}`);
      console.log(`    Correct   : ${f.correct}`);
      console.log(`    Note   : ${f.note}`);
      console.log();
    }
  } else {
    console.log("No anomalies detected in the fetched rows.\n");
  }

  // ── Summary ────────────────────────────────────────────────────────────────
  const overmatch = findings.filter(f => f.type === "OVERMATCH");
  const undermatch = findings.filter(f => f.type === "UNDERMATCH");

  const overmatchByAxis = { lyric: 0, artist: 0, year: 0 };
  const undermatchByAxis = { lyric: 0, artist: 0, year: 0 };
  for (const f of overmatch) overmatchByAxis[f.axis] = overmatchByAxis[f.axis] + 1;
  for (const f of undermatch) undermatchByAxis[f.axis] = undermatchByAxis[f.axis] + 1;

  console.log("=== SUMMARY ===");
  console.log(`Total audited        : ${rows.length}`);
  console.log(`Total anomalies      : ${findings.length}`);
  console.log(`  OVERMATCH (wrong→pts):`);
  console.log(`    lyric  : ${overmatchByAxis.lyric}`);
  console.log(`    artist : ${overmatchByAxis.artist}  (alias matches not yet filtered)`);
  console.log(`    year   : ${overmatchByAxis.year}`);
  console.log(`  UNDERMATCH (correct→0):`);
  console.log(`    lyric  : ${undermatchByAxis.lyric}  (may include variant-drift false positives)`);
  console.log(`    artist : ${undermatchByAxis.artist}`);
  console.log(`    year   : ${undermatchByAxis.year}`);
  console.log();
  console.log("CAVEATS:");
  console.log("  - artist OVERMATCH lines may be legitimate alias matches;");
  console.log("    cross-check against artist_metadata.aliases before treating as bugs.");
  console.log("  - lyric axis compares against songs.lyricAnswer only;");
  console.log("    a user may have answered against a lyricVariants[N] entry,");
  console.log("    producing false OVERMATCH/UNDERMATCH signals.");
  console.log("  - title axis OMITTED: round_results has no userTitleAnswer / titlePoints columns.");
  console.log("  - data fixes are out of scope for this script (read-only audit only).");
} catch (err) {
  console.error("Audit FAILED:", err.message ?? err);
  process.exit(1);
} finally {
  await sql.end();
}
