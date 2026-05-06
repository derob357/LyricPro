// scripts/apply-deactivations.mjs
// Phase 1.5 — Apply Deactivations.
//
// Reads scripts/verify-lyrics.report.json and sets isActive=false on every song
// that the verifier flagged HAS_FAILS or NO_SOURCE.
//
//   - HAS_FAILS  → at least one variant didn't match canonical lyrics.
//                  Deactivate now; regeneration phase will replace failing
//                  variants and reactivate.
//   - NO_SOURCE  → no lyrics API had a record. Deactivate defensively pending
//                  manual review.
//
// Safety bars:
//   - Dry-run by default. Mutations only when --apply is passed.
//   - Writes scripts/apply-deactivations.backup.json BEFORE any UPDATE so a
//     manual rollback has the full list of affected ids + their prior state.
//   - Idempotent: only deactivates rows where isActive=true at update time, so
//     re-runs don't churn updatedAt on already-inactive rows or step on rows
//     that some other process deactivated for an unrelated reason.
//   - One UPDATE statement using id = ANY($1::int[]).
//   - Re-queries after UPDATE to confirm rows are now inactive; prints counts.
//   - Writes scripts/apply-deactivations.result.json with a final summary.
//
// Usage:
//   node scripts/apply-deactivations.mjs                  # dry-run
//   node scripts/apply-deactivations.mjs --apply          # mutate DB
//   node scripts/apply-deactivations.mjs --limit 50       # cap to first N
//   node scripts/apply-deactivations.mjs --apply --limit 50
//
// Rollback (manual — no separate script):
//   Read scripts/apply-deactivations.backup.json and run:
//     UPDATE songs SET "isActive"=true WHERE id = ANY('{<ids>}'::int[])
//   …against rows whose current isActive is false (so we don't reactivate
//   songs that were independently deactivated for other reasons).

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
  console.error(
    "Set SUPABASE_SESSION_POOLER_STRING (or SUPABASE_DIRECT_CONNECTION_STRING / DATABASE_URL) in .env"
  );
  process.exit(1);
}

const REPORT_PATH = path.resolve("scripts/verify-lyrics.report.json");
const BACKUP_PATH = path.resolve("scripts/apply-deactivations.backup.json");
const RESULT_PATH = path.resolve("scripts/apply-deactivations.result.json");

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
const APPLY = getFlag("apply");
const LIMIT_RAW = getOpt("limit");
const LIMIT = LIMIT_RAW != null ? parseInt(LIMIT_RAW, 10) : 0;
if (LIMIT_RAW != null && (!Number.isFinite(LIMIT) || LIMIT < 0)) {
  console.error(`--limit must be a non-negative integer (got: ${LIMIT_RAW})`);
  process.exit(1);
}

// ─── Helpers ──────────────────────────────────────────────────────────────────
function readReport() {
  if (!fs.existsSync(REPORT_PATH)) {
    console.error(
      `Report not found at: ${REPORT_PATH}\n` +
        `Run \`node scripts/verify-lyrics.mjs\` first to produce the report.`
    );
    process.exit(1);
  }
  let parsed;
  try {
    parsed = JSON.parse(fs.readFileSync(REPORT_PATH, "utf8"));
  } catch (err) {
    console.error(`Failed to parse ${REPORT_PATH}: ${err.message}`);
    process.exit(1);
  }
  if (!parsed || !Array.isArray(parsed.songs)) {
    console.error(
      `Report at ${REPORT_PATH} is missing a 'songs' array. Re-run verify-lyrics.mjs.`
    );
    process.exit(1);
  }
  return parsed;
}

function bucketize(songs) {
  const hasFails = [];
  const noSource = [];
  for (const s of songs) {
    if (!s || typeof s.songId !== "number") continue;
    if (s.status === "HAS_FAILS") hasFails.push(s);
    else if (s.status === "NO_SOURCE") noSource.push(s);
  }
  return { hasFails, noSource };
}

function previewTitles(list, n = 10) {
  return list.slice(0, n).map((s) => `  - [${s.songId}] "${s.title}" by ${s.artistName}`);
}

// ─── Main ─────────────────────────────────────────────────────────────────────
async function main() {
  console.log("═".repeat(60));
  console.log("APPLY DEACTIVATIONS");
  console.log("═".repeat(60));
  console.log(`mode:        ${APPLY ? "APPLY (will mutate)" : "DRY-RUN"}`);
  console.log(`limit:       ${LIMIT > 0 ? LIMIT : "none"}`);
  console.log(`report:      ${REPORT_PATH}`);
  console.log(`backup:      ${BACKUP_PATH}`);
  console.log(`result:      ${RESULT_PATH}`);
  console.log("");

  const report = readReport();
  console.log(`report generatedAt: ${report.generatedAt ?? "(unknown)"}`);
  console.log(`report songs:       ${report.songs.length}`);

  const { hasFails, noSource } = bucketize(report.songs);
  console.log("");
  console.log("Buckets from report:");
  console.log(`  HAS_FAILS:  ${hasFails.length}`);
  console.log(`  NO_SOURCE:  ${noSource.length}`);
  console.log(`  total:      ${hasFails.length + noSource.length}`);

  // Combine, preserving status alongside id for the backup record.
  let candidates = [
    ...hasFails.map((s) => ({
      id: s.songId,
      title: s.title,
      artistName: s.artistName,
      status: "HAS_FAILS",
    })),
    ...noSource.map((s) => ({
      id: s.songId,
      title: s.title,
      artistName: s.artistName,
      status: "NO_SOURCE",
    })),
  ];

  // Stable order by id so a --limit slice is deterministic.
  candidates.sort((a, b) => a.id - b.id);

  if (LIMIT > 0 && candidates.length > LIMIT) {
    console.log(`\napplying --limit ${LIMIT} (was ${candidates.length} candidates)`);
    candidates = candidates.slice(0, LIMIT);
  }

  console.log("");
  console.log(`candidates to deactivate: ${candidates.length}`);
  console.log("");
  console.log("first 10 HAS_FAILS:");
  if (hasFails.length === 0) console.log("  (none)");
  else for (const line of previewTitles(hasFails, 10)) console.log(line);
  console.log("");
  console.log("first 10 NO_SOURCE:");
  if (noSource.length === 0) console.log("  (none)");
  else for (const line of previewTitles(noSource, 10)) console.log(line);

  if (candidates.length === 0) {
    console.log("\nnothing to deactivate. exiting.");
    return;
  }

  // ─── Connect to DB ──────────────────────────────────────────────────────────
  // ssl: 'require' + max: 1 per spec — be polite to the pooler.
  const sql = postgres(DB_URL, { ssl: "require", max: 1 });

  try {
    const ids = candidates.map((c) => c.id);

    // ─── Snapshot current isActive state for the candidate ids ────────────────
    // Used both for the backup file and to filter out already-inactive ids
    // before the UPDATE (idempotency).
    const currentRows = await sql`
      SELECT id, "isActive"
      FROM songs
      WHERE id = ANY(${ids}::int[])
    `;
    const currentById = new Map(currentRows.map((r) => [r.id, r.isActive]));

    const missingIds = ids.filter((id) => !currentById.has(id));
    if (missingIds.length > 0) {
      console.log("");
      console.log(
        `WARNING: ${missingIds.length} candidate id(s) not found in DB (skipped):`
      );
      console.log(`  ${missingIds.slice(0, 10).join(", ")}${missingIds.length > 10 ? " ..." : ""}`);
    }

    const alreadyInactiveIds = ids.filter(
      (id) => currentById.has(id) && currentById.get(id) === false
    );
    if (alreadyInactiveIds.length > 0) {
      console.log("");
      console.log(
        `note: ${alreadyInactiveIds.length} candidate id(s) are already isActive=false; will be skipped.`
      );
    }

    const targetIds = ids.filter(
      (id) => currentById.has(id) && currentById.get(id) === true
    );

    console.log("");
    console.log("UPDATE plan:");
    console.log(`  candidates:           ${ids.length}`);
    console.log(`  not found in DB:      ${missingIds.length}`);
    console.log(`  already inactive:     ${alreadyInactiveIds.length}`);
    console.log(`  will deactivate:      ${targetIds.length}`);

    // ─── Backup file ─────────────────────────────────────────────────────────
    // Always written, even on dry-run, so the operator can review the rollback
    // artifact before running with --apply.
    const backup = {
      generatedAt: new Date().toISOString(),
      mode: APPLY ? "apply" : "dry-run",
      reportPath: REPORT_PATH,
      reportGeneratedAt: report.generatedAt ?? null,
      limit: LIMIT > 0 ? LIMIT : null,
      counts: {
        candidates: ids.length,
        notFound: missingIds.length,
        alreadyInactive: alreadyInactiveIds.length,
        willDeactivate: targetIds.length,
      },
      songs: candidates.map((c) => ({
        id: c.id,
        title: c.title,
        artistName: c.artistName,
        status: c.status,
        currentIsActive: currentById.has(c.id) ? currentById.get(c.id) : null,
        existsInDb: currentById.has(c.id),
      })),
    };
    fs.writeFileSync(BACKUP_PATH, JSON.stringify(backup, null, 2));
    console.log("");
    console.log(`backup written: ${BACKUP_PATH}`);

    if (!APPLY) {
      console.log("");
      console.log("DRY-RUN complete. No DB changes made.");
      console.log("Re-run with --apply to perform the UPDATE.");
      return;
    }

    if (targetIds.length === 0) {
      console.log("\nnothing left to update (all candidates already inactive or missing).");
      const result = {
        timestamp: new Date().toISOString(),
        dryRun: false,
        idsDeactivated: [],
        rowsAffected: 0,
        countsByStatus: { HAS_FAILS: 0, NO_SOURCE: 0 },
      };
      fs.writeFileSync(RESULT_PATH, JSON.stringify(result, null, 2));
      console.log(`result written: ${RESULT_PATH}`);
      return;
    }

    // ─── UPDATE ──────────────────────────────────────────────────────────────
    // Filter on isActive=true so re-runs are idempotent (won't churn updatedAt
    // on already-inactive rows, and won't reactivate-then-deactivate anything).
    console.log("");
    console.log(`executing UPDATE on ${targetIds.length} row(s)...`);
    const updated = await sql`
      UPDATE songs
      SET "isActive" = false,
          "updatedAt" = NOW()
      WHERE id = ANY(${targetIds}::int[])
        AND "isActive" = true
      RETURNING id
    `;
    const updatedIds = updated.map((r) => r.id);
    console.log(`UPDATE affected ${updatedIds.length} row(s).`);

    // ─── Verify ──────────────────────────────────────────────────────────────
    const verifyRows = await sql`
      SELECT id, "isActive"
      FROM songs
      WHERE id = ANY(${updatedIds}::int[])
    `;
    const stillActive = verifyRows.filter((r) => r.isActive === true);
    if (stillActive.length > 0) {
      console.error(
        `ERROR: ${stillActive.length} row(s) reported updated but still show isActive=true: ` +
          stillActive.map((r) => r.id).join(", ")
      );
    } else {
      console.log(`verification: all ${verifyRows.length} updated row(s) are now isActive=false.`);
    }

    // ─── Summary ─────────────────────────────────────────────────────────────
    const updatedSet = new Set(updatedIds);
    const updatedByStatus = { HAS_FAILS: 0, NO_SOURCE: 0 };
    for (const c of candidates) {
      if (updatedSet.has(c.id)) {
        updatedByStatus[c.status] = (updatedByStatus[c.status] || 0) + 1;
      }
    }

    const totalInactiveRow = await sql`
      SELECT COUNT(*)::int AS n FROM songs WHERE "isActive" = false
    `;
    const totalInactive = totalInactiveRow[0]?.n ?? null;

    console.log("");
    console.log("═".repeat(60));
    console.log("FINAL SUMMARY");
    console.log("═".repeat(60));
    console.log(`deactivated this run:     ${updatedIds.length}`);
    console.log(`  HAS_FAILS:              ${updatedByStatus.HAS_FAILS}`);
    console.log(`  NO_SOURCE:              ${updatedByStatus.NO_SOURCE}`);
    console.log(`already inactive (skip):  ${alreadyInactiveIds.length}`);
    console.log(`not found in DB (skip):   ${missingIds.length}`);
    console.log(`total inactive in DB:     ${totalInactive}`);

    const result = {
      timestamp: new Date().toISOString(),
      dryRun: false,
      reportGeneratedAt: report.generatedAt ?? null,
      limit: LIMIT > 0 ? LIMIT : null,
      idsDeactivated: updatedIds,
      rowsAffected: updatedIds.length,
      countsByStatus: updatedByStatus,
      skipped: {
        alreadyInactive: alreadyInactiveIds.length,
        notFound: missingIds.length,
      },
      totalInactiveInDb: totalInactive,
    };
    fs.writeFileSync(RESULT_PATH, JSON.stringify(result, null, 2));
    console.log("");
    console.log(`result written: ${RESULT_PATH}`);
  } finally {
    await sql.end({ timeout: 5 });
  }
}

main().catch((err) => {
  console.error("FATAL:", err);
  process.exit(1);
});
