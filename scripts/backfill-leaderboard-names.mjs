// scripts/backfill-leaderboard-names.mjs
// One-shot fix for legacy leaderboardEntries rows that were stamped with
// the placeholder "Player" displayName instead of the user's firstName.
//
// Before this script, end-of-game writes used `player.guestName || "Player"`
// — so every authed user landed on the leaderboard as "Player". The
// forward fix now consults users.firstName at insert time. This script
// rewrites the historical rows the same way.
//
// Usage:
//   node scripts/backfill-leaderboard-names.mjs --dry-run
//   node scripts/backfill-leaderboard-names.mjs

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

const DRY_RUN = process.argv.includes("--dry-run");

const sql = postgres(DB_URL, { max: 1 });

async function main() {
  // What's in scope: leaderboardEntries with a userId, currently labeled
  // "Player", whose user has a non-empty firstName. Rows tied to a guest
  // (userId IS NULL) keep whatever the original guestName was.
  const candidates = await sql`
    SELECT le.id, le."userId", le."displayName", u."firstName"
    FROM leaderboard_entries le
    JOIN users u ON u.id = le."userId"
    WHERE le."displayName" = 'Player'
      AND u."firstName" IS NOT NULL
      AND u."firstName" != ''
    ORDER BY le.id
  `;

  console.log(`Candidates: ${candidates.length} leaderboardEntries rows to rename.`);

  if (candidates.length === 0) {
    await sql.end();
    return;
  }

  // Group by user for a tidy preview.
  const byUser = new Map();
  for (const r of candidates) {
    const k = `${r.userId}|${r.firstName}`;
    byUser.set(k, (byUser.get(k) ?? 0) + 1);
  }
  console.log("Per user:");
  for (const [k, n] of byUser.entries()) {
    const [uid, name] = k.split("|");
    console.log(`  user ${uid} (${name}): ${n} row${n === 1 ? "" : "s"}`);
  }

  if (DRY_RUN) {
    console.log("\nDry run. No DB writes.");
    await sql.end();
    return;
  }

  const result = await sql`
    UPDATE leaderboard_entries le
    SET "displayName" = u."firstName"
    FROM users u
    WHERE le."userId" = u.id
      AND le."displayName" = 'Player'
      AND u."firstName" IS NOT NULL
      AND u."firstName" != ''
    RETURNING le.id
  `;
  console.log(`\nUpdated ${result.length} rows.`);

  await sql.end();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
