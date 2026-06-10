// scripts/apply-gn-economy-migration.mjs
// Applies drizzle/0020_gn_economy.sql to Supabase via postgres-js.
//
// Why non-transactional: ALTER TYPE ADD VALUE cannot run inside a transaction
// in Postgres. The entire file is executed as a single non-transactional batch
// (sql.unsafe(ddl).simple()) — every statement is idempotent (IF NOT EXISTS /
// ON CONFLICT guards). See scripts/apply-answer-method-mc-migration.mjs for
// the precedent pattern used in this project.
//
// IMPORTANT: this script never reads or echoes .env values — callers must set
// the connection env var before running. The local DB is production.
//
// Usage:
//   node scripts/apply-gn-economy-migration.mjs --dry-run
//   node scripts/apply-gn-economy-migration.mjs

import postgres from "postgres";
import dotenv from "dotenv";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

dotenv.config();

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const MIGRATION_PATH = path.join(__dirname, "..", "drizzle", "0020_gn_economy.sql");

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
  console.log("  Note: file is applied non-transactionally (ALTER TYPE ADD VALUE requirement).");
  console.log("  Statements are idempotent (IF NOT EXISTS / ON CONFLICT guards throughout).");
  process.exit(0);
}

const sql = postgres(DB_URL, { max: 1, prepare: false });

try {
  console.log(`Applying ${path.basename(MIGRATION_PATH)} (non-transactional — ALTER TYPE ADD VALUE requirement) ...`);
  // Must NOT be wrapped in BEGIN/COMMIT — ALTER TYPE ADD VALUE is
  // non-transactional in Postgres and will error inside an explicit transaction.
  await sql.unsafe(fileContent).simple();
  console.log("Migration applied.");

  // ── Post-apply verification (hard-fail on missing objects) ──────────────────

  // 1. New columns on golden_note_balances
  const balanceCols = await sql`
    SELECT column_name
    FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'golden_note_balances'
      AND column_name IN ('earnedBalance', 'purchasedBalance')
    ORDER BY column_name`;
  if (balanceCols.length !== 2) {
    console.error(`VERIFICATION FAILED: expected earnedBalance + purchasedBalance on golden_note_balances, found: ${balanceCols.map(r => r.column_name).join(", ") || "(none)"}`);
    process.exit(1);
  }
  console.log(`  golden_note_balances: earnedBalance, purchasedBalance — OK`);

  // 2. idempotencyKey on golden_note_transactions
  const txnCols = await sql`
    SELECT column_name
    FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'golden_note_transactions'
      AND column_name = 'idempotencyKey'`;
  if (txnCols.length !== 1) {
    console.error("VERIFICATION FAILED: idempotencyKey column missing from golden_note_transactions");
    process.exit(1);
  }
  console.log(`  golden_note_transactions: idempotencyKey — OK`);

  // 3. gn_stakes table exists
  const stakesTable = await sql`SELECT to_regclass('public.gn_stakes') AS oid`;
  if (!stakesTable[0]?.oid) {
    console.error("VERIFICATION FAILED: gn_stakes table does not exist");
    process.exit(1);
  }
  console.log(`  gn_stakes table — OK`);

  // 4. New enum values on golden_note_transaction_kind
  const expectedKinds = [
    "stake_escrow", "stake_win", "stake_refund",
    "signup_grant", "spend_hint", "spend_streak_insurance", "spend_practice_pack",
  ];
  const kindRows = await sql`
    SELECT enumlabel FROM pg_enum
    JOIN pg_type ON pg_enum.enumtypid = pg_type.oid
    WHERE pg_type.typname = 'golden_note_transaction_kind'
    ORDER BY enumsortorder`;
  const presentKinds = new Set(kindRows.map(r => r.enumlabel));
  const missingKinds = expectedKinds.filter(k => !presentKinds.has(k));
  if (missingKinds.length > 0) {
    console.error(`VERIFICATION FAILED: missing golden_note_transaction_kind values: ${missingKinds.join(", ")}`);
    process.exit(1);
  }
  console.log(`  golden_note_transaction_kind enum values (new): ${expectedKinds.join(", ")} — OK`);

  // 5. gn_stake_state enum exists
  const stakeStateRows = await sql`
    SELECT enumlabel FROM pg_enum
    JOIN pg_type ON pg_enum.enumtypid = pg_type.oid
    WHERE pg_type.typname = 'gn_stake_state'
    ORDER BY enumsortorder`;
  const expectedStates = ["active", "settled", "refunded"];
  const missingStates = expectedStates.filter(s => !stakeStateRows.map(r => r.enumlabel).includes(s));
  if (missingStates.length > 0) {
    console.error(`VERIFICATION FAILED: missing gn_stake_state enum values: ${missingStates.join(", ")}`);
    process.exit(1);
  }
  console.log(`  gn_stake_state enum: ${expectedStates.join(", ")} — OK`);

  // 6. Partial unique index on golden_note_transactions.idempotencyKey
  const idemIdx = await sql`SELECT indexname FROM pg_indexes WHERE tablename = 'golden_note_transactions' AND indexname = 'golden_note_transactions_idem'`;
  if (idemIdx.length !== 1) {
    console.error("VERIFICATION FAILED: missing partial unique index golden_note_transactions_idem");
    process.exit(1);
  }
  console.log(`  golden_note_transactions_idem (partial unique index) — OK`);

  console.log("\nAll verifications passed. Migration 0020 applied successfully.");
} catch (err) {
  console.error("Migration FAILED.");
  console.error(err.message ?? err);
  process.exit(1);
} finally {
  await sql.end();
}
