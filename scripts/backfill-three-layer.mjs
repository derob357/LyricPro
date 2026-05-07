// scripts/backfill-three-layer.mjs
// Phase 5b — Backfill: populate lyric_moments + gameplay_items from
// existing songs.lyricVariants jsonb data.
//
// Mapping rules per docs/phase-5-schema/MIGRATION-PLAN.md:
//   For each variant in songs.lyricVariants[]:
//     1 lyric_moments row (approval_status='approved' since it's already
//       live in production rotation; scoring fields all NULL)
//     1 gameplay_items row (qa_status='passed' for the same reason),
//       FK'd to the just-created lyric_moments row.
//
// Idempotency: songs that already have lyric_moments rows are skipped
// entirely. Re-runs are safe — no DELETE/INSERT cycle.
//
// Concurrency: 5 songs in parallel. Per-song transactions so a partial
// failure on one song doesn't leak inserts.
//
// in_curated_bank backfill: derived from scripts/catalog-audit.report.json
// — `dbSongsNotInAnyBank` lists 1914 songs that are NOT in either bank;
// the complement (matched bank songs) is what gets in_curated_bank=true.
//
// CLI flags:
//   (no flags)  dry-run, no INSERTs, prints plan
//   --apply     actually inserts
//   --limit N   smoke-test on first N songs
//
// Usage:
//   node scripts/backfill-three-layer.mjs                      # dry run
//   node scripts/backfill-three-layer.mjs --apply --limit 10   # smoke
//   node scripts/backfill-three-layer.mjs --apply              # full

import postgres from "postgres";
import dotenv from "dotenv";
import fs from "node:fs";
import path from "node:path";

dotenv.config();

const DB_URL =
  process.env.SUPABASE_SESSION_POOLER_STRING ??
  process.env.SUPABASE_DIRECT_CONNECTION_STRING ??
  process.env.DATABASE_URL;
if (!DB_URL) {
  console.error("Set SUPABASE_SESSION_POOLER_STRING in .env");
  process.exit(1);
}

const args = process.argv.slice(2);
const APPLY = args.includes("--apply");
const limitIdx = args.indexOf("--limit");
const LIMIT = limitIdx >= 0 ? Number(args[limitIdx + 1]) : null;
if (limitIdx >= 0 && (!Number.isFinite(LIMIT) || LIMIT <= 0)) {
  console.error("--limit requires a positive integer");
  process.exit(1);
}

const CONCURRENCY = 5;

const CATALOG_REPORT_PATH = path.resolve("scripts/catalog-audit.report.json");

// ─── Build the curated-bank song-id set ──────────────────────────────────────
//
// catalog-audit.report.json gives us `dbSongsNotInAnyBank` — the rest of the
// active+approved DB songs ARE in either the 400-bank or the hip-hop
// template. We compute the complement at runtime against the live song list.
function loadNotInBankIds() {
  if (!fs.existsSync(CATALOG_REPORT_PATH)) {
    console.warn(
      `WARN: ${CATALOG_REPORT_PATH} not found — in_curated_bank will not be set.`,
    );
    return null;
  }
  const r = JSON.parse(fs.readFileSync(CATALOG_REPORT_PATH, "utf8"));
  const ids = new Set(
    (r.dbSongsNotInAnyBank ?? [])
      .map((s) => s.id)
      .filter((id) => Number.isInteger(id)),
  );
  return ids;
}

// ─── Map legacy difficulty enum → our 3 boolean fit flags ─────────────────────
function difficultyFitFlags(difficulty) {
  // legacy values: "low" | "medium" | "high"
  return {
    low_fit: difficulty === "low",
    medium_fit: difficulty === "medium",
    hard_fit: difficulty === "high",
  };
}

// ─── Build the lyric_text from a variant ──────────────────────────────────────
function lyricTextFromVariant(variant) {
  const p = (variant.prompt ?? "").trim();
  const a = (variant.answer ?? "").trim();
  if (p && a) return `${p} ${a}`;
  return p || a;
}

// ─── Parallel work-pool helper ────────────────────────────────────────────────
async function runPool(items, worker, concurrency) {
  let cursor = 0;
  const workers = Array.from({ length: concurrency }, async () => {
    while (true) {
      const idx = cursor++;
      if (idx >= items.length) return;
      await worker(items[idx], idx);
    }
  });
  await Promise.all(workers);
}

// ─── Main ────────────────────────────────────────────────────────────────────
const sql = postgres(DB_URL, { max: CONCURRENCY + 2 });

// shared mutable state for progress reporting + final summary
const state = {
  songsTotal: 0,
  songsConsidered: 0,
  songsSkippedAlreadyMigrated: 0,
  songsSkippedNoVariants: 0,
  songsProcessed: 0,
  songsFailed: 0,
  momentsInserted: 0,
  itemsInserted: 0,
  inCuratedBankFlagged: 0,
  failures: [],
};

try {
  console.log(
    `Mode: ${APPLY ? "APPLY" : "DRY-RUN"}${LIMIT != null ? `, limit=${LIMIT}` : ""}, concurrency=${CONCURRENCY}`,
  );

  const notInBankIds = loadNotInBankIds();
  if (notInBankIds) {
    console.log(`  catalog-audit: ${notInBankIds.size} active songs NOT in any bank`);
  }

  // Pull every active+approved song with lyricVariants populated.
  // Sort by id ASC so --limit smoke runs are deterministic.
  let songs;
  if (LIMIT != null) {
    songs = await sql`
      SELECT id, title, "artistName", difficulty, "lyricVariants"
      FROM songs
      WHERE "isActive" = true AND "approvalStatus" = 'approved'
      ORDER BY id ASC
      LIMIT ${LIMIT}
    `;
  } else {
    songs = await sql`
      SELECT id, title, "artistName", difficulty, "lyricVariants"
      FROM songs
      WHERE "isActive" = true AND "approvalStatus" = 'approved'
      ORDER BY id ASC
    `;
  }
  state.songsTotal = songs.length;
  console.log(`  fetched ${songs.length} active+approved songs`);

  // Pre-flight scan + curated bank flagging.
  let totalVariantsExpected = 0;
  let curatedBankToFlag = 0;
  for (const s of songs) {
    state.songsConsidered++;
    const vs = Array.isArray(s.lyricVariants) ? s.lyricVariants : [];
    if (vs.length === 0) {
      state.songsSkippedNoVariants++;
      continue;
    }
    totalVariantsExpected += vs.length;
    if (notInBankIds && !notInBankIds.has(s.id)) curatedBankToFlag++;
  }
  console.log(`  variants total (expected inserts per table): ${totalVariantsExpected}`);
  console.log(`  songs to flag in_curated_bank=true:           ${curatedBankToFlag}`);

  if (!APPLY) {
    console.log("\nDry-run complete. No INSERTs were issued. Re-run with --apply to write.");
    process.exit(0);
  }

  // Update in_curated_bank in a single pass before per-song inserts.
  // Idempotent: setting the flag to its current value is a no-op.
  if (notInBankIds && curatedBankToFlag > 0) {
    // Build the inverse list: songs IN any bank = total active songs minus notInBank list,
    // bounded by the songs we're processing in this batch.
    const idsInBank = songs
      .filter((s) => !notInBankIds.has(s.id))
      .map((s) => s.id);
    if (idsInBank.length > 0) {
      const r = await sql`
        UPDATE songs
        SET in_curated_bank = true
        WHERE id IN ${sql(idsInBank)}
          AND in_curated_bank = false
      `;
      state.inCuratedBankFlagged = r.count;
      console.log(`  flagged ${r.count} songs as in_curated_bank=true`);
    }
  }

  // Per-song worker.
  await runPool(
    songs,
    async (song) => {
      const vs = Array.isArray(song.lyricVariants) ? song.lyricVariants : [];
      if (vs.length === 0) return; // already counted in pre-flight

      try {
        // Idempotency: if any lyric_moments rows exist for this song, skip.
        const [existing] = await sql`
          SELECT COUNT(*)::int AS n FROM lyric_moments WHERE song_id = ${song.id}
        `;
        if (existing.n > 0) {
          state.songsSkippedAlreadyMigrated++;
          process.stdout.write(`  [skip ] song ${song.id} — already has ${existing.n} moments\n`);
          return;
        }

        const fits = difficultyFitFlags(song.difficulty);

        // Single per-song transaction.
        let insertedMoments = 0;
        let insertedItems = 0;
        await sql.begin(async (tx) => {
          for (let i = 0; i < vs.length; i++) {
            const variant = vs[i];
            const lyricText = lyricTextFromVariant(variant);
            if (!lyricText) {
              // skip empty/garbage variants (shouldn't happen post-Phase 3
              // but be defensive)
              continue;
            }

            // INSERT moment. ON CONFLICT against the (song_id, lyric_text)
            // unique index — if two variants collide on lyric_text within
            // the same song (rare; Marvin Gaye "Let's Get It On" is the
            // example), we keep the first and the second variant's
            // gameplay_item points at the same moment.
            const [m] = await tx`
              INSERT INTO lyric_moments (
                song_id, section_type, section_order, candidate_use_case,
                lyric_text,
                low_fit, medium_fit, hard_fit,
                song_recognition_fit, artist_recognition_fit,
                year_fit, finish_the_lyric_fit,
                reviewer_notes, approval_status, approved_at
              ) VALUES (
                ${song.id},
                ${variant.sectionType ?? "verse"},
                ${i + 1},
                'finish_the_lyric',
                ${lyricText},
                ${fits.low_fit}, ${fits.medium_fit}, ${fits.hard_fit},
                true, true, true, true,
                ${`Backfilled from legacy lyricVariants index ${i}`},
                'approved', now()
              )
              ON CONFLICT (song_id, lyric_text) DO UPDATE
                SET section_order = EXCLUDED.section_order
              RETURNING id
            `;
            // ON CONFLICT DO UPDATE always returns a row (unlike DO NOTHING).
            // Using a no-op-ish UPDATE so we get the existing row back when
            // it already exists. Within this script, since we just verified
            // no moments exist for this song, this only fires for in-batch
            // duplicates (e.g. variant 1 and variant 3 both produce the
            // same lyric_text — both gameplay items point at the same
            // moment).
            const momentId = m.id;
            insertedMoments++;

            const distractors = Array.isArray(variant.distractors)
              ? variant.distractors
              : [];

            await tx`
              INSERT INTO gameplay_items (
                lyric_moment_id, song_id,
                difficulty, question_type, prompt_format,
                prompt_text, correct_answer,
                distractor_1, distractor_2, distractor_3,
                qa_status, is_active
              ) VALUES (
                ${momentId}, ${song.id},
                ${song.difficulty}, 'finish_the_lyric', 'multiple_choice',
                ${variant.prompt ?? ""}, ${variant.answer ?? ""},
                ${distractors[0] ?? null},
                ${distractors[1] ?? null},
                ${distractors[2] ?? null},
                'passed', true
              )
            `;
            insertedItems++;
          }
        });

        state.songsProcessed++;
        state.momentsInserted += insertedMoments;
        state.itemsInserted += insertedItems;
        if (state.songsProcessed % 100 === 0 || state.songsProcessed <= 10) {
          process.stdout.write(
            `  [done ] song ${song.id} — ${insertedMoments} moments, ${insertedItems} items (${state.songsProcessed}/${state.songsTotal})\n`,
          );
        }
      } catch (err) {
        state.songsFailed++;
        state.failures.push({ songId: song.id, message: err.message });
        process.stderr.write(
          `  [FAIL ] song ${song.id} — ${err.message}\n`,
        );
      }
    },
    CONCURRENCY,
  );

  console.log("\n─── Backfill summary ──────────────────────────────────────");
  console.log(`  songs total considered:              ${state.songsConsidered}`);
  console.log(`  songs skipped (already migrated):    ${state.songsSkippedAlreadyMigrated}`);
  console.log(`  songs skipped (no variants):         ${state.songsSkippedNoVariants}`);
  console.log(`  songs processed (new inserts):       ${state.songsProcessed}`);
  console.log(`  songs FAILED:                        ${state.songsFailed}`);
  console.log(`  lyric_moments inserted:              ${state.momentsInserted}`);
  console.log(`  gameplay_items inserted:             ${state.itemsInserted}`);
  console.log(`  songs flagged in_curated_bank=true:  ${state.inCuratedBankFlagged}`);

  // Live row counts for confirmation.
  const [{ count: lmCount }] =
    await sql`SELECT COUNT(*)::int AS count FROM lyric_moments`;
  const [{ count: giCount }] =
    await sql`SELECT COUNT(*)::int AS count FROM gameplay_items`;
  const [{ count: bankCount }] = await sql`
    SELECT COUNT(*)::int AS count FROM songs WHERE in_curated_bank = true
  `;
  console.log(`\n  current lyric_moments row count:     ${lmCount}`);
  console.log(`  current gameplay_items row count:    ${giCount}`);
  console.log(`  current songs.in_curated_bank=true:  ${bankCount}`);

  if (state.songsFailed > 0) {
    console.error(`\n${state.songsFailed} song(s) failed. First few:`);
    for (const f of state.failures.slice(0, 5)) {
      console.error(`  song ${f.songId}: ${f.message}`);
    }
    process.exitCode = 1;
  }
} catch (err) {
  console.error("Backfill aborted:", err.message);
  console.error(err.stack);
  process.exitCode = 1;
} finally {
  await sql.end();
}
