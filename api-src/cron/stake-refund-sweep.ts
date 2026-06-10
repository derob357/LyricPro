// Hourly abandonment sweep. Refunds GN stakes whose game never finished
// within the ABANDON_HOURS cutoff defined in stakeMath.ts.
//
// Triggered by Vercel Cron — see vercel.json.
// Auth: the CRON_SECRET env var must match the Authorization header.
import type { VercelRequest, VercelResponse } from "@vercel/node";
import { getDb } from "../../server/db";
import { sweepAbandonedStakes } from "../../server/_core/stakeEngine";

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

  const { refunded } = await sweepAbandonedStakes(db);

  res.status(200).json({ ok: true, refunded });
}

export const config = { maxDuration: 60 };
