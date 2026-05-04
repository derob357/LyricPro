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
// Single transaction. No LLM cost.
//
// Usage:
//   node scripts/seed-lyric-variants.mjs --dry-run
//   node scripts/seed-lyric-variants.mjs

import postgres from "postgres";
import dotenv from "dotenv";

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

  await sql.begin(async (tx) => {
    // Build the single-element JSONB array per row from the legacy columns.
    // distractors is already jsonb (string[] | null) — coalesce null to '[]'.
    const result = await tx`
      UPDATE songs
      SET "lyricVariants" = jsonb_build_array(
        jsonb_build_object(
          'prompt', "lyricPrompt",
          'answer', "lyricAnswer",
          'distractors', COALESCE(distractors, '[]'::jsonb),
          'sectionType', "lyricSectionType"
        )
      )
      WHERE "isActive" = true
        AND "approvalStatus" = 'approved'
        AND ("lyricVariants" IS NULL OR jsonb_array_length("lyricVariants") = 0)
    `;
    console.log(`Seeded ${result.count} rows.`);
  });

  console.log("Seeding complete.");
} catch (err) {
  console.error("Seeding failed:", err.message);
  process.exitCode = 1;
} finally {
  await sql.end();
}
