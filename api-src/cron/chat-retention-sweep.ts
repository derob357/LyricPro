// Nightly retention sweep. Hard-deletes chat_messages that are past their
// room's retention window. Tournament rooms get an extended grace period
// of `tournaments.ends_at + 30 days` for completed/cancelled status only;
// active tournaments retain their messages indefinitely.
//
// Triggered by Vercel Cron — see vercel.json.
// Auth: the CRON_SECRET env var must match the Authorization header.
import type { VercelRequest, VercelResponse } from "@vercel/node";
import { getDb } from "../../server/db";
import { sql } from "drizzle-orm";

export default async function handler(req: VercelRequest, res: VercelResponse): Promise<void> {
  // Vercel Cron sends the secret in `Authorization: Bearer <CRON_SECRET>`.
  const expected = process.env.CRON_SECRET;
  const provided = req.headers.authorization?.replace(/^Bearer\s+/i, "");
  if (!expected || provided !== expected) {
    res.status(401).json({ ok: false, error: "unauthorized" });
    return;
  }

  const db = await getDb();
  if (!db) {
    res.status(500).json({ ok: false, error: "db unavailable" });
    return;
  }

  // Global + Friends — uniform 14-day window.
  const globalFriendsDeleted = await db.execute(sql`
    DELETE FROM chat_messages
    WHERE scope IN ('global', 'friends')
      AND "createdAt" < NOW() - INTERVAL '14 days'
      AND deleted_at IS NULL
    RETURNING id
  `);

  // Tournament rooms — purge only completed/cancelled tournaments past their
  // 30-day grace period. Active tournaments retain messages indefinitely.
  const tournamentDeleted = await db.execute(sql`
    DELETE FROM chat_messages
    WHERE scope = 'tournament'
      AND room_id IN (
        SELECT chat_room_id FROM tournaments
        WHERE status IN ('completed', 'cancelled')
          AND ends_at + INTERVAL '30 days' < NOW()
      )
    RETURNING id
  `);

  const counts = {
    globalFriends: Array.isArray(globalFriendsDeleted)
      ? globalFriendsDeleted.length
      : (globalFriendsDeleted as { rowCount?: number }).rowCount ?? 0,
    tournament: Array.isArray(tournamentDeleted)
      ? tournamentDeleted.length
      : (tournamentDeleted as { rowCount?: number }).rowCount ?? 0,
  };

  res.status(200).json({ ok: true, deleted: counts });
}

export const config = { maxDuration: 60 };
