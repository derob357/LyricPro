// scripts/backfill-song-displays.mjs
// Seeds song_displays + the songs.displayCount/lastShownAt aggregates from
// the historical gameRooms.usedSongIds JSON.
//
// Per-row strategy:
//   - For each game room, read usedSongIds (JSON array of song IDs).
//   - For each (index, songId) pair, INSERT one song_displays row with:
//       songId      = songId
//       userId      = room.hostUserId         (null when host was a guest)
//       guestToken  = room.hostGuestToken     (null when host was authed)
//       roomCode    = room.roomCode
//       variantIndex = 0
//       shownAt     = room.createdAt + index * 30s   (rough proxy)
//   - After all inserts complete, UPDATE songs.displayCount + lastShownAt
//     by aggregating song_displays.
//
// Limitations:
//   - We attribute every round to the room HOST. Per-player attribution
//     would require joining round_results, which we accept losing for
//     historical rows. New rounds (post-commit-3) record the actual
//     identity per round.
//   - The 30s spacing is illustrative only; the dedup window only cares
//     about "within last 10 days", not exact timing.
//
// Usage:
//   node scripts/backfill-song-displays.mjs --dry-run
//   node scripts/backfill-song-displays.mjs

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

const DRY_RUN =
  process.argv.includes("--dry-run") || process.argv.includes("--dry");

function parseUsedSongIds(raw) {
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed.filter((n) => Number.isInteger(n));
  } catch {
    return [];
  }
}

async function main() {
  const sql = postgres(DB_URL, { max: 4 });

  const rooms = await sql`
    SELECT id, "roomCode", "hostUserId", "hostGuestToken",
           "usedSongIds", "createdAt"
    FROM game_rooms
    ORDER BY id ASC
  `;

  const rows = []; // { songId, userId, guestToken, roomCode, shownAt }
  const songIdsTouched = new Set();
  let roomsProcessed = 0;
  let roomsWithDisplays = 0;

  for (const room of rooms) {
    roomsProcessed += 1;
    const ids = parseUsedSongIds(room.usedSongIds);
    if (ids.length === 0) continue;
    roomsWithDisplays += 1;

    const baseTime = room.createdAt instanceof Date
      ? room.createdAt
      : new Date(room.createdAt);

    ids.forEach((songId, index) => {
      const shownAt = new Date(baseTime.getTime() + index * 30_000);
      rows.push({
        songId,
        userId: room.hostUserId ?? null,
        guestToken: room.hostGuestToken
          ? String(room.hostGuestToken).slice(0, 64)
          : null,
        roomCode: room.roomCode ?? null,
        shownAt,
      });
      songIdsTouched.add(songId);
    });
  }

  console.log("─── Backfill plan ───");
  console.log(`Rooms scanned:           ${roomsProcessed}`);
  console.log(`Rooms with usedSongIds:  ${roomsWithDisplays}`);
  console.log(`song_displays to insert: ${rows.length}`);
  console.log(`distinct songs touched:  ${songIdsTouched.size}`);

  if (DRY_RUN) {
    console.log("\nDry-run. No DB writes.");
    if (rows.length > 0) {
      console.log("\nFirst 5 rows that would be inserted:");
      for (const r of rows.slice(0, 5)) {
        console.log(
          `  song=${r.songId} user=${r.userId ?? "-"} guest=${
            r.guestToken ? r.guestToken.slice(0, 8) + "…" : "-"
          } room=${r.roomCode ?? "-"} at=${r.shownAt.toISOString()}`,
        );
      }
    }
    await sql.end();
    return;
  }

  console.log("\nWriting song_displays in a single transaction ...");
  const BATCH = 500;
  await sql.begin(async (tx) => {
    for (let i = 0; i < rows.length; i += BATCH) {
      const slice = rows.slice(i, i + BATCH);
      // postgres-js multi-row insert via tx``
      await tx`
        INSERT INTO song_displays
          ("songId", "userId", "guestToken", "roomCode", "variantIndex", "shownAt")
        VALUES ${tx(
          slice.map((r) => [
            r.songId,
            r.userId,
            r.guestToken,
            r.roomCode,
            0,
            r.shownAt,
          ]),
        )}
      `;
    }
  });
  console.log(`Inserted ${rows.length} song_displays rows.`);

  console.log("Refreshing songs.displayCount + lastShownAt aggregates ...");
  await sql`
    UPDATE songs s
    SET "displayCount" = COALESCE(agg.cnt, 0),
        "lastShownAt"  = agg.last_shown
    FROM (
      SELECT "songId", COUNT(*)::int AS cnt, MAX("shownAt") AS last_shown
      FROM song_displays
      GROUP BY "songId"
    ) AS agg
    WHERE s.id = agg."songId"
  `;
  console.log("Aggregates refreshed.");

  await sql.end();
}

main().catch((err) => {
  console.error("Backfill failed:", err);
  process.exit(1);
});
