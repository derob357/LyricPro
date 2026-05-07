// scripts/verify-backfill.mjs
// Phase 5b — Verification: confirms the backfill from songs.lyricVariants
// into lyric_moments + gameplay_items is complete and content-equivalent.
//
// Checks:
//   1. For every active+approved song with non-null lyricVariants:
//      COUNT(gameplay_items WHERE song_id = s.id) == jsonb_array_length(s.lyricVariants)
//      (1:1 — every variant must have produced exactly one gameplay item)
//
//   2. Random sample of 50 songs: assert content equality for each variant
//      against the corresponding gameplay_items row (matched by index, where
//      gameplay_items.id ascends in insertion order = variant index order).
//      Compares: prompt_text, correct_answer, distractor_1/2/3, and
//      gameplay_items->lyric_moments.section_type.
//
// Exit code 0 + EXIT_GREEN token if clean. Non-zero + diagnostic output
// otherwise.
//
// Usage:
//   node scripts/verify-backfill.mjs

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

const sql = postgres(DB_URL, { max: 2 });

const discrepancies = [];
const contentMismatches = [];

try {
  // ─── Check 1: count parity ─────────────────────────────────────────────────
  console.log("Check 1 — gameplay_item count vs jsonb_array_length(lyricVariants)");

  const countCheckRows = await sql`
    SELECT
      s.id AS song_id,
      s.title,
      s."artistName",
      jsonb_array_length(s."lyricVariants")::int AS variant_count,
      COALESCE(g.item_count, 0)::int AS item_count
    FROM songs s
    LEFT JOIN (
      SELECT song_id, COUNT(*)::int AS item_count
      FROM gameplay_items
      GROUP BY song_id
    ) g ON g.song_id = s.id
    WHERE s."isActive" = true
      AND s."approvalStatus" = 'approved'
      AND s."lyricVariants" IS NOT NULL
      AND jsonb_array_length(s."lyricVariants") > 0
  `;

  let songsChecked = 0;
  for (const row of countCheckRows) {
    songsChecked++;
    if (row.variant_count !== row.item_count) {
      discrepancies.push({
        songId: row.song_id,
        title: row.title,
        artistName: row.artistName,
        variantCount: row.variant_count,
        itemCount: row.item_count,
      });
    }
  }
  console.log(`  songs checked: ${songsChecked}`);
  console.log(`  count discrepancies: ${discrepancies.length}`);
  if (discrepancies.length > 0) {
    console.log("  First few discrepancies:");
    for (const d of discrepancies.slice(0, 10)) {
      console.log(
        `    song ${d.songId} (${d.title} - ${d.artistName}): variants=${d.variantCount}, items=${d.itemCount}`,
      );
    }
  }

  // ─── Check 2: content equality on a 50-song random sample ────────────────
  console.log(
    "\nCheck 2 — content equality on a random sample of up to 50 songs",
  );

  const sampleRows = await sql`
    SELECT id, "lyricVariants"
    FROM songs
    WHERE "isActive" = true
      AND "approvalStatus" = 'approved'
      AND "lyricVariants" IS NOT NULL
      AND jsonb_array_length("lyricVariants") > 0
    ORDER BY random()
    LIMIT 50
  `;

  for (const s of sampleRows) {
    const variants = Array.isArray(s.lyricVariants) ? s.lyricVariants : [];

    // Pull gameplay_items for this song in id-order (= insertion order =
    // variant index order, since each song's items are inserted within a
    // single transaction in the backfill loop).
    const items = await sql`
      SELECT g.id, g.prompt_text, g.correct_answer,
             g.distractor_1, g.distractor_2, g.distractor_3,
             m.section_type
      FROM gameplay_items g
      JOIN lyric_moments m ON m.id = g.lyric_moment_id
      WHERE g.song_id = ${s.id}
      ORDER BY g.id ASC
    `;

    if (items.length !== variants.length) {
      contentMismatches.push({
        songId: s.id,
        kind: "length",
        expected: variants.length,
        actual: items.length,
      });
      continue;
    }

    // Detect intra-song lyric_text dedupes (e.g. song 7 "My Adidas":
    // variants 0 and 1 produce the same lyric_text; the second variant's
    // gameplay item legitimately points at the FIRST variant's moment, so
    // section_type from the moment will reflect the FIRST variant's
    // sectionType, not the current variant's). Build a lyric_text -> first
    // variant index map.
    const firstVariantIndexByLyricText = new Map();
    for (let i = 0; i < variants.length; i++) {
      const v = variants[i];
      const lyricText = `${(v.prompt ?? "").trim()} ${(v.answer ?? "").trim()}`.trim();
      if (!firstVariantIndexByLyricText.has(lyricText)) {
        firstVariantIndexByLyricText.set(lyricText, i);
      }
    }

    for (let i = 0; i < variants.length; i++) {
      const v = variants[i];
      const it = items[i];
      const expDistractors = Array.isArray(v.distractors) ? v.distractors : [];
      const probs = [];
      if ((v.prompt ?? "") !== (it.prompt_text ?? "")) {
        probs.push(`prompt_text: "${v.prompt}" != "${it.prompt_text}"`);
      }
      if ((v.answer ?? "") !== (it.correct_answer ?? "")) {
        probs.push(`correct_answer: "${v.answer}" != "${it.correct_answer}"`);
      }
      if ((expDistractors[0] ?? null) !== (it.distractor_1 ?? null)) {
        probs.push(
          `distractor_1: "${expDistractors[0] ?? null}" != "${it.distractor_1 ?? null}"`,
        );
      }
      if ((expDistractors[1] ?? null) !== (it.distractor_2 ?? null)) {
        probs.push(
          `distractor_2: "${expDistractors[1] ?? null}" != "${it.distractor_2 ?? null}"`,
        );
      }
      if ((expDistractors[2] ?? null) !== (it.distractor_3 ?? null)) {
        probs.push(
          `distractor_3: "${expDistractors[2] ?? null}" != "${it.distractor_3 ?? null}"`,
        );
      }
      // Only assert section_type when this variant is the FIRST occurrence
      // of its lyric_text. Later occurrences are intentional dedupe targets
      // — their gameplay item points at the first variant's moment, so
      // moment.section_type reflects the first variant.
      const lyricText = `${(v.prompt ?? "").trim()} ${(v.answer ?? "").trim()}`.trim();
      const isFirstOccurrence =
        firstVariantIndexByLyricText.get(lyricText) === i;
      if (
        isFirstOccurrence &&
        (v.sectionType ?? "verse") !== (it.section_type ?? "")
      ) {
        probs.push(
          `section_type: "${v.sectionType}" != "${it.section_type}"`,
        );
      }
      if (probs.length > 0) {
        contentMismatches.push({
          songId: s.id,
          variantIndex: i,
          gameplayItemId: it.id,
          problems: probs,
        });
      }
    }
  }

  console.log(`  sample songs checked: ${sampleRows.length}`);
  console.log(`  content mismatches: ${contentMismatches.length}`);
  if (contentMismatches.length > 0) {
    console.log("  First few content mismatches:");
    for (const m of contentMismatches.slice(0, 10)) {
      console.log(
        `    song ${m.songId} variant ${m.variantIndex} (item ${m.gameplayItemId}):`,
      );
      for (const p of (m.problems ?? [])) console.log(`      ${p}`);
      if (m.kind === "length") {
        console.log(`      length mismatch: expected ${m.expected}, got ${m.actual}`);
      }
    }
  }

  if (discrepancies.length === 0 && contentMismatches.length === 0) {
    console.log(
      "\nEXIT_GREEN: backfill verified — every active variant has a corresponding gameplay_item with matching content.",
    );
    process.exitCode = 0;
  } else {
    console.error(
      `\nFAILED: ${discrepancies.length} count discrepancies + ${contentMismatches.length} content mismatches`,
    );
    process.exitCode = 1;
  }
} catch (err) {
  console.error("Verification aborted:", err.message);
  console.error(err.stack);
  process.exitCode = 1;
} finally {
  await sql.end();
}
