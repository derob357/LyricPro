# Admin Dot-Plot (Per-User Activity Grid) — Design

**Date:** 2026-07-08
**Status:** Approved (brainstorm complete)
**Motivation:** David Lieb's "dot plot" — aggregate metrics (DAU/MAU) hide how *individual* users use the product. A per-user × per-day grid surfaces pacing, streaks, one-and-done drop-off, and weekday/weekend patterns that aggregates can't. LyricPro already logs the per-event, per-actor data this needs.

## Purpose

Add a **User Activity** tab to the admin metrics page (`/admin?tab=activity`) rendering a GitHub-contribution-graph-style grid: **rows = individual actors (users + guests), columns = days**, cells marked by a real *value* event. Admin-only, internal founder tool.

## Decisions (from brainstorm)

| Question | Decision |
|---|---|
| Value event ("the #1 mistake is charting the wrong event") | **Both, as two symbols:** played a round (base) + completed a game (stronger). NOT `song_displays` (a lyric merely *shown* over-counts value). |
| Rows | **Both registered users AND guests**, guests visually distinguished; **not merged** (a guest + their later account = two rows; email-linkage is a future toggle). |
| Cell intensity | **Plain binary presence** (no GitHub-style count shading). The stronger event wins per cell. |
| Data source | **Raw query** over event tables (scale is trivial). No new rollup table. |
| Rendering | **Hand-built CSS grid** (no new chart dependency; recharts has no grid primitive). |

## Architecture

Server: one new admin-gated tRPC procedure `adminAnalytics.userActivity`. Client: one new extracted tab component `UserActivityTab.tsx`. Both follow existing patterns.

```
AdminDashboard.tsx
  VALID_TABS += "activity"                     (client/src/pages/AdminDashboard.tsx:39)
  <TabsTrigger value="activity">User Activity  (~line 205)
  <TabsContent value="activity"><UserActivityTab/>

client/src/pages/admin/tabs/UserActivityTab.tsx   (new)
  → trpc.adminAnalytics.userActivity.useQuery({ days, type, tier, newInWindowOnly, sort })
  → renders CSS grid + controls + legend

server/routers/adminAnalytics.ts
  userActivity: adminProcedure.input(...).query(...)   (new; sibling of `retention`)
  + exported pure helper shapeActivity(rows, opts)     (unit-tested)
```

## Data & query — `adminAnalytics.userActivity`

**Gate:** `adminProcedure` (same as every sibling procedure).

**Input (zod):**
```ts
{
  days: z.number().int().min(1).max(365).default(30),
  type: z.enum(["all", "registered", "guest"]).default("all"),
  tier: z.enum(["all", "free", "player", "pro", "elite"]).default("all"),
  newInWindowOnly: z.boolean().default(false),
  sort: z.enum(["first-seen", "recent", "active-days"]).default("first-seen"),
}
```

**Actor key** (the codebase's established uniform identity, adminAnalytics.ts:44):
`coalesce('u:'||"userId"::text, 'g:'||"guestToken")`.
Watch the column-name difference: `round_results` uses `"activePlayerId"` / `"activeGuestToken"`; `game_sessions` and `song_displays` use `"userId"` / `"guestToken"`.

**Query shape** (raw `sql.raw`, `days` interpolated after zod validation — exactly the `retention` procedure's convention):
1. `round_days` CTE — `SELECT date_trunc('day',"createdAt")::date AS day, coalesce('u:'||"activePlayerId"::text,'g:'||"activeGuestToken") AS actor FROM round_results WHERE "createdAt" >= now() - interval '<days> days'` → distinct `(actor, day)`.
2. `game_days` CTE — same over `game_sessions` where `"endedAt" IS NOT NULL`, ts col `"startedAt"`, actor `coalesce('u:'||"userId"::text,'g:'||"guestToken")` → distinct `(actor, day)` = **completed-game** days.
3. Actor set = union of actors from (1)+(2), filtered to those with ≥1 event in window.
4. Left-join `users` (on `id = <userId part>`) for registered-actor attributes (`rankTier`, `premiumStatus`, `favoriteGenre`, `gamesPlayed`, `loginMethod`, `createdAt`, `nickname`/`name`); left-join `subscriptions` for `tier`; left-join `guest_sessions` (on `sessionToken = <token part>`) for guest attributes (`nickname`, `marketingOptIn`, `email IS NOT NULL`).

**Output:**
```ts
{
  windowDays: string[];   // ordered day strings covering the range (columns)
  rows: Array<{
    actor: string;                 // "u:214" | "g:a1f9…"
    type: "registered" | "guest";
    label: string;                 // nickname/name, else "user #214" / "guest a1f9"
    tier: "free"|"player"|"pro"|"elite"|null;
    attrs: { rankTier?, premiumStatus?, favoriteGenre?, gamesPlayed?, loginMethod?, signupAt?, marketingOptIn?, hasEmail? };
    roundDays: string[];           // days with ≥1 round answered
    gameDays: string[];            // days a game was completed
    firstActivityDay: string;      // min day across roundDays ∪ gameDays (onboarding ring)
  }>;
}
```

**Filtering/sorting** happen in an exported pure helper `shapeActivity(rawRows, opts)` (so it's unit-testable without a DB): apply `type`/`tier`/`newInWindowOnly`, then sort (`first-seen` = firstActivityDay asc; `recent` = max day desc; `active-days` = |roundDays ∪ gameDays| desc). Rows capped at a sane max (e.g. 500) with a note when truncated — at single-digit DAU this never triggers, but it prevents a pathological payload.

Rows are limited to actors active in-window, so the payload is small and every row is meaningful.

## The visualization — `UserActivityTab.tsx`

GitHub-graph-style grid. Sticky left column = label + type badge; day columns scroll horizontally (`overflow-x: auto`). One symbol per cell (strongest signal wins):

| Symbol | Meaning |
|---|---|
| faint dot | no activity |
| open dot | played ≥1 round that day |
| filled dot | completed a full game that day |
| ring (around whichever symbol) | the actor's **first activity day** (onboarding) |

**Controls:** window preset (30/60/90 + custom range, reusing `isValidCalendarDate`-style validation); filter by type and tier; "new in window" toggle; sort dropdown (first-seen / recent / active-days).

**Interactions:** hover a cell → tooltip (date, rounds answered, games completed); hover a label → attribute popover. A legend + one-line reading guide ("look for: streaks, one-and-done rows, weekday vs weekend bands").

**Style:** hand-built CSS grid, small fixed cells; lucide outline icons for controls only; matches admin styling; **no emoji, no new chart dependency**. Suppressed/empty is a faint cell, never a misleading filled one.

## Testing

- **Server (vitest fake-db):** unit-test the pure `shapeActivity(rawRows, opts)` — actor keying from both column-naming schemes, round-day vs completed-game-day set construction, `firstActivityDay = min`, `type`/`tier`/`newInWindowOnly` filters, and each sort order. This is where the "chart the right event" correctness lives.
- **Client:** no client test harness → `pnpm check` + `pnpm exec vite build`; grid verified by loading `/admin?tab=activity`.

## Out of scope (recorded)

- No per-user-per-day **rollup table** — raw query suffices; revisit past ~thousands of active users.
- No guest→account **merging** — separate rows; email-linkage (`lower(email)` per `guest_conversions`) is a future toggle.
- No per-feature symbol overlays (Lieb's "used search → S") — LyricPro lacks clean distinct feature events; two-symbol scheme is v1.
- No sampling/print-for-scale, no CSV export — YAGNI now; easy adds later.
- **No new PII exposure** — shows the same identity the admin `users` tab already does; stays admin-only.

## Security checklist

- [ ] `userActivity` behind `adminProcedure` (no new unauthenticated surface)
- [ ] `days` zod-validated `int().min(1).max(365)` before `sql.raw` interpolation; no other user input reaches raw SQL (type/tier/sort are enums applied in JS, not SQL)
- [ ] tab gated client-side by `role === "admin"` like the others
- [ ] no secrets/env in code; admin-only identity display, no broadened exposure
