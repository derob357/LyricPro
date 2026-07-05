// server/vendor/kpiReconcile.ts
// Triggers the DB-side KPI rollup reconcile and reports gaps for alerting.
// pg_cron is the primary scheduler; the Vercel cron endpoint below is a
// backup trigger + visibility layer (pg_cron failures are silent).
import { sql } from "drizzle-orm";
import type { getDb } from "../db";

type Db = NonNullable<Awaited<ReturnType<typeof getDb>>>;

export interface KpiReconcileSummary {
  processed: { day: string; status: string }[];
  missingLast7: string[];
}

function toRows(result: unknown): Record<string, unknown>[] {
  return Array.isArray(result)
    ? (result as Record<string, unknown>[])
    : Array.from(result as Iterable<Record<string, unknown>>);
}

export async function runKpiReconcile(db: Db): Promise<KpiReconcileSummary> {
  const processedRes = await db.execute(sql`
    SELECT processed::text AS day, run_status AS status
    FROM public.rollup_kpis_reconcile()
    WHERE processed IS NOT NULL
  `);

  const missingRes = await db.execute(sql`
    SELECT gs::date::text AS day
    FROM generate_series(
      (now() AT TIME ZONE 'America/New_York')::date - 7,
      (now() AT TIME ZONE 'America/New_York')::date - 1,
      interval '1 day'
    ) gs
    WHERE NOT EXISTS (
      SELECT 1 FROM rollup_runs r
      WHERE r.run_date = gs::date AND r.status = 'success'
    )
    ORDER BY 1
  `);

  return {
    processed: toRows(processedRes).map((r) => ({
      day: String(r.day),
      status: String(r.status),
    })),
    missingLast7: toRows(missingRes).map((r) => String(r.day)),
  };
}
