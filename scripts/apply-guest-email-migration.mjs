// scripts/apply-guest-email-migration.mjs
// Applies drizzle/0014_guest_email.sql to Supabase via postgres-js.
//
// Why a custom apply script: this project's migration journal
// (drizzle/meta/_journal.json) has historically not been kept in sync
// with the migrations applied to production. The team applies hand-
// authored SQL files directly. This script matches that pattern —
// see scripts/apply-chat-foundation-migration.mjs for the precedent.
//
// Usage:
//   node scripts/apply-guest-email-migration.mjs --dry-run
//   node scripts/apply-guest-email-migration.mjs

import postgres from "postgres";
import dotenv from "dotenv";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

dotenv.config();

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const MIGRATION_PATH = path.join(__dirname, "..", "drizzle", "0014_guest_email.sql");

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
  console.log(`  ALTER TABLE: ${(fileContent.match(/ALTER TABLE/gi) || []).length}`);
  process.exit(0);
}

const sql = postgres(DB_URL, { max: 1, prepare: false });

try {
  console.log(`Applying ${path.basename(MIGRATION_PATH)} in a single transaction ...`);
  const wrapped = `BEGIN;\n${fileContent}\nCOMMIT;`;
  await sql.unsafe(wrapped).simple();
  console.log("Migration applied successfully.");

  // Verification: confirm the email column now exists on guest_sessions.
  const rows = await sql`
    SELECT column_name, data_type, character_maximum_length, is_nullable
    FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'guest_sessions' AND column_name = 'email'
  `;
  if (rows.length === 1) {
    const c = rows[0];
    console.log(`Verified guest_sessions.email: ${c.data_type}(${c.character_maximum_length}) nullable=${c.is_nullable}`);
  } else {
    console.error(`UNEXPECTED: guest_sessions.email column not found after migration`);
    process.exit(2);
  }
} catch (err) {
  console.error("Migration FAILED.");
  console.error(err.message ?? err);
  process.exit(1);
} finally {
  await sql.end();
}
