// server/routers/adminAnalytics.ts
import { z } from "zod";
import { count, eq, sql, sum } from "drizzle-orm";
import { adminProcedure, router } from "../_core/trpc";
import { getDb } from "../db";
import { TRPCError } from "@trpc/server";
import { prizePayouts, payoutRequests, roundResults, songs, songDisplays, leaderboardEntries } from "../../drizzle/schema";

function requireDb(db: unknown): asserts db {
  if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "DB unavailable" });
}

export const adminAnalyticsRouter = router({
  payoutPipeline: adminProcedure.query(async () => {
    const db = await getDb();
    requireDb(db);
    const pp = await db
      .select({ status: prizePayouts.status, count: count(), totalAmount: sum(prizePayouts.amount) })
      .from(prizePayouts)
      .groupBy(prizePayouts.status);
    const pr = await db
      .select({ status: payoutRequests.status, count: count(), totalAmount: sum(payoutRequests.amount) })
      .from(payoutRequests)
      .groupBy(payoutRequests.status);
    const norm = (rows: any[]) => rows.map((r) => ({ status: String(r.status), count: Number(r.count), totalAmount: Number(r.totalAmount ?? 0) }));
    return { prizePayouts: norm(pp), payoutRequests: norm(pr) };
  }),

  retention: adminProcedure
    .input(z.object({ days: z.number().int().min(1).max(365).default(90) }))
    .query(async ({ input }) => {
      const db = await getDb();
      requireDb(db);

      // Per-day distinct actors, plus rolling 7/30-day distinct via correlated subqueries.
      // sql.raw is used because the rolling-window distinct counts are awkward in the query builder.
      // input.days is validated as a z.number().int().min(1).max(365) so direct interpolation is safe.
      const build = async (table: "song_displays" | "leaderboard_entries") => {
        const tsCol = table === "song_displays" ? "\"shownAt\"" : "\"createdAt\"";
        const actor = table === "song_displays"
          ? "coalesce('u:'||\"userId\"::text, 'g:'||\"guestToken\")"
          : "coalesce('u:'||\"userId\"::text, 'g:'||\"guestName\")";
        const result = await db.execute(sql.raw(`
          WITH ev AS (
            SELECT date_trunc('day', ${tsCol})::date AS day, ${actor} AS actor
            FROM ${table}
            WHERE ${tsCol} >= now() - interval '${input.days} days' AND ${actor} IS NOT NULL
          ),
          days AS (SELECT DISTINCT day FROM ev)
          SELECT d.day::text AS day,
            (SELECT count(DISTINCT actor) FROM ev e WHERE e.day = d.day) AS dau,
            (SELECT count(DISTINCT actor) FROM ev e WHERE e.day > d.day - 7 AND e.day <= d.day) AS wau,
            (SELECT count(DISTINCT actor) FROM ev e WHERE e.day > d.day - 30 AND e.day <= d.day) AS mau
          FROM days d ORDER BY d.day ASC;
        `));
        const arr = (result as any).rows ?? (Array.isArray(result) ? result : []);
        return (arr as any[]).map((r) => ({ day: String(r.day), dau: Number(r.dau), wau: Number(r.wau), mau: Number(r.mau) }));
      };

      const [roundsSeries, gamesSeries] = await Promise.all([build("song_displays"), build("leaderboard_entries")]);
      return { roundsSeries, gamesSeries };
    }),

  songAccuracy: adminProcedure
    .input(z.object({ limit: z.number().int().min(1).max(100).default(20) }))
    .query(async ({ input }) => {
      const db = await getDb();
      requireDb(db);
      const rows = await db
        .select({
          songId: roundResults.songId,
          title: songs.title,
          artistName: songs.artistName,
          rounds: count(),
          lyricRate: sql<number>`avg(case when ${roundResults.lyricPoints} > 0 then 1.0 else 0 end)`,
          artistRate: sql<number>`avg(case when ${roundResults.artistPoints} > 0 then 1.0 else 0 end)`,
          yearRate: sql<number>`avg(case when ${roundResults.yearPoints} > 0 then 1.0 else 0 end)`,
        })
        .from(roundResults)
        .innerJoin(songs, eq(songs.id, roundResults.songId))
        .groupBy(roundResults.songId, songs.title, songs.artistName)
        .having(sql`count(*) >= 5`);
      const mapped = rows.map((r) => {
        const lyricRate = Number(r.lyricRate), artistRate = Number(r.artistRate), yearRate = Number(r.yearRate);
        return { songId: r.songId, title: r.title, artistName: r.artistName, rounds: Number(r.rounds), lyricRate, artistRate, yearRate, overallRate: (lyricRate + artistRate + yearRate) / 3 };
      });
      const byOverall = [...mapped].sort((a, b) => a.overallRate - b.overallRate);
      return { hardest: byOverall.slice(0, input.limit), easiest: byOverall.slice(-input.limit).reverse() };
    }),
});
