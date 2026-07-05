# Admin Analytics — Real Data (SP1) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Fix the buggy admin KPIs and add real, DB-backed admin analytics reports (payout pipeline, retention, per-song accuracy, GN economy, tournament financials, guest funnel) plus real user game-history and working CSV exports — all over existing tables, no migrations.

**Architecture:** One new admin-gated tRPC router `adminAnalytics` (`server/routers/adminAnalytics.ts`) holds the read-only report procedures; surgical edits fix `getAdminMetrics` in `server/db-monetization.ts`; the `game` router gains a caller-scoped `getGameHistory`; UI wires new dashboard cards/tabs + export handlers.

**Tech Stack:** TypeScript, Drizzle ORM (Postgres/Supabase), tRPC, Vitest, React + wouter + @tanstack/react-query, Tailwind/shadcn.

**Spec:** `docs/superpowers/specs/2026-07-05-admin-analytics-real-sp1-design.md`

## Global Constraints

- **No schema migrations.** SP1 is read-only aggregation over existing tables plus surgical edits to existing procedures. Do not add/alter any Drizzle table or column.
- **No dollar-revenue KPIs.** Total Revenue value, revenue-trend series, MRR, churn are OUT of SP1 (they belong to SP2). GN amounts stay in **GN units** (no USD). Entry-fee revenue is the only real money figure SP1 touches, and only via relabeling.
- **No referrals work** (SP3).
- **Admin gating:** every `adminAnalytics` procedure uses `adminProcedure`. `game.getGameHistory` uses `protectedProcedure`, scoped to `ctx.user.id`.
- **Degrade, don't throw:** empty data → zeros / empty arrays. Throw `TRPCError INTERNAL_SERVER_ERROR` only when `getDb()` returns null (DB unavailable).
- **CSV exports are audit-logged** via `recordAdminAction` (mirror `adminUsage.exportCsv`).
- **Actor identity for gameplay events:** `actorKey = userId != null ? 'u:'+userId : 'g:'+guestToken` (song_displays) or `'g:'+guestName` (leaderboard_entries, which stores `guestName` not a token).
- **Accuracy proxy:** `round_results` stores per-category *points*, not a boolean. Correctness = category points > 0.
- **Imports (verified):** `router, adminProcedure, protectedProcedure` from `../_core/trpc`; `getDb` from `../db`; `recordAdminAction` from `../_core/audit`; tables from `../../drizzle/schema`; `and, eq, sql, gte, desc, count, sum, inArray, ilike` from `drizzle-orm`.
- **Test pattern:** offline gate test (non-admin/unauth rejected) under a plain `describe`; data-aggregation tests under `liveDescribe` gated by `const DB_URL = process.env.SUPABASE_SESSION_POOLER_STRING ?? process.env.SUPABASE_DIRECT_CONNECTION_STRING ?? process.env.DATABASE_URL; const liveDescribe = DB_URL ? describe : describe.skip;`. `pnpm check` must pass; existing suites stay green.

---

## Task 1: Fix buggy KPIs in `getAdminMetrics`

**Files:**
- Modify: `server/db-monetization.ts` (the `getAdminMetrics` function)
- Test: `server/adminMetrics.test.ts` (create)

**Interfaces:**
- Produces: `getAdminMetrics()` now returns the existing shape PLUS `activeByTier: { player: number; pro: number; elite: number }`, with `activeSubscriptions` counting all three paid tiers and `totalUsers` = real `users` row count.

- [ ] **Step 1: Write the failing test**

```typescript
// server/adminMetrics.test.ts
import { describe, it, expect, vi } from "vitest";
vi.mock("stripe", () => ({ default: vi.fn().mockImplementation(() => ({ checkout: { sessions: { create: vi.fn() } }, webhooks: { constructEvent: vi.fn() }, subscriptions: { retrieve: vi.fn() }, customers: { search: vi.fn().mockResolvedValue({ data: [] }) } })) }));
import { getAdminMetrics } from "./db-monetization";

const DB_URL = process.env.SUPABASE_SESSION_POOLER_STRING ?? process.env.SUPABASE_DIRECT_CONNECTION_STRING ?? process.env.DATABASE_URL;
const liveDescribe = DB_URL ? describe : describe.skip;

liveDescribe("getAdminMetrics", () => {
  it("counts all paid tiers as active and returns a per-tier breakdown", async () => {
    const m = await getAdminMetrics();
    expect(m).toHaveProperty("activeByTier");
    expect(m.activeByTier).toEqual(expect.objectContaining({ player: expect.any(Number), pro: expect.any(Number), elite: expect.any(Number) }));
    // activeSubscriptions must equal the sum of the three paid tiers.
    expect(m.activeSubscriptions).toBe(m.activeByTier.player + m.activeByTier.pro + m.activeByTier.elite);
    expect(typeof m.totalUsers).toBe("number");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm exec vitest run server/adminMetrics.test.ts`
Expected: FAIL (no `activeByTier`) — or SKIP if no DB. If it SKIPs locally, rely on the query-shape review + typecheck; the change is still required.

- [ ] **Step 3: Implement the fix**

In `server/db-monetization.ts`, replace the `activeSubscriptions` query and the `return` of `getAdminMetrics`. Ensure `inArray` and `count`/`sql` are imported from `drizzle-orm` at the top of the file (add to the existing drizzle-orm import if missing), and `users` is imported from the schema.

Replace the active-subscriptions block:
```typescript
  // Active subscriptions across ALL paid tiers (was player-only — bug).
  const activeSubs = await db
    .select({ tier: subscriptions.tier })
    .from(subscriptions)
    .where(
      and(
        eq(subscriptions.status, "active"),
        inArray(subscriptions.tier, ["player", "pro", "elite"] as const),
      ),
    );
  const activeByTier = { player: 0, pro: 0, elite: 0 };
  for (const s of activeSubs) {
    if (s.tier === "player" || s.tier === "pro" || s.tier === "elite") activeByTier[s.tier]++;
  }

  // Real user count (was subscription-row count — bug).
  const [{ userCount }] = await db.select({ userCount: count() }).from(users);
```

Then change the `return` object:
```typescript
  return {
    tierStats: tierCounts,
    totalRevenue,
    totalPayouts: totalPayoutAmount,
    activeSubscriptions: activeByTier.player + activeByTier.pro + activeByTier.elite,
    activeByTier,
    totalUsers: Number(userCount),
  };
```
Delete the now-unused old `activeSubscriptions` query. Keep `tierStats`, `totalRevenue`, `totalPayouts` untouched (revenue is corrected in SP2).

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm exec vitest run server/adminMetrics.test.ts` (PASS with DB, else SKIP)
Run: `pnpm check` — MUST pass.

- [ ] **Step 5: Commit**

```bash
git add server/db-monetization.ts server/adminMetrics.test.ts
git commit -m "fix(admin): count all paid tiers as active + real total-users in getAdminMetrics"
```

---

## Task 2: `adminAnalytics` router scaffold + `payoutPipeline` + registration

**Files:**
- Create: `server/routers/adminAnalytics.ts`
- Modify: `server/app-router.ts` (import + register)
- Test: `server/adminAnalytics.test.ts` (create)

**Interfaces:**
- Produces: router `adminAnalyticsRouter` mounted as `adminAnalytics`. Procedure `payoutPipeline()` returns `{ prizePayouts: { status: string; count: number; totalAmount: number }[]; payoutRequests: { status: string; count: number; totalAmount: number }[] }`.

- [ ] **Step 1: Write the router with `payoutPipeline`**

```typescript
// server/routers/adminAnalytics.ts
import { and, count, eq, gte, sql, sum } from "drizzle-orm";
import { adminProcedure, router } from "../_core/trpc";
import { getDb } from "../db";
import { TRPCError } from "@trpc/server";
import { prizePayouts, payoutRequests } from "../../drizzle/schema";

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
});
```

> Confirm the amount column names against `drizzle/schema.ts`: `prize_payouts` and `payout_requests` each have an amount column (the payout value). If the exact name differs from `amount`, use the real column. If `payout_requests` has no amount column, return `totalAmount: 0` for its rows and note it.

- [ ] **Step 2: Register in `server/app-router.ts`**

Add with the other admin imports: `import { adminAnalyticsRouter } from "./routers/adminAnalytics";`
Add in the `router({...})` object after `adminCuratedSets: adminCuratedSetsRouter,`: `  adminAnalytics: adminAnalyticsRouter,`

- [ ] **Step 3: Write the gate + live test**

```typescript
// server/adminAnalytics.test.ts
import { describe, it, expect, vi } from "vitest";
vi.mock("stripe", () => ({ default: vi.fn().mockImplementation(() => ({ checkout: { sessions: { create: vi.fn() } }, webhooks: { constructEvent: vi.fn() }, subscriptions: { retrieve: vi.fn() }, customers: { search: vi.fn().mockResolvedValue({ data: [] }) } })) }));
import { appRouter } from "./app-router";

const DB_URL = process.env.SUPABASE_SESSION_POOLER_STRING ?? process.env.SUPABASE_DIRECT_CONNECTION_STRING ?? process.env.DATABASE_URL;
const liveDescribe = DB_URL ? describe : describe.skip;

function caller(role: "admin" | "user") {
  return appRouter.createCaller({ user: { id: 1, role, email: "x@test" } as any, req: {} as any, res: {} as any, ip: undefined, userAgent: undefined, requestId: `vitest-aa-${Date.now()}-${Math.random()}`, countryCode: "US" });
}

describe("adminAnalytics gate", () => {
  it("rejects non-admins from payoutPipeline", async () => {
    await expect(caller("user").adminAnalytics.payoutPipeline()).rejects.toThrow();
  });
});

liveDescribe("adminAnalytics.payoutPipeline", () => {
  it("returns grouped payout rows", async () => {
    const res = await caller("admin").adminAnalytics.payoutPipeline();
    expect(Array.isArray(res.prizePayouts)).toBe(true);
    expect(Array.isArray(res.payoutRequests)).toBe(true);
  });
});
```

- [ ] **Step 4: Run tests + typecheck**

Run: `pnpm exec vitest run server/adminAnalytics.test.ts` (gate PASS; live PASS/SKIP)
Run: `pnpm check` — MUST pass.

- [ ] **Step 5: Commit**

```bash
git add server/routers/adminAnalytics.ts server/app-router.ts server/adminAnalytics.test.ts
git commit -m "feat(admin): adminAnalytics router + payoutPipeline report"
```

---

## Task 3: `retention` report (DAU/WAU/MAU, both series)

**Files:**
- Modify: `server/routers/adminAnalytics.ts` (add procedure + imports)
- Test: extend `server/adminAnalytics.test.ts`

**Interfaces:**
- Produces: `retention({ days?: number })` → `{ roundsSeries: DayPoint[]; gamesSeries: DayPoint[] }` where `DayPoint = { day: string; dau: number; wau: number; mau: number }` (day = `YYYY-MM-DD`).

- [ ] **Step 1: Add the procedure**

Add imports: `import { songDisplays, leaderboardEntries } from "../../drizzle/schema";` and `z` from `zod`. Actor keys: song_displays → `coalesce('u:'||userId, 'g:'||guestToken)`; leaderboard_entries → `coalesce('u:'||userId, 'g:'||guestName)`.

```typescript
  retention: adminProcedure
    .input(z.object({ days: z.number().int().min(1).max(365).default(90) }).default({}))
    .query(async ({ input }) => {
      const db = await getDb();
      requireDb(db);
      const since = sql`now() - (${input.days} || ' days')::interval`;

      // Per-day distinct actors, plus rolling 7/30-day distinct via window over daily sets.
      // Implemented with a per-day CTE then correlated distinct counts.
      const build = async (table: "song_displays" | "leaderboard_entries") => {
        const tsCol = table === "song_displays" ? "\"shownAt\"" : "\"createdAt\"";
        const actor = table === "song_displays"
          ? "coalesce('u:'||\"userId\"::text, 'g:'||\"guestToken\")"
          : "coalesce('u:'||\"userId\"::text, 'g:'||\"guestName\")";
        const rows = await db.execute(sql.raw(`
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
        const arr = (rows as any).rows ?? rows;
        return (arr as any[]).map((r) => ({ day: String(r.day), dau: Number(r.dau), wau: Number(r.wau), mau: Number(r.mau) }));
      };

      const [roundsSeries, gamesSeries] = await Promise.all([build("song_displays"), build("leaderboard_entries")]);
      return { roundsSeries, gamesSeries };
    }),
```

> `db.execute(sql.raw(...))` is used because the rolling-window distinct counts are awkward in the query builder. Values are integers interpolated from a validated `z.number()` input (safe). Confirm `db.execute` return shape in this codebase (postgres-js via drizzle returns rows directly or under `.rows`); the `arr` line handles both.

- [ ] **Step 2: Add a live test**

```typescript
liveDescribe("adminAnalytics.retention", () => {
  it("returns both series with DayPoint shape", async () => {
    const res = await caller("admin").adminAnalytics.retention({ days: 30 });
    expect(Array.isArray(res.roundsSeries)).toBe(true);
    expect(Array.isArray(res.gamesSeries)).toBe(true);
    for (const p of [...res.roundsSeries, ...res.gamesSeries]) {
      expect(p).toEqual(expect.objectContaining({ day: expect.any(String), dau: expect.any(Number), wau: expect.any(Number), mau: expect.any(Number) }));
      expect(p.wau).toBeGreaterThanOrEqual(p.dau);
      expect(p.mau).toBeGreaterThanOrEqual(p.wau);
    }
  });
});
```
Also add a gate test line: `await expect(caller("user").adminAnalytics.retention({}) ).rejects.toThrow();` in the gate `describe`.

- [ ] **Step 3: Run tests + typecheck** — `pnpm exec vitest run server/adminAnalytics.test.ts` (gate PASS; live PASS/SKIP); `pnpm check` PASS.

- [ ] **Step 4: Commit**

```bash
git add server/routers/adminAnalytics.ts server/adminAnalytics.test.ts
git commit -m "feat(admin): retention DAU/WAU/MAU report (rounds + games series)"
```

---

## Task 4: `songAccuracy` report

**Files:**
- Modify: `server/routers/adminAnalytics.ts`
- Test: extend `server/adminAnalytics.test.ts`

**Interfaces:**
- Produces: `songAccuracy({ limit?: number })` → `{ hardest: SongAcc[]; easiest: SongAcc[] }` where `SongAcc = { songId: number; title: string; artistName: string; rounds: number; lyricRate: number; artistRate: number; yearRate: number; overallRate: number }` (rates 0..1).

- [ ] **Step 1: Add the procedure**

Add `roundResults, songs` to the schema import.
```typescript
  songAccuracy: adminProcedure
    .input(z.object({ limit: z.number().int().min(1).max(100).default(20) }).default({}))
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
```

- [ ] **Step 2: Add a live test** asserting shape + that `hardest[0].overallRate <= easiest[0].overallRate` when both non-empty; add gate line for `songAccuracy`.

```typescript
liveDescribe("adminAnalytics.songAccuracy", () => {
  it("returns hardest/easiest with rate fields", async () => {
    const res = await caller("admin").adminAnalytics.songAccuracy({ limit: 5 });
    expect(Array.isArray(res.hardest)).toBe(true);
    for (const s of [...res.hardest, ...res.easiest]) {
      expect(s.overallRate).toBeGreaterThanOrEqual(0);
      expect(s.overallRate).toBeLessThanOrEqual(1);
      expect(s.rounds).toBeGreaterThanOrEqual(5);
    }
    if (res.hardest.length && res.easiest.length) expect(res.hardest[0].overallRate).toBeLessThanOrEqual(res.easiest[0].overallRate);
  });
});
```

- [ ] **Step 3: Run tests + typecheck.**
- [ ] **Step 4: Commit** — `feat(admin): per-song answer-accuracy report`.

---

## Task 5: `gnEconomy` report

**Files:** Modify `server/routers/adminAnalytics.ts`; extend test.

**Interfaces:**
- Produces: `gnEconomy()` → `{ circulation: number; totalCredited: number; totalDebited: number; purchasedCount: number; purchasedAmount: number; byReason: { reason: string; credited: number; debited: number; net: number; count: number }[] }` — all GN units.

- [ ] **Step 1: Add the procedure**

Add `goldenNoteBalances, goldenNoteTransactions` to the schema import.
```typescript
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
```

- [ ] **Step 2: Live test** asserting numeric fields + `byReason` array; add gate line.
- [ ] **Step 3: Run tests + typecheck.**
- [ ] **Step 4: Commit** — `feat(admin): Golden Note economy aggregate report`.

---

## Task 6: `tournamentFinancials` report

**Files:** Modify `server/routers/adminAnalytics.ts`; extend test.

**Interfaces:**
- Produces: `tournamentFinancials()` → `{ tournaments: TF[]; rollup: { byStatus: { status: string; count: number }[]; poolTotal: number; poolDistributed: number; poolRemaining: number } }` where `TF = { id: number; name: string; status: string; capacity: number | null; rosterSize: number; fillRate: number | null; poolTotal: number; poolDistributed: number; poolRemaining: number }`.

- [ ] **Step 1: Add the procedure**

Add `tournaments, tournamentMembers, prizePools` to the schema import. Roster count reuses the `tournamentMembers` source that `tournaments.getById` already counts (read `server/routers/tournaments.ts` to confirm the member-count query). Prize $ via `tournaments.prizePoolId → prizePools`.
```typescript
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
        byStatus: [...byStatusMap].map(([status, count]) => ({ status, count })),
        poolTotal: tfs.reduce((s, t) => s + t.poolTotal, 0),
        poolDistributed: tfs.reduce((s, t) => s + t.poolDistributed, 0),
        poolRemaining: tfs.reduce((s, t) => s + t.poolRemaining, 0),
      },
    };
  }),
```

> Confirm `tournaments.name` and `tournamentMembers.tournamentId` exact column names against the schema; adjust if different.

- [ ] **Step 2: Live test** asserting `tournaments` array + `rollup.byStatus` array + `fillRate` in [0,1] or null; add gate line.
- [ ] **Step 3: Run tests + typecheck.**
- [ ] **Step 4: Commit** — `feat(admin): tournament financials + fill-rate report`.

---

## Task 7: `guestFunnel` report

**Files:** Modify `server/routers/adminAnalytics.ts`; extend test.

**Interfaces:**
- Produces: `guestFunnel({ days?: number })` → `{ totalGuests: number; leads: number; optIns: number; converted: number; conversionRate: number; newGuestsSeries: { day: string; guests: number }[] }`. `converted` is an email-match proxy.

- [ ] **Step 1: Add the procedure**

Add `guestSessions, users` to the schema import.
```typescript
  guestFunnel: adminProcedure
    .input(z.object({ days: z.number().int().min(1).max(365).default(90) }).default({}))
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
      const arr = (seriesRows as any).rows ?? seriesRows;
      const total = Number(totalGuests);
      return {
        totalGuests: total, leads: Number(leads), optIns: Number(optIns), converted: Number(converted),
        conversionRate: total > 0 ? Number(converted) / total : 0,
        newGuestsSeries: (arr as any[]).map((r) => ({ day: String(r.day), guests: Number(r.guests) })),
      };
    }),
```

- [ ] **Step 2: Live test** asserting numeric fields + series array; add gate line.
- [ ] **Step 3: Run tests + typecheck.**
- [ ] **Step 4: Commit** — `feat(admin): guest funnel report (email-match conversion proxy)`.

---

## Task 8: CSV exports (`exportUsers`, `exportPayoutHistory`)

**Files:** Modify `server/routers/adminAnalytics.ts`; extend test.

**Interfaces:**
- Produces: `exportUsers()` and `exportPayoutHistory()` each → `{ csv: string; rowCount: number }`, audit-logged.

- [ ] **Step 1: Add a local `csvEsc` + the two procedures**

Mirror `adminUsage.exportCsv`. Add `recordAdminAction` import. Read `server/routers/adminUsage.ts:81-133` for the exact `csvEsc`, header, and `recordAdminAction` call convention, and match it.
```typescript
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
    await recordAdminAction({ ctx, tx: db as never, action: "export.users_csv", targetType: "users", targetId: "all", payload: { params: { rowCount: rows.length } } });
    return { csv, rowCount: rows.length };
  }),

  exportPayoutHistory: adminProcedure.mutation(async ({ ctx }) => {
    const db = await getDb();
    requireDb(db);
    const rows = await db.select().from(prizePayouts);
    const head = ["id","status","amount","createdAt"].join(",");
    const lines = rows.map((r: any) => [r.id, r.status, r.amount ?? "", r.createdAt ? new Date(r.createdAt).toISOString() : ""].join(","));
    const csv = [head, ...lines].join("\n");
    await recordAdminAction({ ctx, tx: db as never, action: "export.payouts_csv", targetType: "prizePayouts", targetId: "all", payload: { params: { rowCount: rows.length } } });
    return { csv, rowCount: rows.length };
  }),
```
Add near the top of the file:
```typescript
function csvEsc(v: unknown): string { const s = String(v ?? ""); return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s; }
```

> If `recordAdminAction` requires a real transaction handle here, wrap each export's audit call in `db.transaction` like the curated-sets router does. Confirm the `AdminAction`/`AdminTargetType` unions include `export.users_csv`/`export.payouts_csv` and the target types — if not, add them ADDITIVELY in `server/_core/audit.ts` (no other change). Also confirm `prizePayouts` has `amount` + `createdAt` columns; use real names.

- [ ] **Step 2: Live test** — call each as admin, assert `csv` starts with the header and `rowCount` is a number; gate test that a non-admin is rejected.
- [ ] **Step 3: Run tests + typecheck.**
- [ ] **Step 4: Commit** — `feat(admin): CSV exports for users + payout history`.

---

## Task 9: `game.getGameHistory` (user-facing, real)

**Files:**
- Modify: `server/routers/game.ts` (add procedure)
- Test: `server/gameHistory.test.ts` (create)

**Interfaces:**
- Produces: `game.getGameHistory({ limit?: number })` (`protectedProcedure`) → `{ playedAt: string; score: number; mode: string; genre: string | null; decade: string | null }[]`, newest first, scoped to `ctx.user.id`.

- [ ] **Step 1: Add the procedure** in the `game` router object:
```typescript
  getGameHistory: protectedProcedure
    .input(z.object({ limit: z.number().int().min(1).max(100).default(20) }).default({}))
    .query(async ({ ctx, input }) => {
      const db = await getDb();
      if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "DB unavailable" });
      const rows = await db.select({
        playedAt: leaderboardEntries.createdAt, score: leaderboardEntries.score,
        mode: leaderboardEntries.mode, genre: leaderboardEntries.genre, decade: leaderboardEntries.decade,
      }).from(leaderboardEntries)
        .where(eq(leaderboardEntries.userId, ctx.user.id))
        .orderBy(desc(leaderboardEntries.createdAt))
        .limit(input.limit);
      return rows.map((r) => ({ playedAt: r.createdAt ? new Date(r.createdAt).toISOString() : "", score: r.score, mode: String(r.mode), genre: r.genre, decade: r.decade }));
    }),
```
> Confirm `leaderboardEntries` + `desc` are imported in `game.ts` (add if missing). `playedAt` maps from `createdAt`.

- [ ] **Step 2: Gate test** (offline) — unauthenticated caller rejected:
```typescript
// server/gameHistory.test.ts  (mirror the vi.mock('stripe') + caller() helper from adminAnalytics.test.ts, with role omitted / user undefined for the unauth case)
```
Assert `appRouter.createCaller({ user: undefined, ... }).game.getGameHistory({})` rejects. Add a `liveDescribe` test that an admin/user caller returns an array.

- [ ] **Step 3: Run tests + typecheck.**
- [ ] **Step 4: Commit** — `feat(game): real getGameHistory for the user dashboard`.

---

## Task 10: UI wiring

**Files:**
- Modify: `client/src/pages/AdminDashboard.tsx`
- Modify: `client/src/pages/UserDashboard.tsx`

**Interfaces:**
- Consumes: `trpc.adminAnalytics.payoutPipeline/retention/songAccuracy/gnEconomy/tournamentFinancials/guestFunnel`, `trpc.adminAnalytics.exportUsers/exportPayoutHistory` (mutations), `trpc.game.getGameHistory`, and `getAdminMetrics.activeByTier`.

- [ ] **Step 1: AdminDashboard — remove fake data, wire real**
  - Delete the `revenueData` "Mock revenue trend data" array (`~:60-66`). In the Revenue tab, replace the mock LineChart with a placeholder card: `Revenue trend arrives in the revenue release (SP2).` Do NOT render fake data.
  - Relabel the "Total Revenue" card subtitle/label to **"Entry-fee revenue"** (accurate to what SP1 computes).
  - Payouts tab: replace hardcoded "Pending Payouts $0.00" / "Failed Payouts 0" with values from `trpc.adminAnalytics.payoutPipeline.useQuery()` (sum the matching status rows; show pending, processing, completed, failed with counts + amounts).
  - Wire "Export User Data" button `onClick` → `const m = trpc.adminAnalytics.exportUsers.useMutation(); ... const { csv } = await m.mutateAsync(); downloadCsv(csv, 'users.csv')`. Wire "View Payout History" → `exportPayoutHistory` similarly. Add a small `downloadCsv(text, filename)` helper (Blob + anchor click).

- [ ] **Step 2: AdminDashboard — new "Analytics" tab**
  - Add an `analytics` tab to `VALID_TABS` and `TabsList`. In its `TabsContent`, render cards driven by `retention`, `songAccuracy`, `gnEconomy`, `tournamentFinancials`, `guestFunnel` queries (each `enabled: user?.role === 'admin'`). Use existing `Card` + recharts (`LineChart` for retention DAU/WAU/MAU; simple tables for the rest). Each card handles loading + empty states (no crash on `undefined`).

- [ ] **Step 3: UserDashboard — real history**
  - Replace the "Game history coming soon" block (`~:167-175`) with a list from `trpc.game.getGameHistory.useQuery({ limit: 20 })`: date, mode, genre/decade, score. Handle loading + empty ("No games yet").

- [ ] **Step 4: Typecheck + build**

Run: `pnpm check` — MUST pass.
Run: `pnpm exec vite build` — MUST build clean (pre-existing chunk-size warning is fine).

- [ ] **Step 5: Commit**

```bash
git add client/src/pages/AdminDashboard.tsx client/src/pages/UserDashboard.tsx
git commit -m "feat(admin-ui): real payout/analytics dashboards + user game history + CSV exports"
```

---

## Self-Review notes (addressed)

- **Spec coverage:** buggy fixes (T1) — active-subs all tiers + real total users; conversion rate corrected in UI (T10). payoutPipeline (T2), retention both series (T3), songAccuracy points>0 proxy ≥5 rounds (T4), gnEconomy GN-units (T5), tournamentFinancials fill-rate + pool (T6), guestFunnel email-match proxy (T7), CSV exports audit-logged (T8), real user game history (T9), UI wiring incl. revenue relabel + SP2 placeholder + dead-button wiring (T10). Revenue-dollar KPIs correctly deferred to SP2.
- **No migrations:** every task reads existing tables; the only additive non-schema change is possibly two audit-union strings (T8), consistent with the curated-contests precedent.
- **Type consistency:** `DayPoint`, `SongAcc`, `TF` shapes are defined once in their producing task and consumed only in T10 UI. `activeByTier` shape defined in T1, consumed in T10.
- **Known verification points flagged inline** (exact column names for prizePayouts/payoutRequests amount, tournamentMembers.tournamentId, tournaments.name, db.execute return shape, audit union additions) — implementers confirm against `drizzle/schema.ts` at build time rather than assuming.
