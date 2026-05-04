import { asc, desc, eq, gte, sql } from "drizzle-orm";
import { adminProcedure, router } from "../_core/trpc";
import { getDb } from "../db";
import { songs, songDisplays } from "../../drizzle/schema";

// ── Admin router ────────────────────────────────────────────────────────────
// Procedures here are gated by adminProcedure (ctx.user.role === "admin").
// Keep this router lean — long-running analytics belong on a dedicated job
// or in a materialized view, not in a request-time tRPC call.
export const adminRouter = router({
  // Aggregate usage report for the song catalogue. Powers /admin/usage.
  songUsageReport: adminProcedure.query(async () => {
    const db = await getDb();
    if (!db) throw new Error("Database not available");

    // ── Totals ────────────────────────────────────────────────────────────
    const [{ totalDisplays }] = await db
      .select({ totalDisplays: sql<number>`COALESCE(COUNT(*), 0)::int` })
      .from(songDisplays);

    const [{ distinctSongsShown }] = await db
      .select({
        distinctSongsShown: sql<number>`COALESCE(COUNT(DISTINCT ${songDisplays.songId}), 0)::int`,
      })
      .from(songDisplays);

    const [{ totalSongs }] = await db
      .select({ totalSongs: sql<number>`COUNT(*)::int` })
      .from(songs);

    const [{ songsNeverShown }] = await db
      .select({ songsNeverShown: sql<number>`COUNT(*)::int` })
      .from(songs)
      .where(eq(songs.displayCount, 0));

    // ── Top 20 most-shown ────────────────────────────────────────────────
    const topShown = await db
      .select({
        songId: songs.id,
        title: songs.title,
        artist: songs.artistName,
        genre: songs.genre,
        decade: songs.decadeRange,
        displayCount: songs.displayCount,
      })
      .from(songs)
      .where(gte(songs.displayCount, 1))
      .orderBy(desc(songs.displayCount))
      .limit(20);

    // ── Bottom 20 of those shown ≥ 1 ─────────────────────────────────────
    const bottomShown = await db
      .select({
        songId: songs.id,
        title: songs.title,
        artist: songs.artistName,
        genre: songs.genre,
        decade: songs.decadeRange,
        displayCount: songs.displayCount,
      })
      .from(songs)
      .where(gte(songs.displayCount, 1))
      .orderBy(asc(songs.displayCount))
      .limit(20);

    // ── Sample of never-shown songs ──────────────────────────────────────
    const neverShownSample = await db
      .select({
        songId: songs.id,
        title: songs.title,
        artist: songs.artistName,
        genre: songs.genre,
        decade: songs.decadeRange,
      })
      .from(songs)
      .where(eq(songs.displayCount, 0))
      .orderBy(asc(songs.id))
      .limit(20);

    // ── Distribution buckets ─────────────────────────────────────────────
    const distRows = await db
      .select({
        bucket: sql<string>`
          CASE
            WHEN ${songs.displayCount} = 0 THEN '0'
            WHEN ${songs.displayCount} BETWEEN 1 AND 5 THEN '1-5'
            WHEN ${songs.displayCount} BETWEEN 6 AND 20 THEN '6-20'
            WHEN ${songs.displayCount} BETWEEN 21 AND 100 THEN '21-100'
            ELSE '100+'
          END
        `,
        cnt: sql<number>`COUNT(*)::int`,
      })
      .from(songs)
      .groupBy(sql`1`);

    const distribution: Record<string, number> = {
      "0": 0,
      "1-5": 0,
      "6-20": 0,
      "21-100": 0,
      "100+": 0,
    };
    for (const r of distRows) {
      distribution[r.bucket] = r.cnt;
    }

    // ── By genre ─────────────────────────────────────────────────────────
    const byGenre = await db
      .select({
        genre: songs.genre,
        totalSongs: sql<number>`COUNT(*)::int`,
        neverShown: sql<number>`SUM(CASE WHEN ${songs.displayCount} = 0 THEN 1 ELSE 0 END)::int`,
        avgDisplays: sql<number>`COALESCE(AVG(${songs.displayCount}), 0)::float`,
      })
      .from(songs)
      .groupBy(songs.genre)
      .orderBy(asc(songs.genre));

    // ── By decade ────────────────────────────────────────────────────────
    const byDecade = await db
      .select({
        decade: songs.decadeRange,
        totalSongs: sql<number>`COUNT(*)::int`,
        neverShown: sql<number>`SUM(CASE WHEN ${songs.displayCount} = 0 THEN 1 ELSE 0 END)::int`,
        avgDisplays: sql<number>`COALESCE(AVG(${songs.displayCount}), 0)::float`,
      })
      .from(songs)
      .groupBy(songs.decadeRange)
      .orderBy(asc(songs.decadeRange));

    // ── Last 7 days activity ─────────────────────────────────────────────
    // "Rounds played" = total displays in the window. "Distinct songs
    // displayed" = unique songIds in the window.
    const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);
    const [{ roundsPlayed }] = await db
      .select({
        roundsPlayed: sql<number>`COALESCE(COUNT(*), 0)::int`,
      })
      .from(songDisplays)
      .where(gte(songDisplays.shownAt, sevenDaysAgo));
    const [{ distinctSongsDisplayed }] = await db
      .select({
        distinctSongsDisplayed: sql<number>`COALESCE(COUNT(DISTINCT ${songDisplays.songId}), 0)::int`,
      })
      .from(songDisplays)
      .where(gte(songDisplays.shownAt, sevenDaysAgo));

    return {
      totals: {
        totalDisplays,
        distinctSongsShown,
        songsNeverShown,
        totalSongs,
      },
      topShown,
      bottomShown,
      neverShownSample,
      distribution,
      byGenre,
      byDecade,
      last7Days: { roundsPlayed, distinctSongsDisplayed },
    };
  }),
});

