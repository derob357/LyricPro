# Admin Analytics — Real Data (Sub-Project 1) Design

> **Status:** Approved (design); pending spec review.
> **Date:** 2026-07-05

## Background

An audit of Lyric Pro's KPI/reporting surface found that core gameplay analytics
are real and DB-backed, but several **admin business KPIs are mocked, hardcoded,
or quietly buggy** — and they render as if real in the admin dashboard, which is
the dangerous part. The goal is to make the admin reporting real.

The full effort spans three dependency-ordered **sub-projects**, each with its own
spec → plan → build:

1. **SP1 (this doc) — Admin analytics from existing data.** No new external
   integrations, no schema migrations. Fix the buggy KPIs and build every report
   that existing tables can already back.
2. **SP2 — Revenue truth (Stripe).** New `revenue_events` table fed by Stripe
   webhooks → real Total Revenue (correct scope + label), Revenue-trend series,
   MRR + churn. Gets dedicated web research (Stripe webhook gotchas) first.
3. **SP3 — Referrals feature.** Schema + signup attribution + GN reward economy +
   real `getReferralStats`/claim, replacing the hardcoded stub.

The "Total Revenue" buggy fix belongs to **SP2**, not SP1, because its correct
value depends on the Stripe revenue data SP2 introduces.

## Goals (SP1)

- Correct the three buggy admin KPIs that currently mislead.
- Replace hardcoded/placeholder admin widgets (pending/failed payouts) with real data.
- Add real admin analytics reports that existing tables can back: retention,
  per-song accuracy, GN economy, tournament financials, guest funnel, payout pipeline.
- Make the user-facing game-history and export buttons real.

## Non-Goals (SP1)

- No dollar-revenue KPIs (Total Revenue, Revenue-trend chart, MRR, churn) — SP2.
- No referrals work — SP3.
- No schema migrations. SP1 is read-only aggregation over existing tables plus
  surgical edits to existing procedures.
- No changes to how events are recorded (SP1 only reads existing event data).

## Architecture

SP1 is **read-only admin analytics**. One new admin-gated tRPC router,
`adminAnalytics` (`server/routers/adminAnalytics.ts`), holds the new report
procedures. The three buggy-KPI fixes are surgical edits to `getAdminMetrics`
in `server/db-monetization.ts`. The user-facing game-history addition extends the
existing `game` router. UI wires new dashboard tabs/cards + CSV export handlers to
the new procedures.

Each report procedure:
- is gated by `adminProcedure` (except the user game-history, which is
  `protectedProcedure` scoped to the caller),
- performs pure SQL aggregation over existing tables (no writes, no schema change),
- returns a typed shape,
- degrades to zeros/empty arrays on no data (never throws on emptiness),
- throws `INTERNAL_SERVER_ERROR` only when the DB is unavailable.

Register `adminAnalytics` in `server/app-router.ts` alongside the other admin routers.

## Detailed Design

### 1. Buggy KPI fixes — `server/db-monetization.ts` `getAdminMetrics`

- **Active Subscriptions.** Change the filter from `status='active' AND tier='player'`
  to `status='active' AND tier IN ('player','pro','elite')`. Add a per-tier
  breakdown object `activeByTier: { player, pro, elite }` to the return value.
- **Total Users.** Replace `tierStats.length` (a subscription-row count) with a real
  `SELECT COUNT(*) FROM users`.
- **Conversion Rate.** Recompute in the UI (`AdminDashboard.tsx`) from the corrected
  `activeSubscriptions / totalUsers`. No formula change, just correct inputs.

The `getAdminMetrics` return type gains `activeByTier` and a corrected `totalUsers`;
existing consumers keep working (additive change).

### 2. `adminAnalytics` router — new report procedures

Actor identity for gameplay events: `actorKey = userId IS NOT NULL ? 'u:'||userId : 'g:'||guestToken`.

- **`payoutPipeline()`** — group `prize_payouts` by `status` (`pending`/`processing`/
  `completed`/`failed`) → `{ status, count, totalAmount }[]`; group `payout_requests`
  by `status` (`pending`/`approved`/`rejected`/`paid`) → same shape. Returns
  `{ prizePayouts: [...], payoutRequests: [...] }`. Replaces the dashboard's hardcoded
  "Pending Payouts $0.00" / "Failed Payouts 0".

- **`retention({ days=90 })`** — two daily series, both keyed by day (UTC):
  - `roundsSeries` from `song_displays.shownAt`: `dau` = distinct `actorKey` that day.
  - `gamesSeries` from `leaderboard_entries.createdAt`: `dau` = distinct actor that day.
  - For each series also compute rolling `wau` (7-day distinct) and `mau` (30-day
    distinct) per day. Return `{ roundsSeries: DayPoint[], gamesSeries: DayPoint[] }`
    where `DayPoint = { day, dau, wau, mau }`.

- **`songAccuracy({ limit=20 })`** — from `round_results`, grouped by `songId`, joined
  to `songs` for title/artist. Accuracy per category = share of rounds where the
  category's points > 0 (`lyricPoints`/`artistPoints`/`yearPoints`). **Modeling note:**
  `round_results` stores points, not a boolean correct flag; points > 0 is the
  correctness proxy. Return per song: `{ songId, title, artistName, rounds,
  lyricRate, artistRate, yearRate, overallRate }`, plus `hardest`/`easiest` slices
  (top/bottom `limit` by `overallRate`, restricted to songs with `rounds >= 5` to avoid small-sample noise).

- **`gnEconomy()`** — from `golden_note_transactions`:
  `circulation` (Σ of current balances from the GN balance table),
  `totalCredited` (Σ positive amounts), `totalDebited` (Σ |negative amounts|),
  `byReason` (`{ reason, credited, debited, net, count }[]`),
  `purchasedCount`/`purchasedAmount` (rows with non-null `stripePaymentIntentId`,
  in GN units — USD deferred to SP2). All amounts in GN units.

- **`tournamentFinancials()`** — per-tournament + rollup. Fill rate =
  `rosterSize / capacity` (null capacity → null fill rate). Pool collected vs paid
  via `prize_pools` + entry-fee participation. Counts by `status`
  (draft/open/active/complete/cancelled). Return `{ tournaments: [...], rollup: {...} }`.

- **`guestFunnel({ days=90 })`** — from `guest_sessions`:
  `totalGuests`, `leads` (email non-null), `optIns` (`marketingOptIn=true`),
  `converted` (guest.email matches a `users.email`, case-insensitive), and derived
  rates. Return counts + a per-day new-guest series. UI labels `converted` as an
  email-match **proxy** (no direct guest→user link exists in SP1).

### 3. User game history — `game` router

- **`getGameHistory({ limit=20 })`** (`protectedProcedure`) — last `limit`
  `leaderboard_entries` rows for `ctx.user.id`, newest first:
  `{ playedAt, score, mode, genre, decade, rank? }[]`. Replaces the
  "Game history coming soon" stub in `UserDashboard.tsx`.

### 4. CSV export procedures — `adminAnalytics`

- **`exportUsers()`** — CSV of user rows (id, email, createdAt, tier, status,
  lifetimeScore, gamesPlayed). Audit-logged via `recordAdminAction`.
- **`exportPayoutHistory()`** — CSV of `prize_payouts` (+ requester) rows.
  Audit-logged. Wire both to the currently-dead dashboard buttons.

CSV generation mirrors the existing `adminUsage.exportCsv` conventions.

### 5. UI wiring — `client/src`

- **AdminDashboard.tsx:**
  - Delete the "Mock revenue trend data" array and the Revenue-trend LineChart usage
    is left as a clearly-labeled "Coming in revenue release (SP2)" placeholder — do
    NOT show fake data. (Real trend arrives in SP2.)
  - Payouts tab: replace hardcoded pending/failed with `payoutPipeline()` data.
  - New "Analytics" tab (or sub-tabs) surfacing retention, song accuracy, GN economy,
    tournament financials, guest funnel.
  - Wire "Export User Data" → `exportUsers`, "View Payout History" → `exportPayoutHistory`.
  - Correct the "Total Revenue" card LABEL to "Entry-fee revenue" for now (accurate to
    what SP1 shows) — full revenue lands in SP2.
- **UserDashboard.tsx:** History tab renders `getGameHistory` results.

### Error Handling

- DB unavailable → `INTERNAL_SERVER_ERROR` (existing pattern).
- Empty data → zeros / empty arrays; never an error.
- All admin procedures reject non-admins via `adminProcedure`; `getGameHistory` is
  caller-scoped via `protectedProcedure`.
- CSV exports are audit-logged (`recordAdminAction`) like existing exports.

### Testing

Following the project's existing pattern (offline gate test + `liveDescribe`
aggregation test that skips without a DB):

- **Gate tests (offline, must pass):** each `adminAnalytics` procedure rejects a
  non-admin caller; `getGameHistory` rejects an unauthenticated caller.
- **Aggregation tests (`liveDescribe`, skip without DB):** seed minimal rows and
  assert each report's shape + a computed value (e.g., retention DAU counts distinct
  actors; songAccuracy computes points>0 rate; payoutPipeline groups by status;
  guestFunnel email-match conversion).
- **Buggy-fix tests:** an offline/unit-level assertion that the active-subs query
  includes all three paid tiers and total-users counts the users table (via a small
  seeded live test or a query-shape test).
- `pnpm check` (typecheck) must pass; existing suites must stay green.

## Rollout

No migration. Ships as one branch → PR. Each procedure is independently reviewable.
UI degrades gracefully if a procedure errors (per-card error/empty states).

## Open Questions

None blocking. USD valuation of GN and real revenue are explicitly deferred to SP2.
