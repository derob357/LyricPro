// scripts/backfill-kpi-rollups.mjs
// Backfill KPI rollups day by day (each day = its own transaction, so an
// interruption leaves complete committed days; re-running is idempotent).
// Usage: node scripts/backfill-kpi-rollups.mjs --from 2026-04-03 --to 2026-07-01
import postgres from "postgres";
import dotenv from "dotenv";

dotenv.config();

const DB_URL =
  process.env.SUPABASE_SESSION_POOLER_STRING ??
  process.env.SUPABASE_DIRECT_CONNECTION_STRING ??
  process.env.DATABASE_URL;
if (!DB_URL) {
  console.error("Set SUPABASE_SESSION_POOLER_STRING in .env");
  process.exit(1);
}

function argValue(flag) {
  const i = process.argv.indexOf(flag);
  return i >= 0 ? process.argv[i + 1] : undefined;
}
const from = argValue("--from");
const to = argValue("--to");
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
if (!DATE_RE.test(from ?? "") || !DATE_RE.test(to ?? "") || from > to) {
  console.error("Usage: node scripts/backfill-kpi-rollups.mjs --from YYYY-MM-DD --to YYYY-MM-DD");
  process.exit(1);
}

const sql = postgres(DB_URL, { max: 1, prepare: false });
let ok = 0;
let failed = 0;
try {
  // enumerate days in UTC-safe way (dates only, no TZ math needed)
  for (let d = new Date(`${from}T00:00:00Z`); ; d.setUTCDate(d.getUTCDate() + 1)) {
    const day = d.toISOString().slice(0, 10);
    if (day > to) break;
    try {
      await sql.begin(async (tx) => {
        await tx`SELECT public.rollup_daily_kpis(${day}::date)`;
        await tx`
          INSERT INTO rollup_runs (run_date, status, finished_at)
          VALUES (${day}::date, 'success', now())
        `;
      });
      ok++;
      console.log(`${day} OK`);
    } catch (err) {
      failed++;
      console.error(`${day} FAILED: ${err.message}`);
    }
  }
} finally {
  await sql.end();
}
console.log(`Backfill done: ${ok} ok, ${failed} failed.`);
process.exitCode = failed > 0 ? 1 : 0;
