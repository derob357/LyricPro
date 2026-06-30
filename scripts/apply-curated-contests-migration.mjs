// scripts/apply-curated-contests-migration.mjs
// Applies drizzle/0001_curated_contests.sql to Supabase via postgres-js.
//
// Why a custom apply script: this project's migration journal
// (drizzle/meta/_journal.json) has historically not been kept in sync with the
// migrations applied to production, so `drizzle-kit migrate` would replay
// 0000_baseline and re-CREATE existing tables. The team applies the reviewed
// SQL file directly, in one transaction — see apply-match-realtime-migration.mjs
// for the precedent. `db:push` is intentionally disabled for the same reason.
//
// This migration is purely additive:
//   - CREATE TYPE curated_set_status
//   - CREATE TABLE curated_song_sets
//   - ALTER TABLE game_rooms ADD COLUMN customPackVariants jsonb
//
// Usage:
//   node scripts/apply-curated-contests-migration.mjs --dry-run
//   node scripts/apply-curated-contests-migration.mjs

import postgres from "postgres";
import dotenv from "dotenv";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

dotenv.config();

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const MIGRATION_PATH = path.join(__dirname, "..", "drizzle", "0001_curated_contests.sql");

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
    "CREATE TYPE": (fileContent.match(/CREATE TYPE/gi) || []).length,
    "CREATE TABLE": (fileContent.match(/CREATE TABLE/gi) || []).length,
    "ALTER TABLE": (fileContent.match(/ALTER TABLE/gi) || []).length,
  };
  for (const [k, v] of Object.entries(counts)) console.log(`  ${k}: ${v}`);
  process.exit(0);
}

const sql = postgres(DB_URL, { max: 1, prepare: false });

try {
  // Pre-flight: the ADD COLUMN target must exist, and none of the new objects
  // may exist yet (re-running a partially-applied migration would throw mid-
  // transaction; abort early with a clear message instead).
  const [gameRooms] = await sql`SELECT to_regclass('public.game_rooms') AS oid`;
  if (!gameRooms.oid) {
    console.error("FATAL: table game_rooms not found — wrong database or baseline not applied. Aborting.");
    process.exit(1);
  }

  const [tbl] = await sql`SELECT to_regclass('public.curated_song_sets') AS oid`;
  const typeRows = await sql`SELECT 1 FROM pg_type WHERE typname = 'curated_set_status'`;
  const colRows = await sql`
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'game_rooms' AND column_name = 'customPackVariants'`;
  const already = [];
  if (tbl.oid) already.push("table curated_song_sets");
  if (typeRows.length) already.push("type curated_set_status");
  if (colRows.length) already.push("column game_rooms.customPackVariants");
  if (already.length) {
    console.error(`Already present, nothing to do (or partially applied): ${already.join(", ")}.`);
    console.error("Aborting to avoid a mid-transaction failure. Inspect the DB if this is unexpected.");
    process.exit(1);
  }
  console.log("Pre-flight OK: game_rooms exists; curated objects not yet present.");

  console.log(`Applying ${path.basename(MIGRATION_PATH)} in a single transaction ...`);
  const wrapped = `BEGIN;\n${fileContent}\nCOMMIT;`;
  await sql.unsafe(wrapped).simple();
  console.log("Migration applied successfully.");

  // Verification: confirm the type, table, and column now exist.
  const [vTbl] = await sql`SELECT to_regclass('public.curated_song_sets') AS oid`;
  const vType = await sql`SELECT 1 FROM pg_type WHERE typname = 'curated_set_status'`;
  const vCol = await sql`
    SELECT data_type FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'game_rooms' AND column_name = 'customPackVariants'`;
  console.log(`Verified: curated_song_sets=${vTbl.oid ? "yes" : "NO"}, ` +
    `curated_set_status=${vType.length ? "yes" : "NO"}, ` +
    `game_rooms.customPackVariants=${vCol.length ? vCol[0].data_type : "NO"}`);
  if (!vTbl.oid || !vType.length || !vCol.length) {
    console.error("Post-apply verification FAILED — expected objects missing.");
    process.exit(1);
  }
} catch (err) {
  console.error("Migration FAILED.");
  console.error(err.message ?? err);
  process.exit(1);
} finally {
  await sql.end();
}
