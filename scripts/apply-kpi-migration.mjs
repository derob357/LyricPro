// scripts/apply-kpi-migration.mjs
// Generic runner for the KPI rollup migrations.
// Usage: node scripts/apply-kpi-migration.mjs <path-to-sql> [--dry-run]
// Executes the whole file in one implicit transaction (no statement
// splitting — function bodies contain semicolons).
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
const DRY_RUN = args.includes("--dry-run") || args.includes("--dry");
const sqlFile = args.find((a) => !a.startsWith("--"));
if (!sqlFile) {
  console.error("Usage: node scripts/apply-kpi-migration.mjs <path-to-sql> [--dry-run]");
  process.exit(1);
}

const content = fs.readFileSync(path.resolve(sqlFile), "utf8");
console.log(`Migration: ${sqlFile} (${content.length} chars)`);

if (DRY_RUN) {
  console.log("--- DRY RUN: first 40 lines ---");
  console.log(content.split("\n").slice(0, 40).join("\n"));
  console.log("--- no statements executed ---");
  process.exit(0);
}

const sql = postgres(DB_URL, { max: 1, prepare: false });
try {
  await sql.unsafe(content);
  console.log("Applied OK.");
} catch (err) {
  console.error("FAILED:", err.message);
  process.exitCode = 1;
} finally {
  await sql.end();
}
