// scripts/apply-marketing-consent-migration.mjs
// Applies drizzle/0019_marketing_consent.sql to Supabase via postgres-js.
//
// Why a custom apply script: this project's migration journal
// (drizzle/meta/_journal.json) has historically not been kept in sync
// with the migrations applied to production. The team applies hand-
// authored SQL files directly. This script matches that pattern —
// see scripts/apply-lyric-variants-migration.mjs for the precedent.
//
// The file is plain transactional DDL (ALTER TABLE … ADD COLUMN IF NOT EXISTS),
// so it is safe to wrap in a single BEGIN/COMMIT transaction.
//
// Usage:
//   node scripts/apply-marketing-consent-migration.mjs --dry-run
//   node scripts/apply-marketing-consent-migration.mjs

import postgres from "postgres";
import dotenv from "dotenv";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

dotenv.config();

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const MIGRATION_PATH = path.join(__dirname, "..", "drizzle", "0019_marketing_consent.sql");

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
    "ADD COLUMN":  (fileContent.match(/ADD COLUMN/gi) || []).length,
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
  await sql.begin(async (tx) => {
    await tx.unsafe(fileContent).simple();
  });
  console.log("Migration applied successfully.");

  // Verification: confirm the new columns exist on both tables
  const rows = await sql`
    SELECT table_name, column_name
    FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name IN ('guest_sessions', 'users')
      AND column_name IN ('marketingOptIn', 'consentedAt', 'consentWordingVersion', 'consentSource', 'consentIp')
    ORDER BY table_name, column_name`;
  console.log(`Verified ${rows.length} consent columns present:`);
  for (const r of rows) {
    console.log(`  ${r.table_name}.${r.column_name}`);
  }
} catch (err) {
  console.error("Migration FAILED.");
  console.error(err.message ?? err);
  process.exit(1);
} finally {
  await sql.end();
}
