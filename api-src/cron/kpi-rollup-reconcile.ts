// api-src/cron/kpi-rollup-reconcile.ts
// Backup trigger + gap alerting for the nightly KPI rollup.
// Primary scheduler is pg_cron job 'kpi-daily-rollup' (07:30 UTC); this runs
// an hour later, re-processes anything pg_cron missed, and surfaces gaps.
//
// Triggered by Vercel Cron — see vercel.json.
// Auth: the CRON_SECRET env var must match the Authorization header.
import type { VercelRequest, VercelResponse } from "@vercel/node";
import { getDb } from "../../server/db";
import { runKpiReconcile } from "../../server/vendor/kpiReconcile";

export default async function handler(req: VercelRequest, res: VercelResponse): Promise<void> {
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

  try {
    const summary = await runKpiReconcile(db);
    if (summary.missingLast7.length > 0) {
      console.error("[kpi-rollup] MISSING DAYS in last 7:", summary.missingLast7.join(", "));
    }
    res.status(200).json({ ok: true, ...summary });
  } catch (err) {
    console.error("[kpi-rollup] reconcile failed:", err);
    res.status(500).json({ ok: false, error: "reconcile failed" });
  }
}

export const config = { maxDuration: 300 };
