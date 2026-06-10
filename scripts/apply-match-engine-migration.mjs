// scripts/apply-match-engine-migration.mjs
// Applies drizzle/0015_match_engine.sql to Supabase via postgres-js.
//
// Why a custom apply script: this project's migration journal
// (drizzle/meta/_journal.json) has historically not been kept in sync
// with the migrations applied to production. The team applies hand-
// authored SQL files directly. This script matches that pattern —
// see scripts/apply-lyric-variants-migration.mjs for the precedent.
//
// The file is executed via postgres-js simple protocol so multi-
// statement SQL (including dollar-quoted plpgsql function bodies,
// CREATE TRIGGER, CREATE POLICY) works as one transaction.
//
// Usage:
//   node scripts/apply-match-engine-migration.mjs --dry-run
//   node scripts/apply-match-engine-migration.mjs

import postgres from "postgres";
import dotenv from "dotenv";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

dotenv.config();

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const MIGRATION_PATH = path.join(__dirname, "..", "drizzle", "0015_match_engine.sql");

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
  // Count notable statement kinds for sanity
  const counts = {
    "CREATE TABLE": (fileContent.match(/CREATE TABLE/gi) || []).length,
    "CREATE TYPE": (fileContent.match(/CREATE TYPE/gi) || []).length,
    "CREATE INDEX": (fileContent.match(/CREATE INDEX/gi) || []).length,
    "CREATE POLICY": (fileContent.match(/CREATE POLICY/gi) || []).length,
    "CREATE TRIGGER": (fileContent.match(/CREATE TRIGGER/gi) || []).length,
    "CREATE FUNCTION": (fileContent.match(/CREATE OR REPLACE FUNCTION/gi) || []).length,
    "ALTER TABLE": (fileContent.match(/ALTER TABLE/gi) || []).length,
    "INSERT INTO": (fileContent.match(/INSERT INTO/gi) || []).length,
    "REVOKE": (fileContent.match(/^REVOKE/gim) || []).length,
  };
  for (const [k, v] of Object.entries(counts)) {
    console.log(`  ${k}: ${v}`);
  }
  process.exit(0);
}

const sql = postgres(DB_URL, { max: 1, prepare: false });

try {
  console.log(`Applying ${path.basename(MIGRATION_PATH)} in a single transaction ...`);
  // Wrap the entire file in BEGIN/COMMIT so it's all-or-nothing.
  // postgres-js .simple() lets multi-statement SQL execute as one call.
  const wrapped = `BEGIN;\n${fileContent}\nCOMMIT;`;
  await sql.unsafe(wrapped).simple();
  console.log("Migration applied successfully.");

  // Verification: confirm new game_rooms columns are present
  const rows = await sql`
    SELECT column_name FROM information_schema.columns
    WHERE table_schema='public' AND table_name='game_rooms' AND column_name IN ('roundPhase','roundEndsAt')
    ORDER BY column_name`;
  console.log(`Verified game_rooms columns present: ${rows.map(r => r.column_name).join(', ')}`);
} catch (err) {
  console.error("Migration FAILED.");
  console.error(err.message ?? err);
  process.exit(1);
} finally {
  await sql.end();
}
