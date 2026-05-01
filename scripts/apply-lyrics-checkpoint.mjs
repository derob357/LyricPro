// scripts/apply-lyrics-checkpoint.mjs
// Applies regenerate-lyrics.checkpoint.json to the songs table.
// Snapshots songs to songs_backup_pre_rewrite first (drop+recreate) for rollback.
//
// Usage:
//   node scripts/apply-lyrics-checkpoint.mjs           # apply all successful rewrites
//   node scripts/apply-lyrics-checkpoint.mjs --dry     # print stats without writing

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

await sql.end();
