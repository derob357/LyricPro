import { z } from "zod";
import { sql } from "drizzle-orm";
import { adminProcedure, router } from "../_core/trpc";
import { getDb } from "../db";
import { recordAdminAction } from "../_core/audit";
import { TRPCError } from "@trpc/server";
import { generateDdexDsr, type SongDisplayWithSong } from "../_core/ddex-exporter";
import { lintDdex } from "../_core/ddex-lint";

export const adminUsageRouter = router({
  availablePeriods: adminProcedure.query(async () => {
    const db = await getDb();
    if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "DB unavailable" });
    const result = await db.execute(sql`
      SELECT DISTINCT reporting_period_yyyymm AS period
      FROM song_displays
      WHERE reporting_period_yyyymm IS NOT NULL
      ORDER BY period DESC
    `);
    const rows = (result as any).rows ?? (Array.isArray(result) ? result : []);
    return rows.map((r: any) => ({
      period: `${String(r.period).slice(0, 4)}-${String(r.period).slice(4)}`,
    }));
  }),

  byLyric: adminProcedure
    .input(z.object({
      period: z.string().regex(/^\d{4}-\d{2}$/),
      aggregation: z.enum(["song", "variant"]).default("variant"),
    }))
    .query(async ({ input }) => {
      const db = await getDb();
      if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "DB unavailable" });
      const yyyymm = input.period.replace("-", "");
      if (input.aggregation === "variant") {
        const result = await db.execute(sql`
          SELECT
            sd."songId" AS "songId",
            sd."variantIndex" AS "variantIndex",
            s.title AS title,
            s."artistName" AS artist,
            s.genre AS genre,
            s.iswc AS iswc,
            COUNT(*)::int AS "playCount",
            COALESCE(SUM(sd.duration_of_use_seconds), 0)::int AS "durationSeconds",
            COALESCE(SUM(sd.gross_revenue_per_event_micros), 0)::bigint AS "revenueMicros",
            array_agg(DISTINCT sd.territory_code)
              FILTER (WHERE sd.territory_code IS NOT NULL) AS territories
          FROM song_displays sd
          JOIN songs s ON s.id = sd."songId"
          WHERE sd.reporting_period_yyyymm = ${yyyymm}
          GROUP BY sd."songId", sd."variantIndex", s.title, s."artistName", s.genre, s.iswc
          ORDER BY "playCount" DESC
        `);
        const rows = (result as any).rows ?? (Array.isArray(result) ? result : []);
        return { rows };
      } else {
        const result = await db.execute(sql`
          SELECT
            sd."songId" AS "songId",
            s.title AS title,
            s."artistName" AS artist,
            s.genre AS genre,
            s.iswc AS iswc,
            COUNT(*)::int AS "playCount",
            COALESCE(SUM(sd.duration_of_use_seconds), 0)::int AS "durationSeconds",
            COALESCE(SUM(sd.gross_revenue_per_event_micros), 0)::bigint AS "revenueMicros",
            array_agg(DISTINCT sd.territory_code)
              FILTER (WHERE sd.territory_code IS NOT NULL) AS territories
          FROM song_displays sd
          JOIN songs s ON s.id = sd."songId"
          WHERE sd.reporting_period_yyyymm = ${yyyymm}
          GROUP BY sd."songId", s.title, s."artistName", s.genre, s.iswc
          ORDER BY "playCount" DESC
        `);
        const rows = (result as any).rows ?? (Array.isArray(result) ? result : []);
        return { rows };
      }
    }),

  exportCsv: adminProcedure
    .input(z.object({
      period: z.string().regex(/^\d{4}-\d{2}$/),
      aggregation: z.enum(["song", "variant"]).default("variant"),
    }))
    .mutation(async ({ ctx, input }) => {
      const db = await getDb();
      if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "DB unavailable" });
      const yyyymm = input.period.replace("-", "");
      const variantSelect = input.aggregation === "variant"
        ? sql`sd."variantIndex"`
        : sql`NULL::int`;
      const variantGroupBy = input.aggregation === "variant"
        ? sql`, sd."variantIndex"`
        : sql``;
      const result = await db.execute(sql`
        SELECT
          s.title AS title,
          s."artistName" AS artist,
          ${variantSelect} AS "variantIndex",
          COUNT(*)::int AS plays,
          COALESCE(SUM(sd.duration_of_use_seconds), 0)::int AS duration,
          COALESCE(SUM(sd.gross_revenue_per_event_micros), 0)::bigint AS revenue,
          string_agg(DISTINCT sd.territory_code, ',') AS territories
        FROM song_displays sd
        JOIN songs s ON s.id = sd."songId"
        WHERE sd.reporting_period_yyyymm = ${yyyymm}
        GROUP BY s.title, s."artistName"${variantGroupBy}
        ORDER BY plays DESC
      `);
      const rows = (result as any).rows ?? (Array.isArray(result) ? result : []);
      const head = "title,artist,variantIndex,plays,durationSeconds,revenueMicros,territories";
      const csvLines = rows.map((r: any) => [
        csvEsc(r.title),
        csvEsc(r.artist),
        r.variantIndex ?? "",
        r.plays,
        r.duration,
        r.revenue,
        csvEsc(r.territories ?? ""),
      ].join(","));
      const csv = [head, ...csvLines].join("\n");
      await db.transaction(async (tx) => {
        await recordAdminAction({
          ctx, tx,
          action: "export.usage_csv",
          targetType: "export",
          targetId: `usage_${yyyymm}_${input.aggregation}`,
          payload: { params: input, rowCount: rows.length } as any,
        });
      });
      return { csv, rowCount: rows.length };
    }),

  exportDdex: adminProcedure
    .input(z.object({
      period: z.string().regex(/^\d{4}-\d{2}$/),
      recipient: z.string().min(1).default("UNREGISTERED"),
    }))
    .mutation(async ({ ctx, input }) => {
      const db = await getDb();
      if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "DB unavailable" });
      const yyyymm = input.period.replace("-", "");
      const result = await db.execute(sql`
        SELECT
          sd."songId"                            AS "songId",
          sd."variantIndex"                      AS "variantIndex",
          sd."shownAt"                           AS "shownAt",
          sd.territory_code                      AS "territoryCode",
          sd.duration_of_use_seconds             AS "durationOfUseSeconds",
          sd.commercial_model_type               AS "commercialModelType",
          sd.service_description                 AS "serviceDescription",
          sd.gross_revenue_per_event_micros      AS "grossRevenuePerEventMicros",
          sd.currency_code                       AS "currencyCode",
          sd.attribution_served                  AS "attributionServed",
          s.title                                AS title,
          s."artistName"                         AS "artistName",
          s.iswc                                 AS iswc,
          s.isrc                                 AS isrc
        FROM song_displays sd
        JOIN songs s ON s.id = sd."songId"
        WHERE sd.reporting_period_yyyymm = ${yyyymm}
      `);
      const raw = (result as any).rows ?? (Array.isArray(result) ? result : []);
      const rows: SongDisplayWithSong[] = raw.map((r: any) => ({
        songId: Number(r.songId),
        variantIndex: Number(r.variantIndex),
        shownAt: r.shownAt instanceof Date ? r.shownAt.toISOString() : String(r.shownAt),
        territoryCode: r.territoryCode ?? null,
        durationOfUseSeconds: r.durationOfUseSeconds ?? null,
        commercialModelType: String(r.commercialModelType),
        serviceDescription: String(r.serviceDescription),
        grossRevenuePerEventMicros: Number(r.grossRevenuePerEventMicros ?? 0),
        currencyCode: String(r.currencyCode ?? "USD"),
        attributionServed: r.attributionServed ?? null,
        title: String(r.title),
        artistName: String(r.artistName),
        iswc: r.iswc ?? null,
        isrc: r.isrc ?? null,
      }));
      const [start, end] = monthBounds(input.period);
      const file = generateDdexDsr(rows, {
        messageSender: "LYRICPRO-UNREGISTERED",
        messageRecipient: input.recipient,
        reportingPeriodStart: start,
        reportingPeriodEnd: end,
        messageVersion: "2025-current",
      });
      const lintIssues = lintDdex(file.mainFile);
      await db.transaction(async (tx) => {
        await recordAdminAction({
          ctx, tx,
          action: "export.usage_ddex",
          targetType: "export",
          targetId: `ddex_${yyyymm}_${input.recipient}`,
          payload: {
            params: input,
            mainRowCount: rows.filter((r) => r.isrc !== null).length,
            noMatchRowCount: rows.filter((r) => r.isrc === null).length,
            lintIssueCount: lintIssues.length,
          } as any,
        });
      });
      return { ...file, lintIssues };
    }),
});

function csvEsc(s: string | number | null | undefined): string {
  if (s === null || s === undefined) return "";
  const str = String(s);
  if (str.includes(",") || str.includes('"') || str.includes("\n")) {
    return `"${str.replace(/"/g, '""')}"`;
  }
  return str;
}

function monthBounds(period: string): [Date, Date] {
  const [yyyy, mm] = period.split("-").map(Number);
  return [
    new Date(Date.UTC(yyyy, mm - 1, 1)),
    new Date(Date.UTC(yyyy, mm, 0, 23, 59, 59)),
  ];
}
