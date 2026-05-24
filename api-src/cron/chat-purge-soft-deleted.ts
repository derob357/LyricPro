// Nightly GDPR-safe purge. For messages soft-deleted more than 30 days ago,
// hard-clear the `body` text and mark the deleted_reason. The id, author_id,
// and createdAt are retained so any cross-references (audit log, future
// thread features) don't break.
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

  const result = await db.execute(sql`
    UPDATE chat_messages
    SET body = '[purged]',
        deleted_reason = COALESCE(deleted_reason, '') || ' [body purged at retention]'
    WHERE deleted_at IS NOT NULL
      AND deleted_at < NOW() - INTERVAL '30 days'
      AND body != '[purged]'
    RETURNING id
  `);

  const count = Array.isArray(result)
    ? result.length
    : (result as { rowCount?: number }).rowCount ?? 0;

  res.status(200).json({ ok: true, purged: count });
}

export const config = { maxDuration: 60 };
