// server/routers/adminAnalytics.ts
import { z } from "zod";
import { count, countDistinct, eq, sql, sum } from "drizzle-orm";
import { adminProcedure, router } from "../_core/trpc";
import { getDb } from "../db";
import { TRPCError } from "@trpc/server";
import { recordAdminAction } from "../_core/audit";
import { prizePayouts, payoutRequests, roundResults, songs, songDisplays, leaderboardEntries, goldenNoteBalances, goldenNoteTransactions, tournaments, tournamentMembers, prizePools, guestSessions, users } from "../../drizzle/schema";

function requireDb(db: unknown): asserts db {
  if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "DB unavailable" });
}

function csvEsc(v: unknown): string { const s = String(v ?? ""); return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s; }

// ── User activity dot plot (per-user × per-day grid) ────────────────────────
// Value events: a round answered (round_results) and a COMPLETED game
// (game_sessions with endedAt). Deliberately NOT song_displays — a lyric
// merely shown is not value. Day bucketing is plain UTC date_trunc, matching
// this file's `retention` convention (the KPI rollups use America/New_York;
// this tab stays consistent with its sibling analytics charts instead).

export interface ActivityEventRow {
  actor: string;                     // "u:<id>" | "g:<token>"
  day: string;                       // "YYYY-MM-DD"
  kind: "round" | "game";
  user_name: string | null;
  rank_tier: string | null;
  premium_status: boolean | null;
  favorite_genre: string | null;
  games_played: number | null;
  login_method: string | null;
  signup_at: string | null;          // users."createdAt"
  sub_tier: string | null;           // subscriptions.tier
  guest_nickname: string | null;
  guest_created_at: string | null;   // guest_sessions."createdAt"
  marketing_opt_in: boolean | null;
  has_email: boolean | null;
}

interface ActivityOpts {
  days: number;
  type: "all" | "registered" | "guest";
  tier: "all" | "free" | "player" | "pro" | "elite";
  newInWindowOnly: boolean;
  sort: "first-seen" | "recent" | "active-days";
}

const MAX_ACTIVITY_ROWS = 500;

export function shapeActivity(rows: ActivityEventRow[], opts: ActivityOpts, today: Date = new Date()) {
  // Continuous columns: last `days` UTC days ending today.
  const end = Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), today.getUTCDate());
  const windowDays: string[] = [];
  for (let i = opts.days - 1; i >= 0; i--) {
    windowDays.push(new Date(end - i * 86400000).toISOString().slice(0, 10));
  }
  const windowStart = windowDays[0]!;

  // Group events per actor.
  const byActor = new Map<string, { rounds: Set<string>; games: Set<string>; first: ActivityEventRow }>();
  for (const r of rows) {
    let a = byActor.get(r.actor);
    if (!a) { a = { rounds: new Set(), games: new Set(), first: r }; byActor.set(r.actor, a); }
    (r.kind === "game" ? a.games : a.rounds).add(r.day);
  }

  let shaped = Array.from(byActor.entries()).map(([actor, a]) => {
    const type = actor.startsWith("u:") ? ("registered" as const) : ("guest" as const);
    const idPart = actor.slice(2);
    const label = type === "registered"
      ? (a.first.user_name || `user #${idPart}`)
      : (a.first.guest_nickname || `guest ${idPart.slice(0, 4)}`);
    const tier = type === "registered"
      ? ((a.first.sub_tier as "free" | "player" | "pro" | "elite" | null) ?? "free")
      : null;
    const allDays = Array.from(new Set([...Array.from(a.rounds), ...Array.from(a.games)])).sort();
    return {
      actor, type, label, tier,
      attrs: {
        rankTier: a.first.rank_tier, premiumStatus: a.first.premium_status,
        favoriteGenre: a.first.favorite_genre, gamesPlayed: a.first.games_played,
        loginMethod: a.first.login_method, signupAt: a.first.signup_at,
        marketingOptIn: a.first.marketing_opt_in, hasEmail: a.first.has_email,
        createdAt: a.first.signup_at ?? a.first.guest_created_at,
      },
      roundDays: Array.from(a.rounds).sort(),
      gameDays: Array.from(a.games).sort(),
      firstActivityDay: allDays[0]!,
      _lastDay: allDays[allDays.length - 1]!,
      _activeDays: allDays.length,
    };
  });

  if (opts.type !== "all") shaped = shaped.filter((r) => r.type === opts.type);
  // Tier is a registered-user attribute; a specific tier filter excludes guests.
  if (opts.tier !== "all") shaped = shaped.filter((r) => r.tier === opts.tier);
  if (opts.newInWindowOnly) {
    shaped = shaped.filter((r) => r.attrs.createdAt != null && r.attrs.createdAt.slice(0, 10) >= windowStart);
  }

  shaped.sort((x, y) => {
    if (opts.sort === "recent") return y._lastDay.localeCompare(x._lastDay) || x.actor.localeCompare(y.actor);
    if (opts.sort === "active-days") return y._activeDays - x._activeDays || x.actor.localeCompare(y.actor);
    return x.firstActivityDay.localeCompare(y.firstActivityDay) || x.actor.localeCompare(y.actor);
  });

  const truncated = shaped.length > MAX_ACTIVITY_ROWS;
  const out = shaped.slice(0, MAX_ACTIVITY_ROWS).map(({ _lastDay, _activeDays, ...r }) => r);
  return { windowDays, rows: out, truncated };
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

  // Per-user × per-day activity grid ("dot plot") — see shapeActivity above.
  userActivity: adminProcedure
    .input(z.object({
      days: z.number().int().min(1).max(365).default(30),
      type: z.enum(["all", "registered", "guest"]).default("all"),
      tier: z.enum(["all", "free", "player", "pro", "elite"]).default("all"),
      newInWindowOnly: z.boolean().default(false),
      sort: z.enum(["first-seen", "recent", "active-days"]).default("first-seen"),
    }))
    .query(async ({ input }) => {
      const db = await getDb();
      requireDb(db);
      // Only zod-validated input.days reaches sql.raw (this file's convention);
      // type/tier/sort/newInWindowOnly are applied in JS by shapeActivity.
      const result = await db.execute(sql.raw(`
        WITH round_days AS (
          SELECT DISTINCT coalesce('u:'||"activePlayerId"::text, 'g:'||"activeGuestToken") AS actor,
                 date_trunc('day', "createdAt")::date AS day
          FROM round_results
          WHERE "createdAt" >= now() - interval '${input.days} days'
            AND ("activePlayerId" IS NOT NULL OR "activeGuestToken" IS NOT NULL)
        ),
        game_days AS (
          SELECT DISTINCT coalesce('u:'||"userId"::text, 'g:'||"guestToken") AS actor,
                 date_trunc('day', "startedAt")::date AS day
          FROM game_sessions
          WHERE "startedAt" >= now() - interval '${input.days} days'
            AND "endedAt" IS NOT NULL
            AND ("userId" IS NOT NULL OR "guestToken" IS NOT NULL)
        ),
        all_days AS (
          SELECT actor, day, 'round' AS kind FROM round_days
          UNION ALL
          SELECT actor, day, 'game' AS kind FROM game_days
        )
        SELECT a.actor, a.day::text AS day, a.kind,
               u.name AS user_name, u."rankTier" AS rank_tier, u."premiumStatus" AS premium_status,
               u."favoriteGenre" AS favorite_genre, u."gamesPlayed" AS games_played,
               u."loginMethod" AS login_method, u."createdAt"::text AS signup_at,
               s.tier::text AS sub_tier,
               g.nickname AS guest_nickname, g."createdAt"::text AS guest_created_at,
               g."marketingOptIn" AS marketing_opt_in, (g.email IS NOT NULL) AS has_email
        FROM all_days a
        LEFT JOIN users u ON a.actor LIKE 'u:%' AND u.id = substring(a.actor from 3)::int
        LEFT JOIN subscriptions s ON s."userId" = u.id
        LEFT JOIN guest_sessions g ON a.actor LIKE 'g:%' AND g."sessionToken" = substring(a.actor from 3)
        ORDER BY a.actor, a.day;
      `));
      const raw = (result as any).rows ?? (Array.isArray(result) ? result : []);
      return shapeActivity(raw as ActivityEventRow[], input);
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
      const [{ converted }] = await db.select({ converted: countDistinct(guestSessions.id) })
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

  exportUsers: adminProcedure.mutation(async ({ ctx }) => {
    const db = await getDb();
    requireDb(db);
    const rows = await db.select({
      id: users.id, email: users.email, firstName: users.firstName, role: users.role,
      lifetimeScore: users.lifetimeScore, gamesPlayed: users.gamesPlayed, totalWins: users.totalWins,
    }).from(users);
    const head = ["id","email","firstName","role","lifetimeScore","gamesPlayed","totalWins"].join(",");
    const lines = rows.map((r) => [r.id, csvEsc(r.email ?? ""), csvEsc(r.firstName ?? ""), r.role, r.lifetimeScore, r.gamesPlayed, r.totalWins].join(","));
    const csv = [head, ...lines].join("\n");
    await db.transaction(async (tx) => {
      await recordAdminAction({ ctx, tx, action: "export.users_csv", targetType: "export", targetId: "all", payload: { params: { rowCount: rows.length } } });
    });
    return { csv, rowCount: rows.length };
  }),

  exportPayoutHistory: adminProcedure.mutation(async ({ ctx }) => {
    const db = await getDb();
    requireDb(db);
    const rows = await db.select({
      id: prizePayouts.id, status: prizePayouts.status, amount: prizePayouts.amount, createdAt: prizePayouts.createdAt,
    }).from(prizePayouts);
    const head = ["id","status","amount","createdAt"].join(",");
    const lines = rows.map((r) => [r.id, r.status, r.amount ?? "", r.createdAt ? new Date(r.createdAt).toISOString() : ""].join(","));
    const csv = [head, ...lines].join("\n");
    await db.transaction(async (tx) => {
      await recordAdminAction({ ctx, tx, action: "export.payouts_csv", targetType: "export", targetId: "all", payload: { params: { rowCount: rows.length } } });
    });
    return { csv, rowCount: rows.length };
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
