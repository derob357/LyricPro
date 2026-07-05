// scripts/verify-kpi-rollups.mjs
// Spot-check rollup values against direct raw-table queries for one day.
// Usage: node scripts/verify-kpi-rollups.mjs --day 2026-07-01
import postgres from "postgres";
import dotenv from "dotenv";

dotenv.config();

const DB_URL =
  process.env.SUPABASE_SESSION_POOLER_STRING ??
  process.env.SUPABASE_DIRECT_CONNECTION_STRING ??
  process.env.DATABASE_URL;
const i = process.argv.indexOf("--day");
const day = i >= 0 ? process.argv[i + 1] : undefined;
if (!DB_URL || !/^\d{4}-\d{2}-\d{2}$/.test(day ?? "")) {
  console.error("Usage: node scripts/verify-kpi-rollups.mjs --day YYYY-MM-DD");
  process.exit(1);
}

const sql = postgres(DB_URL, { max: 1, prepare: false });
try {
  const rolled = Object.fromEntries(
    (await sql`
      SELECT metric, value FROM kpi_daily_metrics
      WHERE date = ${day}::date AND dimension = 'all'
    `).map((r) => [r.metric, Number(r.value)]),
  );

  const [direct] = await sql`
    WITH bounds AS (
      SELECT ${day}::date::timestamp AT TIME ZONE 'America/New_York' AS s,
             (${day}::date + 1)::timestamp AT TIME ZONE 'America/New_York' AS e
    )
    SELECT
      (SELECT count(DISTINCT COALESCE(x."userId"::text, 'g:' || x."guestToken"))
       FROM (
         SELECT "userId", "guestToken" FROM game_sessions, bounds
           WHERE "startedAt" >= bounds.s AND "startedAt" < bounds.e
         UNION ALL
         SELECT "userId", "guestToken" FROM song_displays, bounds
           WHERE "shownAt" >= bounds.s AND "shownAt" < bounds.e
       ) x WHERE x."userId" IS NOT NULL OR x."guestToken" IS NOT NULL
      )::int AS dau,
      (SELECT count(*) FROM game_sessions, bounds
        WHERE "startedAt" >= bounds.s AND "startedAt" < bounds.e)::int AS sessions,
      (SELECT count(*) FROM song_displays, bounds
        WHERE "shownAt" >= bounds.s AND "shownAt" < bounds.e)::int AS displays
  `;

  let pass = true;
  for (const key of ["dau", "sessions", "displays"]) {
    const match = Number(rolled[key] ?? -1) === Number(direct[key]);
    if (!match) pass = false;
    console.log(`${key}: rollup=${rolled[key] ?? "MISSING"} direct=${direct[key]} ${match ? "MATCH" : "MISMATCH"}`);
  }
  // song-stats displays must sum to the 'displays' metric
  const [{ song_sum }] = await sql`
    SELECT COALESCE(sum(displays), 0)::int AS song_sum
    FROM kpi_daily_song_stats WHERE date = ${day}::date
  `;
  const songMatch = Number(song_sum) === Number(direct.displays);
  if (!songMatch) pass = false;
  console.log(`song_stats displays sum: ${song_sum} vs ${direct.displays} ${songMatch ? "MATCH" : "MISMATCH"}`);

  process.exitCode = pass ? 0 : 1;
} finally {
  await sql.end();
}
