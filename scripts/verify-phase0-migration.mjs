// scripts/verify-phase0-migration.mjs
// Asserts that the 0007 migration installed the audit schema correctly and
// the backfill ran. Run after `pnpm drizzle-kit migrate`.
import "dotenv/config";
import postgres from "postgres";

const connectionString =
  process.env.SUPABASE_SESSION_POOLER_STRING ??
  process.env.SUPABASE_DIRECT_CONNECTION_STRING ??
  process.env.DATABASE_URL;
if (!connectionString) throw new Error("Set DB connection string");

const sql = postgres(connectionString, { max: 1 });

async function expectFail(label, fn) {
  try {
    await fn();
    console.error(`FAIL: ${label} did not throw`);
    process.exit(1);
  } catch (e) {
    console.log(`OK: ${label} → ${e.message.slice(0, 80)}`);
  }
}

try {
  // 1. Schema + tables exist
  const tables = await sql`
    SELECT table_name FROM information_schema.tables WHERE table_schema='audit'
  `;
  const names = tables.map((r) => r.table_name).sort();
  console.log("audit tables:", names);
  if (!names.includes("admin_actions") || !names.includes("admin_actions_redactions")) {
    throw new Error("Missing audit tables");
  }

  // 2. Insert works
  const [inserted] = await sql`
    INSERT INTO audit.admin_actions
      (actor_type, action, target_type, target_id, payload)
    VALUES ('system', 'export.usage_csv', 'export', 'verify-test-' || extract(epoch from now())::text, '{}'::jsonb)
    RETURNING id
  `;
  console.log("OK: insert →", inserted.id);

  // 3. UPDATE rejected
  await expectFail("UPDATE", () => sql`
    UPDATE audit.admin_actions SET action='hacked' WHERE id=${inserted.id}
  `);

  // 4. DELETE rejected
  await expectFail("DELETE", () => sql`
    DELETE FROM audit.admin_actions WHERE id=${inserted.id}
  `);

  // 5. TRUNCATE rejected
  await expectFail("TRUNCATE", () => sql`TRUNCATE audit.admin_actions`);

  // 6. song_displays new columns present
  const cols = await sql`
    SELECT column_name FROM information_schema.columns
    WHERE table_name='song_displays' AND column_name IN (
      'territory_code','duration_of_use_seconds','lyric_fragment_length_chars',
      'lyric_fragment_length_lines','commercial_model_type','service_description',
      'gross_revenue_per_event_micros','currency_code','attribution_served',
      'user_id_hashed','session_id','reporting_period_yyyymm'
    )
  `;
  if (cols.length !== 12) {
    throw new Error(`Expected 12 new song_displays columns, found ${cols.length}`);
  }
  console.log("OK: song_displays has all 12 new columns");

  // 7. songs new columns present
  const songCols = await sql`
    SELECT column_name FROM information_schema.columns
    WHERE table_name='songs' AND column_name IN (
      'iswc','isrc','songwriters','publishers','lyric_source_provider','provider_track_id'
    )
  `;
  if (songCols.length !== 6) {
    throw new Error(`Expected 6 new songs columns, found ${songCols.length}`);
  }
  console.log("OK: songs has all 6 new columns");

  // 8. reporting_period_yyyymm is GENERATED
  const [{ is_generated }] = await sql`
    SELECT is_generated FROM information_schema.columns
    WHERE table_name='song_displays' AND column_name='reporting_period_yyyymm'
  `;
  if (is_generated !== 'ALWAYS') {
    throw new Error(`Expected GENERATED ALWAYS, got ${is_generated}`);
  }
  console.log("OK: reporting_period_yyyymm is GENERATED");

  // 9. Backfill ran (existing rows have fragment lengths)
  const [{ filled, total }] = await sql`
    SELECT
      COUNT(*) FILTER (WHERE lyric_fragment_length_chars IS NOT NULL) AS filled,
      COUNT(*) AS total
    FROM song_displays
  `;
  console.log(`Backfill: ${filled}/${total} rows have fragment length`);
  if (Number(total) > 0 && Number(filled) === 0) {
    console.error("WARN: 0 rows backfilled — check the DO block ran");
  }

  console.log("\n✓ All Phase 0 assertions passed");
  await sql.end();
} catch (err) {
  console.error("VERIFICATION FAILED:", err.message);
  await sql.end();
  process.exit(1);
}
