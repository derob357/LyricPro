// scripts/apply-match-realtime-migration.mjs
// Applies drizzle/0016_match_realtime.sql to Supabase via postgres-js.
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
//   node scripts/apply-match-realtime-migration.mjs --dry-run
//   node scripts/apply-match-realtime-migration.mjs

import postgres from "postgres";
import dotenv from "dotenv";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

dotenv.config();

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const MIGRATION_PATH = path.join(__dirname, "..", "drizzle", "0016_match_realtime.sql");

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
  // Pre-flight: round_results_broadcast uses realtime.send(). If this DB's
  // realtime extension predates it, the trigger would CREATE fine but THROW on
  // every round_results insert (breaking submitAnswer). Abort before applying.
  const sendCheck = await sql`
    SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'realtime' AND p.proname = 'send'`;
  if (sendCheck.length === 0) {
    console.error("FATAL: realtime.send not found in this database.");
    console.error("The round_results_broadcast trigger would throw on every answer insert.");
    console.error("Upgrade Supabase Realtime, or switch the trigger to broadcast_changes, before applying.");
    process.exit(1);
  }
  console.log("Pre-flight OK: realtime.send is available.");

  console.log(`Applying ${path.basename(MIGRATION_PATH)} in a single transaction ...`);
  // Wrap the entire file in BEGIN/COMMIT so it's all-or-nothing.
  // postgres-js .simple() lets multi-statement SQL execute as one call.
  const wrapped = `BEGIN;\n${fileContent}\nCOMMIT;`;
  await sql.unsafe(wrapped).simple();
  console.log("Migration applied successfully.");

  // Verification: confirm both broadcast triggers exist
  const rows = await sql`SELECT tgname FROM pg_trigger WHERE tgname IN ('game_rooms_broadcast_trg','round_results_broadcast_trg') ORDER BY tgname`;
  console.log(`Verified triggers: ${rows.map(r => r.tgname).join(', ')}`);
} catch (err) {
  console.error("Migration FAILED.");
  console.error(err.message ?? err);
  process.exit(1);
} finally {
  await sql.end();
}
