# Admin Dot-Plot (Per-User Activity Grid) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A "User Activity" admin tab rendering a GitHub-graph-style dot plot — rows = individual users/guests, columns = days, open dot = played ≥1 round, filled dot = completed a game, ring = first in-window activity day — with window/type/tier/new-user filters and three sort orders.

**Architecture:** One new admin-gated tRPC procedure `adminAnalytics.userActivity` (raw SQL over `round_results` + `game_sessions`, sibling of `retention`) returning per-actor day-sets shaped by an exported, unit-tested pure helper `shapeActivity`. One new extracted tab component `UserActivityTab.tsx` (hand-built CSS grid, no new deps) registered in `AdminDashboard`. Spec: `docs/superpowers/specs/2026-07-08-admin-dot-plot-design.md`.

**Tech Stack:** tRPC 11 + zod 4 + drizzle `sql.raw` (server), React 19 + shadcn Tabs/Select/Checkbox + Tailwind (client), vitest (server tests only).

## Global Constraints

- Value events (the load-bearing choice): open dot = ≥1 `round_results` row that day; filled dot = a `game_sessions` row with `"endedAt" IS NOT NULL` that day. NEVER `song_displays` (a lyric merely shown ≠ value).
- Actor identity: `coalesce('u:'||<userCol>::text, 'g:'||<guestCol>)`. Column names DIFFER per table: `round_results` → `"activePlayerId"`/`"activeGuestToken"`; `game_sessions` → `"userId"`/`"guestToken"`. Quoted camelCase everywhere in raw SQL.
- Day bucketing: plain `date_trunc('day', ts)::date` (UTC), matching the sibling `adminAnalytics.retention` convention — a deliberate consistency choice vs the KPI rollups' America/New_York days; documented in code comment.
- Only `input.days` (zod `int().min(1).max(365)`) is interpolated into `sql.raw` — the file's established convention. `type`/`tier`/`sort`/`newInWindowOnly` are applied in JS (`shapeActivity`), never in SQL.
- Guests and their later registered accounts = two separate rows (no email merging). Binary cells (no count shading); stronger event wins per cell.
- Row cap 500 post-sort with a `truncated` flag (never triggers at current scale; payload backstop).
- Resolved spec ambiguities (binding): (1) `newInWindowOnly` filters by **creation date** in-window (`users."createdAt"` / `guest_sessions."createdAt"`) — first-*activity*-day would be a no-op since every visible actor's first activity is in-window by construction; the ring still marks first in-window activity per spec. (2) "Custom range" = a numeric **day-count** input (1–365), matching the days-based procedure input — not from/to pickers. (3) Cell tooltips show presence text (date + "played a round" / "completed a game" / "first day"), not counts — cells are binary.
- Client: lucide-react outline icons only, NEVER emoji; no new chart dependency; admin gate is the page's existing `role === "admin"` check.
- TypeScript strict/ESM. Server tests: `pnpm test:server <path>`. Client verification: `pnpm check` + `pnpm exec vite build`. Conventional commits, NO Co-Authored-By trailer. Env var names only, never values; don't Read .env.

---

### Task 1: `shapeActivity` helper + `adminAnalytics.userActivity` procedure (TDD)

**Files:**
- Modify: `server/routers/adminAnalytics.ts` (add exported types + `shapeActivity` above the router; add `userActivity` procedure after `retention`, ~line 65)
- Test: `server/routers/adminAnalytics.test.ts` (new)

**Interfaces:**
- Consumes: existing `adminProcedure`, `getDb`, `requireDb`, `sql` — all already imported in the file.
- Produces (Task 2 relies on these exact shapes):
  - `trpc.adminAnalytics.userActivity.useQuery(input)` with input `{ days?: number; type?: "all"|"registered"|"guest"; tier?: "all"|"free"|"player"|"pro"|"elite"; newInWindowOnly?: boolean; sort?: "first-seen"|"recent"|"active-days" }` (all defaulted)
  - Returns `ActivityResult = { windowDays: string[]; rows: ActivityRow[]; truncated: boolean }` where `ActivityRow = { actor: string; type: "registered"|"guest"; label: string; tier: "free"|"player"|"pro"|"elite"|null; attrs: { rankTier?: string|null; premiumStatus?: boolean|null; favoriteGenre?: string|null; gamesPlayed?: number|null; loginMethod?: string|null; signupAt?: string|null; marketingOptIn?: boolean|null; hasEmail?: boolean|null; createdAt?: string|null }; roundDays: string[]; gameDays: string[]; firstActivityDay: string }`
  - Exported for tests: `shapeActivity(rows: ActivityEventRow[], opts, today?: Date): ActivityResult` and `type ActivityEventRow`

- [ ] **Step 1: Write the failing test**

```typescript
// server/routers/adminAnalytics.test.ts
import { describe, expect, it } from "vitest";
import { shapeActivity, type ActivityEventRow } from "./adminAnalytics";

const TODAY = new Date("2026-07-08T12:00:00Z");
const OPTS = { days: 7, type: "all", tier: "all", newInWindowOnly: false, sort: "first-seen" } as const;

function ev(partial: Partial<ActivityEventRow>): ActivityEventRow {
  return {
    actor: "u:1", day: "2026-07-05", kind: "round",
    user_name: null, rank_tier: null, premium_status: null, favorite_genre: null,
    games_played: null, login_method: null, signup_at: null, sub_tier: null,
    guest_nickname: null, guest_created_at: null, marketing_opt_in: null, has_email: null,
    ...partial,
  };
}

describe("shapeActivity", () => {
  it("builds a continuous windowDays of exactly `days` columns ending today (UTC)", () => {
    const out = shapeActivity([], OPTS, TODAY);
    expect(out.windowDays).toHaveLength(7);
    expect(out.windowDays[0]).toBe("2026-07-02");
    expect(out.windowDays[6]).toBe("2026-07-08");
    expect(out.rows).toEqual([]);
    expect(out.truncated).toBe(false);
  });

  it("groups events per actor into roundDays/gameDays and firstActivityDay = min", () => {
    const out = shapeActivity([
      ev({ actor: "u:1", day: "2026-07-05", kind: "round", user_name: "Dave" }),
      ev({ actor: "u:1", day: "2026-07-06", kind: "game", user_name: "Dave" }),
      ev({ actor: "u:1", day: "2026-07-06", kind: "round", user_name: "Dave" }),
    ], OPTS, TODAY);
    expect(out.rows).toHaveLength(1);
    const r = out.rows[0]!;
    expect(r.roundDays).toEqual(["2026-07-05", "2026-07-06"]);
    expect(r.gameDays).toEqual(["2026-07-06"]);
    expect(r.firstActivityDay).toBe("2026-07-05");
    expect(r.label).toBe("Dave");
    expect(r.type).toBe("registered");
  });

  it("labels fall back: registered → 'user #<id>', guest → nickname else 'guest <tok4>'", () => {
    const out = shapeActivity([
      ev({ actor: "u:214" }),
      ev({ actor: "g:a1f9bc22", guest_nickname: null }),
      ev({ actor: "g:zz88xx", guest_nickname: "Sam" }),
    ], OPTS, TODAY);
    const labels = Object.fromEntries(out.rows.map((r) => [r.actor, r.label]));
    expect(labels["u:214"]).toBe("user #214");
    expect(labels["g:a1f9bc22"]).toBe("guest a1f9");
    expect(labels["g:zz88xx"]).toBe("Sam");
  });

  it("tier: subscription tier for registered (default free), null for guests", () => {
    const out = shapeActivity([
      ev({ actor: "u:1", sub_tier: "pro" }),
      ev({ actor: "u:2" }),
      ev({ actor: "g:tok" }),
    ], OPTS, TODAY);
    const tiers = Object.fromEntries(out.rows.map((r) => [r.actor, r.tier]));
    expect(tiers["u:1"]).toBe("pro");
    expect(tiers["u:2"]).toBe("free");
    expect(tiers["g:tok"]).toBeNull();
  });

  it("type filter keeps only the requested kind; tier filter excludes guests", () => {
    const rows = [ev({ actor: "u:1", sub_tier: "pro" }), ev({ actor: "g:tok" })];
    expect(shapeActivity(rows, { ...OPTS, type: "guest" }, TODAY).rows.map((r) => r.actor)).toEqual(["g:tok"]);
    expect(shapeActivity(rows, { ...OPTS, tier: "pro" }, TODAY).rows.map((r) => r.actor)).toEqual(["u:1"]);
    expect(shapeActivity(rows, { ...OPTS, tier: "free" }, TODAY).rows).toEqual([]);
  });

  it("newInWindowOnly filters by CREATION date in-window (not first activity)", () => {
    const rows = [
      ev({ actor: "u:1", signup_at: "2026-07-04T10:00:00Z" }),   // created in window
      ev({ actor: "u:2", signup_at: "2026-05-01T10:00:00Z" }),   // old account, active now
      ev({ actor: "g:new", guest_created_at: "2026-07-06T09:00:00Z" }),
      ev({ actor: "g:old", guest_created_at: "2026-01-01T09:00:00Z" }),
    ];
    const out = shapeActivity(rows, { ...OPTS, newInWindowOnly: true }, TODAY);
    expect(out.rows.map((r) => r.actor).sort()).toEqual(["g:new", "u:1"]);
  });

  it("sorts: first-seen asc (default), recent desc, active-days desc; actor tiebreak", () => {
    const rows = [
      ev({ actor: "u:1", day: "2026-07-03" }), ev({ actor: "u:1", day: "2026-07-07" }),
      ev({ actor: "u:2", day: "2026-07-02" }),
      ev({ actor: "u:3", day: "2026-07-05" }), ev({ actor: "u:3", day: "2026-07-06" }), ev({ actor: "u:3", day: "2026-07-08" }),
    ];
    expect(shapeActivity(rows, OPTS, TODAY).rows.map((r) => r.actor)).toEqual(["u:2", "u:1", "u:3"]);
    expect(shapeActivity(rows, { ...OPTS, sort: "recent" }, TODAY).rows.map((r) => r.actor)).toEqual(["u:3", "u:1", "u:2"]);
    expect(shapeActivity(rows, { ...OPTS, sort: "active-days" }, TODAY).rows.map((r) => r.actor)).toEqual(["u:3", "u:1", "u:2"]);
  });

  it("caps rows at 500 and sets truncated", () => {
    const rows: ActivityEventRow[] = [];
    for (let i = 0; i < 501; i++) rows.push(ev({ actor: `u:${i}`, day: "2026-07-05" }));
    const out = shapeActivity(rows, OPTS, TODAY);
    expect(out.rows).toHaveLength(500);
    expect(out.truncated).toBe(true);
  });
});
```

- [ ] **Step 2: Run to verify failure**

Run: `pnpm test:server server/routers/adminAnalytics.test.ts`
Expected: FAIL — `shapeActivity` is not exported from `./adminAnalytics`.

- [ ] **Step 3: Implement `shapeActivity` + types in adminAnalytics.ts**

Add above `export const adminAnalyticsRouter`:

```typescript
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
    const allDays = [...new Set([...a.rounds, ...a.games])].sort();
    return {
      actor, type, label, tier,
      attrs: {
        rankTier: a.first.rank_tier, premiumStatus: a.first.premium_status,
        favoriteGenre: a.first.favorite_genre, gamesPlayed: a.first.games_played,
        loginMethod: a.first.login_method, signupAt: a.first.signup_at,
        marketingOptIn: a.first.marketing_opt_in, hasEmail: a.first.has_email,
        createdAt: a.first.signup_at ?? a.first.guest_created_at,
      },
      roundDays: [...a.rounds].sort(),
      gameDays: [...a.games].sort(),
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
```

- [ ] **Step 4: Run to verify pass**

Run: `pnpm test:server server/routers/adminAnalytics.test.ts`
Expected: 8 passed.

- [ ] **Step 5: Add the `userActivity` procedure**

Insert into `adminAnalyticsRouter` immediately after the `retention` procedure (~line 65):

```typescript
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
```

- [ ] **Step 6: Typecheck + full server suite**

Run: `pnpm check` → clean. Run: `pnpm test:server` → all files pass, including the 8 new `adminAnalytics.test.ts` tests. Any pre-existing skipped suites are fine; any pre-existing failure you didn't cause, report — don't fix.

- [ ] **Step 7: Live smoke via dev bypass (verifies the SQL against real prod tables)**

Start `pnpm dev` in the background, wait for it to listen on port 3000. `DEV_AUTH_BYPASS=1` in local `.env` synthesizes an admin-role user for unauthenticated tRPC requests (dev-only), so:

```bash
curl -sG "http://localhost:3000/api/trpc/adminAnalytics.userActivity" \
  --data-urlencode 'input={"json":{"days":90}}' | head -c 600
```

Expected: HTTP 200, JSON containing `"windowDays"` (90 entries) and `"rows"` — with real actors (the backfilled/live play data) each having `roundDays`/`gameDays`/`firstActivityDay`. If the response is a tRPC error naming a column, fix the SQL column name against `drizzle/schema.ts` and re-run. Kill the dev server afterward.

- [ ] **Step 8: Commit**

```bash
git add server/routers/adminAnalytics.ts server/routers/adminAnalytics.test.ts
git commit -m "feat(admin): userActivity dot-plot procedure + shapeActivity (TDD)"
```

---

### Task 2: `UserActivityTab` grid + AdminDashboard registration

**Files:**
- Create: `client/src/pages/admin/tabs/UserActivityTab.tsx`
- Modify: `client/src/pages/AdminDashboard.tsx` — `VALID_TABS` (line 39), tab import block (lines 9–16), `TabsTrigger` list (~line 205), plus a matching `TabsContent`

**Interfaces:**
- Consumes: `trpc.adminAnalytics.userActivity.useQuery` with the Task 1 input/output shapes; shadcn `Select`, `Checkbox`, `Card` from `@/components/ui/*`; `trpc` from `@/lib/trpc`.

- [ ] **Step 1: Implement UserActivityTab.tsx**

```tsx
// client/src/pages/admin/tabs/UserActivityTab.tsx
// Dot plot: rows = individual users/guests, columns = days. Surfaces pacing,
// streaks, one-and-done drop-off, and weekday/weekend patterns that aggregate
// charts (DAU/MAU) hide. Open dot = played a round; filled = completed a game;
// ring = first in-window activity day.
import { useState } from "react";
import { trpc } from "@/lib/trpc";
import { Card } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";

type SortKey = "first-seen" | "recent" | "active-days";
type TypeKey = "all" | "registered" | "guest";
type TierKey = "all" | "free" | "player" | "pro" | "elite";

const CELL = 16; // px, square cells

function Dot({ round, game, ring }: { round: boolean; game: boolean; ring: boolean }) {
  // Strongest signal wins: filled (game) > open (round) > faint (none).
  const core = game ? (
    <span className="block h-2.5 w-2.5 rounded-full bg-primary" />
  ) : round ? (
    <span className="block h-2.5 w-2.5 rounded-full border-2 border-primary" />
  ) : (
    <span className="block h-1 w-1 rounded-full bg-muted-foreground/25" />
  );
  return (
    <span className={`flex h-full w-full items-center justify-center ${ring ? "rounded-full ring-2 ring-amber-500" : ""}`}>
      {core}
    </span>
  );
}

export default function UserActivityTab() {
  const [days, setDays] = useState(30);
  const [customDays, setCustomDays] = useState("");
  const [type, setType] = useState<TypeKey>("all");
  const [tier, setTier] = useState<TierKey>("all");
  const [newOnly, setNewOnly] = useState(false);
  const [sort, setSort] = useState<SortKey>("first-seen");

  const q = trpc.adminAnalytics.userActivity.useQuery({ days, type, tier, newInWindowOnly: newOnly, sort });

  const applyCustom = () => {
    const n = Number(customDays);
    if (Number.isInteger(n) && n >= 1 && n <= 365) setDays(n);
  };

  const windowDays = q.data?.windowDays ?? [];
  const rows = q.data?.rows ?? [];

  // Month labels: show a label on the first column of each month in-window.
  const monthLabels = windowDays.map((d, i) => {
    const prev = windowDays[i - 1];
    const label = !prev || prev.slice(0, 7) !== d.slice(0, 7)
      ? new Date(`${d}T00:00:00Z`).toLocaleString("en-US", { month: "short", timeZone: "UTC" })
      : "";
    return label;
  });

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        <Select value={String(days)} onValueChange={(v) => { setDays(Number(v)); setCustomDays(""); }}>
          <SelectTrigger className="w-28"><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="30">30 days</SelectItem>
            <SelectItem value="60">60 days</SelectItem>
            <SelectItem value="90">90 days</SelectItem>
            {![30, 60, 90].includes(days) ? <SelectItem value={String(days)}>{days} days</SelectItem> : null}
          </SelectContent>
        </Select>
        <input
          type="number" min={1} max={365} placeholder="custom"
          className="w-20 rounded-md border bg-background px-2 py-1.5 text-sm"
          value={customDays}
          onChange={(e) => setCustomDays(e.target.value)}
          onKeyDown={(e) => { if (e.key === "Enter") applyCustom(); }}
          onBlur={applyCustom}
        />
        <Select value={type} onValueChange={(v) => setType(v as TypeKey)}>
          <SelectTrigger className="w-32"><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All users</SelectItem>
            <SelectItem value="registered">Registered</SelectItem>
            <SelectItem value="guest">Guests</SelectItem>
          </SelectContent>
        </Select>
        <Select value={tier} onValueChange={(v) => setTier(v as TierKey)}>
          <SelectTrigger className="w-28"><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All tiers</SelectItem>
            <SelectItem value="free">Free</SelectItem>
            <SelectItem value="player">Player</SelectItem>
            <SelectItem value="pro">Pro</SelectItem>
            <SelectItem value="elite">Elite</SelectItem>
          </SelectContent>
        </Select>
        <label className="flex items-center gap-2 text-sm">
          <Checkbox checked={newOnly} onCheckedChange={(v) => setNewOnly(v === true)} />
          New in window
        </label>
        <Select value={sort} onValueChange={(v) => setSort(v as SortKey)}>
          <SelectTrigger className="w-40"><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="first-seen">Sort: first seen</SelectItem>
            <SelectItem value="recent">Sort: most recent</SelectItem>
            <SelectItem value="active-days">Sort: most active</SelectItem>
          </SelectContent>
        </Select>
      </div>

      <Card className="p-4">
        <div className="mb-3 flex flex-wrap items-center gap-4 text-xs text-muted-foreground">
          <span className="flex items-center gap-1.5"><span className="h-2.5 w-2.5 rounded-full border-2 border-primary" /> played a round</span>
          <span className="flex items-center gap-1.5"><span className="h-2.5 w-2.5 rounded-full bg-primary" /> completed a game</span>
          <span className="flex items-center gap-1.5"><span className="h-2.5 w-2.5 rounded-full border-2 border-primary ring-2 ring-amber-500" /> first day in window</span>
          <span>Look for: streaks, one-and-done rows, weekday vs weekend bands.</span>
        </div>

        {q.isLoading ? (
          <p className="py-8 text-center text-sm text-muted-foreground">Loading…</p>
        ) : q.error ? (
          <p className="py-8 text-center text-sm text-red-600">{q.error.message}</p>
        ) : rows.length === 0 ? (
          <p className="py-8 text-center text-sm text-muted-foreground">No activity in this window with these filters.</p>
        ) : (
          <div className="overflow-x-auto">
            <div
              className="grid w-max"
              style={{ gridTemplateColumns: `max-content repeat(${windowDays.length}, ${CELL}px)` }}
            >
              {/* month header row */}
              <div className="sticky left-0 z-10 bg-card" />
              {monthLabels.map((m, i) => (
                <div key={windowDays[i]} className="h-5 text-[10px] text-muted-foreground">{m}</div>
              ))}
              {/* one row per actor */}
              {rows.map((r) => (
                <div key={r.actor} className="contents">
                  <div
                    className="sticky left-0 z-10 flex items-center gap-1.5 bg-card pr-3 text-sm"
                    style={{ height: CELL + 2 }}
                    title={[
                      r.attrs.rankTier && `rank: ${r.attrs.rankTier}`,
                      r.attrs.favoriteGenre && `genre: ${r.attrs.favoriteGenre}`,
                      r.attrs.gamesPlayed != null && `games: ${r.attrs.gamesPlayed}`,
                      r.attrs.loginMethod && `login: ${r.attrs.loginMethod}`,
                      r.attrs.createdAt && `created: ${r.attrs.createdAt.slice(0, 10)}`,
                      r.type === "guest" && (r.attrs.hasEmail ? "has email" : "no email"),
                    ].filter(Boolean).join(" · ")}
                  >
                    <span className="max-w-40 truncate">{r.label}</span>
                    {r.type === "guest" ? (
                      <span className="rounded bg-muted px-1 text-[10px] text-muted-foreground">guest</span>
                    ) : r.tier && r.tier !== "free" ? (
                      <span className="rounded bg-muted px-1 text-[10px] text-muted-foreground">{r.tier}</span>
                    ) : null}
                  </div>
                  {windowDays.map((d) => {
                    const round = r.roundDays.includes(d);
                    const game = r.gameDays.includes(d);
                    const ring = d === r.firstActivityDay;
                    const what = game ? "completed a game" : round ? "played a round" : "no activity";
                    return (
                      <div key={d} style={{ height: CELL + 2 }} title={`${d}: ${what}${ring ? " · first day" : ""}`}>
                        <Dot round={round} game={game} ring={ring} />
                      </div>
                    );
                  })}
                </div>
              ))}
            </div>
            {q.data?.truncated ? (
              <p className="mt-2 text-xs text-muted-foreground">Showing first 500 rows — narrow the filters to see the rest.</p>
            ) : null}
          </div>
        )}
      </Card>
    </div>
  );
}
```

- [ ] **Step 2: Register the tab in AdminDashboard.tsx**

Three edits:

1. Line 39 — add `"activity"`:
```typescript
const VALID_TABS = ["overview", "users", "revenue", "payouts", "analytics", "activity", "songs", "genres", "log", "usage", "suggestions", "commentary", "banners", "vendors"] as const;
```
2. With the tab imports (lines 9–16): `import UserActivityTab from "./admin/tabs/UserActivityTab";`
3. In the `TabsList`, after the Analytics trigger: `<TabsTrigger value="activity">User Activity</TabsTrigger>` — and alongside the other `TabsContent` blocks: `<TabsContent value="activity"><UserActivityTab /></TabsContent>`

- [ ] **Step 3: Verify**

Run: `pnpm check` → clean. Run: `pnpm exec vite build` → clean (pre-existing >500kB chunk warning only).

- [ ] **Step 4: Live look (owner-verifiable)**

Start `pnpm dev`, open `http://localhost:3000/admin?tab=activity` as an admin (or rely on the dev bypass). Expected: the grid renders real rows with dots; controls re-query; hovering cells shows date + activity text. Note the result in the report (screenshot not required). Kill the dev server.

- [ ] **Step 5: Commit**

```bash
git add client/src/pages/admin/tabs/UserActivityTab.tsx client/src/pages/AdminDashboard.tsx
git commit -m "feat(admin-ui): User Activity dot-plot tab"
```
