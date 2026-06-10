// scripts/apply-match-question-migration.mjs
// Applies drizzle/0017_match_question.sql to Supabase via postgres-js.
//
// Adds "currentQuestion" jsonb column to game_rooms so the multiplayer
// engine can store a stable per-round answer-free MC question payload.
//
// Usage:
//   node scripts/apply-match-question-migration.mjs --dry-run
//   node scripts/apply-match-question-migration.mjs

import postgres from "postgres";
import dotenv from "dotenv";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

dotenv.config();

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const MIGRATION_PATH = path.join(__dirname, "..", "drizzle", "0017_match_question.sql");

const DB_URL =
  process.env.SUPABASE_SESSION_POOLER_STRING ??
  process.env.SUPABASE_DIRECT_CONNECTION_STRING ??
  process.env.DATABASE_URL;
if (!DB_URL) {
  console.error("Set SUPABASE_SESSION_POOLER_STRING (or _DIRECT_CONNECTION_STRING / DATABASE_URL) in .env");
  process.exit(1);
}

const DRY_RUN = process.argv.includes("--dry-run") || process.argv.includes("--dry");

const fileContent = fs.readFileSync(MIGRATION_PATH, "utf8");

if (DRY_RUN) {
  console.log(`Dry-run. Would apply ${MIGRATION_PATH}`);
  console.log(`  File size: ${fileContent.length} bytes, ${fileContent.split("\n").length} lines`);
  const counts = {
    "ALTER TABLE": (fileContent.match(/ALTER TABLE/gi) || []).length,
  };
  for (const [k, v] of Object.entries(counts)) {
    console.log(`  ${k}: ${v}`);
  }
  process.exit(0);
}

const sql = postgres(DB_URL, { max: 1, prepare: false });

try {
  console.log(`Applying ${path.basename(MIGRATION_PATH)} in a single transaction ...`);
  const wrapped = `BEGIN;\n${fileContent}\nCOMMIT;`;
  await sql.unsafe(wrapped).simple();
  console.log("Migration applied successfully.");

  // Verification: confirm new column is present
  const rows = await sql`
    SELECT column_name FROM information_schema.columns
    WHERE table_schema='public' AND table_name='game_rooms' AND column_name = 'currentQuestion'`;
  if (rows.length > 0) {
    console.log(`Verified game_rooms column present: currentQuestion`);
  } else {
    console.warn("WARNING: currentQuestion column not found after migration — check the SQL file.");
    process.exit(1);
  }
} catch (err) {
  console.error("Migration FAILED.");
  console.error(err.message ?? err);
  process.exit(1);
} finally {
  await sql.end();
}
