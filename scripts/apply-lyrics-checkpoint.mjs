// scripts/apply-lyrics-checkpoint.mjs
// Applies regenerate-lyrics.checkpoint.json to the songs table.
// Snapshots songs to songs_backup_pre_rewrite first (drop+recreate) for rollback.
//
// Phase 5d note: this is the script where regenerate-lyrics' rewrites
// actually hit the DB. Because the SEED (lyricPrompt / lyricAnswer /
// distractors / lyricSectionType) is now changing, any existing layer-3
// rows for that song are stale — variant[0] in songs.lyricVariants is
// derived from the seed by seed-lyric-variants.mjs, and gameplay_items
// rows for variant[0] still reflect the OLD seed. We DELETE the song's
// layer-3 rows here so the dual-write inside seed-lyric-variants.mjs and
// generate-lyric-variants.mjs rebuilds them from the new seed.
//
// Usage:
//   node scripts/apply-lyrics-checkpoint.mjs           # apply all successful rewrites
//   node scripts/apply-lyrics-checkpoint.mjs --dry     # print stats without writing

import postgres from "postgres";
import dotenv from "dotenv";
import fs from "node:fs";
import path from "node:path";

import { clearSongLayer3 } from "./_lib/dual-write-variants.mjs";

dotenv.config();

const DB_URL =
  process.env.SUPABASE_SESSION_POOLER_STRING ??
  process.env.SUPABASE_DIRECT_CONNECTION_STRING ??
  process.env.DATABASE_URL;
if (!DB_URL) {
  console.error("Set SUPABASE_SESSION_POOLER_STRING in .env");
  process.exit(1);
}

const CHECKPOINT_PATH = path.resolve("scripts/regenerate-lyrics.checkpoint.json");
if (!fs.existsSync(CHECKPOINT_PATH)) {
  console.error("Checkpoint not found. Run regenerate-lyrics.mjs first.");
  process.exit(1);
}

const cp = JSON.parse(fs.readFileSync(CHECKPOINT_PATH, "utf8"));
const all = Object.values(cp.results);
const successes = all.filter((r) => !r.error && r.rewritten);
const errors = all.filter((r) => r.error);

console.log(`Checkpoint contains ${all.length} entries.`);
console.log(`  successes: ${successes.length}`);
console.log(`  errors:    ${errors.length}`);

const isDry = process.argv.includes("--dry");
if (isDry) {
  console.log("Dry-run: no DB changes.");
  process.exit(0);
}

const sql = postgres(DB_URL, { max: 2 });

console.log("Snapshotting songs → songs_backup_pre_rewrite ...");
await sql`DROP TABLE IF EXISTS songs_backup_pre_rewrite`;
await sql`CREATE TABLE songs_backup_pre_rewrite AS SELECT * FROM songs`;
console.log("Snapshot created.");

console.log(`Applying ${successes.length} rewrites in one transaction ...`);
await sql.begin(async (tx) => {
  for (const r of successes) {
    await tx`
      UPDATE songs
      SET "lyricPrompt" = ${r.rewritten.prompt},
          "lyricAnswer" = ${r.rewritten.answer},
          distractors  = ${JSON.stringify(r.rewritten.distractors)}::jsonb
      WHERE id = ${r.id}
    `;
  }
});
console.log(`Applied ${successes.length} rewrites successfully.`);

// Phase 5d: invalidate layer-3 rows for any song whose seed just changed.
// Done OUTSIDE the rewrite transaction because each clear is its own
// transaction and we don't want a single layer-3 hiccup to roll back the
// entire seed rewrite (the seed is the source of truth; layer-3 will be
// rebuilt by the next seed-lyric-variants + generate-lyric-variants run).
console.log(
  `Clearing layer-3 (lyric_moments + gameplay_items) for ${successes.length} songs whose seeds changed ...`,
);
let clearedCount = 0;
let clearFailures = 0;
for (const r of successes) {
  try {
    await clearSongLayer3(sql, r.id);
    clearedCount++;
  } catch (err) {
    clearFailures++;
    console.warn(
      `  WARN: clearSongLayer3 failed for song ${r.id}: ${String(err?.message ?? err)}`,
    );
  }
}
console.log(
  `Cleared layer-3 for ${clearedCount} songs (${clearFailures} failures). Re-run seed-lyric-variants + generate-lyric-variants to rebuild layer-3.`,
);

await sql.end();
