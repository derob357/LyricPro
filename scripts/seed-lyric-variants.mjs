// scripts/seed-lyric-variants.mjs
// Backfill seed for songs.lyricVariants. For any song where lyricVariants is
// NULL or an empty array, sets lyricVariants to a single-entry array built
// from the legacy columns:
//   [{ prompt: lyricPrompt, answer: lyricAnswer,
//      distractors: distractors, sectionType: lyricSectionType }]
//
// Bridges the gap so songs that haven't been processed by
// generate-lyric-variants.mjs still have at least one variant available.
// Eliminates the variantsOf() fallback path for any seeded song.
//
// Idempotent: only updates rows where lyricVariants IS NULL OR length = 0.
// No LLM cost.
//
// Phase 5d dual-write: when seeding lyricVariants we ALSO rebuild the
// layer-3 store (lyric_moments + gameplay_items) for the same song so the
// flag-flipped reader sees a single approved gameplay_item per seeded
// song. Per-song atomic via syncSongVariants — if either store fails to
// write, the song rolls back.
//
// Usage:
//   node scripts/seed-lyric-variants.mjs --dry-run
//   node scripts/seed-lyric-variants.mjs

import postgres from "postgres";
import dotenv from "dotenv";

import { syncSongVariants } from "./_lib/dual-write-variants.mjs";

dotenv.config();

const DB_URL =
  process.env.SUPABASE_SESSION_POOLER_STRING ??
  process.env.SUPABASE_DIRECT_CONNECTION_STRING ??
  process.env.DATABASE_URL;
if (!DB_URL) {
  console.error("Set SUPABASE_SESSION_POOLER_STRING in .env");
  process.exit(1);
}

const DRY_RUN = process.argv.includes("--dry-run") || process.argv.includes("--dry");

const sql = postgres(DB_URL, { max: 2 });

try {
  // Check the column exists before we touch anything (Phase 2a migration:
  // 0007_lyric_variants.sql must have been applied).
  const [colExistsRow] = await sql`
    SELECT 1 AS exists
    FROM information_schema.columns
    WHERE table_name = 'songs' AND column_name = 'lyricVariants'
    LIMIT 1
  `;
  if (!colExistsRow) {
    console.error(
      "songs.lyricVariants column missing. Run scripts/apply-lyric-variants-migration.mjs first."
    );
    await sql.end();
    process.exit(1);
  }

  // Count rows that would be touched. Match the same predicate used in the
  // UPDATE below so the dry-run number is exact.
  const [countRow] = await sql`
    SELECT COUNT(*)::int AS n
    FROM songs
    WHERE "isActive" = true
      AND "approvalStatus" = 'approved'
      AND ("lyricVariants" IS NULL OR jsonb_array_length("lyricVariants") = 0)
  `;
  const toTouch = countRow?.n ?? 0;
  console.log(
    `Mode: ${DRY_RUN ? "DRY-RUN" : "LIVE"}. Songs that need seeding: ${toTouch}`
  );

  if (DRY_RUN) {
    console.log("Dry-run complete. No DB writes performed.");
    await sql.end();
    process.exit(0);
  }

  if (toTouch === 0) {
    console.log("Nothing to seed.");
    await sql.end();
    process.exit(0);
  }

  // Phase 5d dual-write: pull each candidate row, build its 1-element
  // variants array from the legacy columns, then call the dual-write helper
  // so legacy AND layer-3 land together. We keep this serial (no
  // concurrency) — the workload is small (only songs with NULL/empty
  // lyricVariants) and the helper opens its own per-song transaction, so
  // contention isn't an issue.
  const candidates = await sql`
    SELECT id, "lyricPrompt" AS prompt, "lyricAnswer" AS answer,
           COALESCE(distractors, '[]'::jsonb) AS distractors,
           "lyricSectionType" AS section_type
    FROM songs
    WHERE "isActive" = true
      AND "approvalStatus" = 'approved'
      AND ("lyricVariants" IS NULL OR jsonb_array_length("lyricVariants") = 0)
    ORDER BY id ASC
  `;
  let seeded = 0;
  let failed = 0;
  for (const row of candidates) {
    const variants = [
      {
        prompt: row.prompt ?? "",
        answer: row.answer ?? "",
        distractors: Array.isArray(row.distractors) ? row.distractors : [],
        sectionType: row.section_type ?? "verse",
      },
    ];
    try {
      await syncSongVariants(sql, row.id, variants);
      seeded++;
    } catch (err) {
      failed++;
      console.warn(
        `  WARN: dual-write failed for song ${row.id}: ${String(err?.message ?? err)}`,
      );
    }
  }
  console.log(`Seeded ${seeded} rows (failed ${failed}).`);

  console.log("Seeding complete.");
} catch (err) {
  console.error("Seeding failed:", err.message);
  process.exitCode = 1;
} finally {
  await sql.end();
}
