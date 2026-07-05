// server/routers/adminAnalytics.ts
import { z } from "zod";
import { count, eq, sql, sum } from "drizzle-orm";
import { adminProcedure, router } from "../_core/trpc";
import { getDb } from "../db";
import { TRPCError } from "@trpc/server";
import { prizePayouts, payoutRequests, roundResults, songs, songDisplays, leaderboardEntries, goldenNoteBalances, goldenNoteTransactions, tournaments, tournamentMembers, prizePools, guestSessions, users } from "../../drizzle/schema";

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

  tournamentFinancials: adminProcedure.query(async () => {
    const db = await getDb();
    requireDb(db);
    const rosterRows = await db.select({ tournamentId: tournamentMembers.tournamentId, n: count() }).from(tournamentMembers).groupBy(tournamentMembers.tournamentId);
    const roster = new Map(rosterRows.map((r) => [r.tournamentId, Number(r.n)]));
    const rows = await db.select({
      id: tournaments.id, name: tournaments.name, status: tournaments.status, capacity: tournaments.capacity,
      poolTotal: prizePools.totalAmount, poolDistributed: prizePools.distributedAmount, poolRemaining: prizePools.remainingAmount,
    }).from(tournaments).leftJoin(prizePools, eq(prizePools.id, tournaments.prizePoolId));
    const tfs = rows.map((r) => {
      const rosterSize = roster.get(r.id) ?? 0;
      const capacity = r.capacity ?? null;
      return { id: r.id, name: r.name, status: String(r.status), capacity, rosterSize,
        fillRate: capacity && capacity > 0 ? rosterSize / capacity : null,
        poolTotal: Number(r.poolTotal ?? 0), poolDistributed: Number(r.poolDistributed ?? 0), poolRemaining: Number(r.poolRemaining ?? 0) };
    });
    const byStatusMap = new Map<string, number>();
    for (const t of tfs) byStatusMap.set(t.status, (byStatusMap.get(t.status) ?? 0) + 1);
    return {
      tournaments: tfs,
      rollup: {
        byStatus: Array.from(byStatusMap).map(([status, count]) => ({ status, count })),
        poolTotal: tfs.reduce((s, t) => s + t.poolTotal, 0),
        poolDistributed: tfs.reduce((s, t) => s + t.poolDistributed, 0),
        poolRemaining: tfs.reduce((s, t) => s + t.poolRemaining, 0),
      },
    };
  }),

  guestFunnel: adminProcedure
    .input(z.object({ days: z.number().int().min(1).max(365).default(90) }))
    .query(async ({ input }) => {
      const db = await getDb();
      requireDb(db);
      const [{ totalGuests, leads, optIns }] = await db.select({
        totalGuests: count(),
        leads: sql<number>`coalesce(sum(case when ${guestSessions.email} is not null then 1 else 0 end), 0)`,
        optIns: sql<number>`coalesce(sum(case when ${guestSessions.marketingOptIn} then 1 else 0 end), 0)`,
      }).from(guestSessions);
      // Email-match conversion proxy: guest email that also exists on a user row.
      const [{ converted }] = await db.select({ converted: count() })
        .from(guestSessions)
        .innerJoin(users, sql`lower(${users.email}) = lower(${guestSessions.email})`);
      const seriesRows = await db.execute(sql.raw(`
        SELECT date_trunc('day', "createdAt")::date::text AS day, count(*) AS guests
        FROM guest_sessions WHERE "createdAt" >= now() - interval '${input.days} days'
        GROUP BY 1 ORDER BY 1 ASC;`));
      const arr = (seriesRows as any).rows ?? (Array.isArray(seriesRows) ? seriesRows : []);
      const total = Number(totalGuests);
      return {
        totalGuests: total, leads: Number(leads), optIns: Number(optIns), converted: Number(converted),
        conversionRate: total > 0 ? Number(converted) / total : 0,
        newGuestsSeries: (arr as any[]).map((r) => ({ day: String(r.day), guests: Number(r.guests) })),
      };
    }),

  gnEconomy: adminProcedure.query(async () => {
    const db = await getDb();
    requireDb(db);
    const [{ circulation }] = await db.select({ circulation: sum(goldenNoteBalances.balance) }).from(goldenNoteBalances);
    const [{ credited, debited }] = await db.select({
      credited: sql<number>`coalesce(sum(case when ${goldenNoteTransactions.amount} > 0 then ${goldenNoteTransactions.amount} else 0 end), 0)`,
      debited: sql<number>`coalesce(sum(case when ${goldenNoteTransactions.amount} < 0 then -${goldenNoteTransactions.amount} else 0 end), 0)`,
    }).from(goldenNoteTransactions);
    const [{ purchasedCount, purchasedAmount }] = await db.select({
      purchasedCount: count(),
      purchasedAmount: sql<number>`coalesce(sum(${goldenNoteTransactions.amount}), 0)`,
    }).from(goldenNoteTransactions).where(sql`${goldenNoteTransactions.stripePaymentIntentId} is not null`);
    const reasons = await db.select({
      reason: goldenNoteTransactions.reason,
      credited: sql<number>`coalesce(sum(case when ${goldenNoteTransactions.amount} > 0 then ${goldenNoteTransactions.amount} else 0 end), 0)`,
      debited: sql<number>`coalesce(sum(case when ${goldenNoteTransactions.amount} < 0 then -${goldenNoteTransactions.amount} else 0 end), 0)`,
      count: count(),
    }).from(goldenNoteTransactions).groupBy(goldenNoteTransactions.reason);
    return {
      circulation: Number(circulation ?? 0),
      totalCredited: Number(credited), totalDebited: Number(debited),
      purchasedCount: Number(purchasedCount), purchasedAmount: Number(purchasedAmount),
      byReason: reasons.map((r) => ({ reason: r.reason ?? "(none)", credited: Number(r.credited), debited: Number(r.debited), net: Number(r.credited) - Number(r.debited), count: Number(r.count) })),
    };
  }),
});
