// scripts/apply-answer-method-mc-migration.mjs
// Applies drizzle/0018_answer_method_mc.sql — adds "mc" to the answer_method
// Postgres enum so submitAnswer can record multiple-choice picks.
//
// IMPORTANT: ALTER TYPE ... ADD VALUE cannot run inside a transaction in
// Postgres. This script applies the statement WITHOUT wrapping it in
// BEGIN/COMMIT.
//
// Usage:
//   node scripts/apply-answer-method-mc-migration.mjs --dry-run
//   node scripts/apply-answer-method-mc-migration.mjs

import postgres from "postgres";
import dotenv from "dotenv";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

dotenv.config();

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const MIGRATION_PATH = path.join(__dirname, "..", "drizzle", "0018_answer_method_mc.sql");

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
  console.log(`  File size: ${fileContent.length} bytes`);
  console.log("  Note: ALTER TYPE ADD VALUE is NOT wrapped in a transaction (Postgres limitation).");
  process.exit(0);
}

const sql = postgres(DB_URL, { max: 1, prepare: false });

try {
  console.log(`Applying ${path.basename(MIGRATION_PATH)} (no transaction — ALTER TYPE ADD VALUE requirement) ...`);
  // Must NOT be wrapped in BEGIN/COMMIT — ALTER TYPE ADD VALUE is
  // non-transactional in Postgres and will error inside an explicit transaction.
  await sql.unsafe(fileContent).simple();
  console.log("Migration applied.");

  // Verify the new value is present in the enum
  const rows = await sql`
    SELECT enumlabel FROM pg_enum
    JOIN pg_type ON pg_enum.enumtypid = pg_type.oid
    WHERE pg_type.typname = 'answer_method'
    ORDER BY enumsortorder`;
  console.log(`answer_method enum values: ${rows.map(r => r.enumlabel).join(', ')}`);
} catch (err) {
  console.error("Migration FAILED.");
  console.error(err.message ?? err);
  process.exit(1);
} finally {
  await sql.end();
}
