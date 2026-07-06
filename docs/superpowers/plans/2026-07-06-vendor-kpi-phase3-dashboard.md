# Vendor KPI Phase 3 — /vendor Dashboard Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Vendor-role users get a `/vendor` dashboard — tabbed KPI charts (only their granted families), date-range/granularity controls, CSV export, definition footnotes, and an API Access page — served by a tRPC `vendorRouter` reading the same `kpiQueries` layer as the REST API so numbers cannot drift.

**Architecture:** A `vendorProcedure` (new, in `server/_core/trpc.ts`) resolves the caller's `vendor_members → vendors` row into ctx; `server/routers/vendor.ts` exposes typed queries per family plus `exportCsv` (which reuses `handleMetrics` from Phase 2, guaranteeing identical numbers/CSV). Client: `/vendor` route self-gated like `/admin`, shadcn Tabs + recharts per the AdminDashboard conventions, tabs rendered from the vendor's scopes. Spec: `docs/superpowers/specs/2026-07-02-vendor-kpi-dashboard-api-design.md` (Phase 3 + "Vendor Dashboard" section).

**Tech Stack:** tRPC 11 + zod 4 (server), React 19 + wouter + shadcn/ui + recharts 2 + sonner (client), vitest fake-db (server tests only — no client test harness exists).

## Global Constraints

- Suppressed cells (`{value: null, suppressed: true}`) render as `•••` in tables/stat cards and as gaps in charts (`null` + `connectNulls={false}`) — NEVER as 0.
- Every chart/table card shows its definition footnote (from `vendor.me` definitions payload) — spec's diligence-standard requirement.
- Tabs render ONLY in-scope families (from `vendor.me` scopes) + an always-present "API Access" tab. No vendor-visible PII anywhere; key material limited to prefix/last4.
- Client gate mirrors `/admin`: `useAuth()` + `user?.role === "vendor"` → else "Access Denied: Vendor only" panel (`AdminDashboard.tsx:78-84` pattern). Server truth is `vendorProcedure` (membership + `status === 'active'`), NOT the role.
- Icons: lucide-react outline only, NEVER emoji (hard project rule).
- Date validation identical to REST: `YYYY-MM-DD`, calendar-valid, `from <= to`, ≤400-day span → reuse `isValidCalendarDate` (export it from vendorApi).
- Scope map reused from Phase 2: export `SCOPE_MAP` from `server/vendor/vendorApi.ts`; family enum `growth|engagement|content|monetization`.
- Chart colors: follow `AdminDashboard.tsx:96` convention (`#ef4444 #3b82f6 #a855f7 #f59e0b`).
- TypeScript strict/ESM; server tests `pnpm test:server <path>`; client verification = `pnpm check` + `pnpm exec vite build`.
- Conventional commits, NO Co-Authored-By trailer. Env var names only, never values; don't Read .env.

---

### Task 1: `resolveVendorForUser` + `vendorProcedure` (TDD)

**Files:**
- Create: `server/vendor/vendorResolve.ts`
- Test: `server/vendor/vendorResolve.test.ts`
- Modify: `server/_core/trpc.ts` (append `vendorProcedure` after `adminProcedure`)

**Interfaces:**
- Consumes: `VendorAuth` type from `server/vendor/vendorAuth.ts` (the `vendor` sub-shape), `getDb` from `server/db.ts`, `TrpcContext`.
- Produces:
  - `type ResolvedVendor = VendorAuth["vendor"]` (re-exported from vendorResolve.ts)
  - `resolveVendorForUser(db, userId: number): Promise<ResolvedVendor | null>` — null when no membership OR vendor not `active`
  - `vendorProcedure` exported from `server/_core/trpc.ts` — ctx gains `vendor: ResolvedVendor` and `db` (non-null)

- [ ] **Step 1: Write the failing test**

```typescript
// server/vendor/vendorResolve.test.ts
import { describe, expect, it, vi } from "vitest";
import { resolveVendorForUser } from "./vendorResolve";

function makeFakeDb(queue: unknown[][]) {
  let call = 0;
  return { execute: vi.fn().mockImplementation(() => Promise.resolve(queue[call++] ?? [])) };
}

const ROW = {
  id: 3, name: "Acme", status: "active",
  scope_growth: true, scope_engagement: false, scope_content: true, scope_monetization: false,
  catalog_filter: { artists: ["Queen"] },
};

describe("resolveVendorForUser", () => {
  it("resolves an active vendor membership into the VendorAuth vendor shape", async () => {
    const db = makeFakeDb([[ROW]]);
    expect(await resolveVendorForUser(db as never, 42)).toEqual({
      id: 3, name: "Acme", status: "active",
      scopeGrowth: true, scopeEngagement: false, scopeContent: true, scopeMonetization: false,
      catalogFilter: { artists: ["Queen"] },
    });
  });
  it("returns null when the user has no membership", async () => {
    const db = makeFakeDb([[]]);
    expect(await resolveVendorForUser(db as never, 42)).toBeNull();
  });
  it("returns null when the vendor is suspended", async () => {
    const db = makeFakeDb([[{ ...ROW, status: "suspended" }]]);
    expect(await resolveVendorForUser(db as never, 42)).toBeNull();
  });
});
```

- [ ] **Step 2: Run to verify failure**

Run: `pnpm test:server server/vendor/vendorResolve.test.ts` → FAIL (module not found).

- [ ] **Step 3: Implement vendorResolve.ts**

```typescript
// server/vendor/vendorResolve.ts
// Resolves a signed-in user's vendor membership for the tRPC vendorProcedure.
// The membership row + active vendor status is the authority — the user's
// role enum is only a client-side hint.
import { sql } from "drizzle-orm";
import type { getDb } from "../db";
import type { VendorAuth } from "./vendorAuth";

type Db = NonNullable<Awaited<ReturnType<typeof getDb>>>;
export type ResolvedVendor = VendorAuth["vendor"];

function toRows(result: unknown): Record<string, unknown>[] {
  return Array.isArray(result)
    ? (result as Record<string, unknown>[])
    : Array.from(result as Iterable<Record<string, unknown>>);
}

export async function resolveVendorForUser(db: Db, userId: number): Promise<ResolvedVendor | null> {
  const rows = toRows(
    await db.execute(sql`
      SELECT v.id, v.name, v.status,
             v.scope_growth, v.scope_engagement, v.scope_content, v.scope_monetization,
             v.catalog_filter
      FROM vendor_members m
      JOIN vendors v ON v.id = m.vendor_id
      WHERE m.user_id = ${userId}
      LIMIT 1
    `),
  );
  const row = rows[0];
  if (!row || row.status !== "active") return null;
  return {
    id: Number(row.id),
    name: String(row.name),
    status: String(row.status),
    scopeGrowth: Boolean(row.scope_growth),
    scopeEngagement: Boolean(row.scope_engagement),
    scopeContent: Boolean(row.scope_content),
    scopeMonetization: Boolean(row.scope_monetization),
    catalogFilter: (row.catalog_filter ?? null) as ResolvedVendor["catalogFilter"],
  };
}
```

- [ ] **Step 4: Run to verify pass**

Run: `pnpm test:server server/vendor/vendorResolve.test.ts` → 3 passed.

- [ ] **Step 5: Add vendorProcedure to server/_core/trpc.ts**

Append after `adminProcedure` (imports at top: `import { getDb } from "../db"; import { resolveVendorForUser } from "../vendor/vendorResolve";`):

```typescript
export const vendorProcedure = t.procedure.use(
  t.middleware(async opts => {
    const { ctx, next } = opts;

    if (!ctx.user) {
      throw new TRPCError({ code: "UNAUTHORIZED", message: UNAUTHED_ERR_MSG });
    }
    const db = await getDb();
    if (!db) {
      throw new TRPCError({ code: "INTERNAL_SERVER_ERROR" });
    }
    const vendor = await resolveVendorForUser(db, ctx.user.id);
    if (!vendor) {
      throw new TRPCError({ code: "FORBIDDEN", message: "Vendor access required" });
    }

    return next({
      ctx: {
        ...ctx,
        user: ctx.user,
        vendor,
        db,
      },
    });
  }),
);
```

- [ ] **Step 6: Typecheck + commit**

Run: `pnpm check` → clean.

```bash
git add server/vendor/vendorResolve.ts server/vendor/vendorResolve.test.ts server/_core/trpc.ts
git commit -m "feat(vendor): vendorProcedure resolving active vendor membership"
```

---

### Task 2: tRPC `vendorRouter` (TDD on gates, reuse Phase 2 handlers for CSV)

**Files:**
- Modify: `server/vendor/vendorApi.ts` (export `SCOPE_MAP` and `isValidCalendarDate` — add `export` keywords only, no logic changes)
- Create: `server/routers/vendor.ts`
- Test: `server/routers/vendor.test.ts`
- Modify: `server/app-router.ts` (register `vendor: vendorRouter`)

**Interfaces:**
- Consumes: `vendorProcedure` (+ ctx.vendor: ResolvedVendor, ctx.db), `kpiQueries` (getDateRange/getGrowth/getEngagement/getContent/getMonetization with the exact signatures at `server/vendor/kpiQueries.ts:250-549`), `KPI_DEFINITIONS`/`definitionNotes()` from kpiDefinitions, `handleMetrics` + `SCOPE_MAP` + `isValidCalendarDate` from vendorApi, `VendorAuth` type.
- Produces router `vendorRouter` with procedures (all `vendorProcedure`):
  - `me()` → `{ vendorName: string; scopes: ("growth"|"engagement"|"content"|"monetization")[]; dateRange: { min: string | null; max: string | null }; definitions: { metrics: Record<string,string>; notes: string[] } }`
  - `growth(RangeInput)` → `GrowthRow[]`; `engagement(RangeInput)` → `{ series, retention }`; `monetization(RangeInput)` → `MonetizationRow[]`
  - `content(RangeInput & { dimension?: "song"|"genre"|"decade" (default song); limit?: number 1-200 (default 50) })` → `ContentRow[]`
  - `exportCsv(mutation: RangeInput & { family: FamilyEnum; dimension?; limit? })` → `{ csv: string; filename: string }`
  - `apiAccess()` → `{ vendorName: string; scopes: string[]; baseUrl: "/api/vendor/v1"; keys: { id: number; label: string; keyPrefix: string; last4: string; createdAt: string; lastUsedAt: string | null; revokedAt: string | null }[] }`
  - Exported pure helper `requireScope(vendor: ResolvedVendor, family: string): boolean` (uses SCOPE_MAP; unknown family → false)
  - `RangeInput` zod: `{ from, to: YYYY-MM-DD + isValidCalendarDate; granularity: z.enum(["day","week","month"]).default("day") }` with refines `from <= to` and span ≤ 400 days (`Date.UTC` diff). Scope failures throw `TRPCError FORBIDDEN "Scope not granted: <family>"`.

- [ ] **Step 1: Export SCOPE_MAP + isValidCalendarDate from vendorApi.ts** (add `export` to the two existing declarations; `pnpm test:server server/vendor/vendorApi.test.ts` still 14 passed).

- [ ] **Step 2: Write the failing test**

```typescript
// server/routers/vendor.test.ts
import { describe, expect, it } from "vitest";
import { requireScope, rangeInput } from "./vendor";

const VENDOR = {
  id: 3, name: "Acme", status: "active",
  scopeGrowth: true, scopeEngagement: false, scopeContent: true, scopeMonetization: false,
  catalogFilter: null,
};

describe("requireScope", () => {
  it("grants in-scope families", () => {
    expect(requireScope(VENDOR, "growth")).toBe(true);
    expect(requireScope(VENDOR, "content")).toBe(true);
  });
  it("denies out-of-scope and unknown families", () => {
    expect(requireScope(VENDOR, "engagement")).toBe(false);
    expect(requireScope(VENDOR, "monetization")).toBe(false);
    expect(requireScope(VENDOR, "finance")).toBe(false);
  });
});

describe("rangeInput", () => {
  it("accepts a valid range and defaults granularity to day", () => {
    const r = rangeInput.parse({ from: "2026-06-01", to: "2026-07-01" });
    expect(r.granularity).toBe("day");
  });
  it("rejects calendar-invalid, reversed, and oversized ranges", () => {
    expect(() => rangeInput.parse({ from: "2026-13-45", to: "2026-07-01" })).toThrow();
    expect(() => rangeInput.parse({ from: "2026-07-02", to: "2026-07-01" })).toThrow();
    expect(() => rangeInput.parse({ from: "2020-01-01", to: "2026-01-01" })).toThrow();
  });
});
```

- [ ] **Step 3: Run to verify failure** → module not found.

- [ ] **Step 4: Implement server/routers/vendor.ts**

```typescript
// server/routers/vendor.ts
// Vendor-facing tRPC router for the /vendor dashboard. Reads the SAME
// kpiQueries layer as the REST API (and exportCsv literally reuses the REST
// handler) so dashboard and API numbers cannot drift.
import { TRPCError } from "@trpc/server";
import { z } from "zod";
import { sql } from "drizzle-orm";
import { router, vendorProcedure } from "../_core/trpc";
import { getContent, getDateRange, getEngagement, getGrowth, getMonetization } from "../vendor/kpiQueries";
import { KPI_DEFINITIONS, definitionNotes } from "../vendor/kpiDefinitions";
import { handleMetrics, isValidCalendarDate, SCOPE_MAP } from "../vendor/vendorApi";
import type { ResolvedVendor } from "../vendor/vendorResolve";

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const dateStr = z.string().regex(DATE_RE).refine(isValidCalendarDate, "invalid calendar date");

function spanDays(from: string, to: string): number {
  const [fy, fm, fd] = from.split("-").map(Number);
  const [ty, tm, td] = to.split("-").map(Number);
  return (Date.UTC(ty!, tm! - 1, td!) - Date.UTC(fy!, fm! - 1, fd!)) / 86_400_000;
}

export const rangeInput = z
  .object({
    from: dateStr,
    to: dateStr,
    granularity: z.enum(["day", "week", "month"]).default("day"),
  })
  .refine((r) => r.from <= r.to, "from must be <= to")
  .refine((r) => spanDays(r.from, r.to) <= 400, "range exceeds 400 days");

const familyEnum = z.enum(["growth", "engagement", "content", "monetization"]);

export function requireScope(vendor: ResolvedVendor, family: string): boolean {
  const key = SCOPE_MAP[family as keyof typeof SCOPE_MAP];
  return key ? Boolean(vendor[key]) : false;
}

function assertScope(vendor: ResolvedVendor, family: string): void {
  if (!requireScope(vendor, family)) {
    throw new TRPCError({ code: "FORBIDDEN", message: `Scope not granted: ${family}` });
  }
}

function grantedScopes(v: ResolvedVendor): ("growth" | "engagement" | "content" | "monetization")[] {
  const out: ("growth" | "engagement" | "content" | "monetization")[] = [];
  if (v.scopeGrowth) out.push("growth");
  if (v.scopeEngagement) out.push("engagement");
  if (v.scopeContent) out.push("content");
  if (v.scopeMonetization) out.push("monetization");
  return out;
}

const contentExtras = {
  dimension: z.enum(["song", "genre", "decade"]).default("song"),
  limit: z.number().int().min(1).max(200).default(50),
};

export const vendorRouter = router({
  me: vendorProcedure.query(async ({ ctx }) => ({
    vendorName: ctx.vendor.name,
    scopes: grantedScopes(ctx.vendor),
    dateRange: await getDateRange(ctx.db),
    definitions: { metrics: KPI_DEFINITIONS, notes: definitionNotes() },
  })),

  growth: vendorProcedure.input(rangeInput).query(async ({ ctx, input }) => {
    assertScope(ctx.vendor, "growth");
    return getGrowth(ctx.db, input);
  }),

  engagement: vendorProcedure.input(rangeInput).query(async ({ ctx, input }) => {
    assertScope(ctx.vendor, "engagement");
    return getEngagement(ctx.db, input);
  }),

  content: vendorProcedure
    .input(z.object({ ...rangeInput.sourceType().shape, ...contentExtras }).refine((r) => r.from <= r.to).refine((r) => spanDays(r.from, r.to) <= 400))
    .query(async ({ ctx, input }) => {
      assertScope(ctx.vendor, "content");
      return getContent(ctx.db, { ...input, catalogFilter: ctx.vendor.catalogFilter });
    }),

  monetization: vendorProcedure.input(rangeInput).query(async ({ ctx, input }) => {
    assertScope(ctx.vendor, "monetization");
    return getMonetization(ctx.db, input);
  }),

  exportCsv: vendorProcedure
    .input(
      z.object({
        family: familyEnum,
        from: dateStr,
        to: dateStr,
        granularity: z.enum(["day", "week", "month"]).default("day"),
        dimension: z.enum(["song", "genre", "decade"]).optional(),
        limit: z.number().int().min(1).max(200).optional(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      // Reuse the REST handler wholesale — identical validation, scope
      // enforcement, envelope math, and CSV shape as the public API.
      const auth = { keyId: 0, vendor: ctx.vendor };
      const { family, ...query } = input;
      const r = await handleMetrics(ctx.db, auth, family, { ...query, format: "csv" });
      if (r.status !== 200 || !r.csv) {
        const code = r.status === 403 ? "FORBIDDEN" : "BAD_REQUEST";
        throw new TRPCError({ code, message: `Export failed (${(r.body as { error?: string }).error ?? r.status})` });
      }
      return { csv: r.csv.content, filename: r.csv.filename };
    }),

  apiAccess: vendorProcedure.query(async ({ ctx }) => {
    const rows = (await ctx.db.execute(sql`
      SELECT id, label, key_prefix, last4, created_at, last_used_at, revoked_at
      FROM vendor_api_keys
      WHERE vendor_id = ${ctx.vendor.id}
      ORDER BY created_at DESC
    `)) as unknown as Record<string, unknown>[];
    const list = Array.isArray(rows) ? rows : Array.from(rows as Iterable<Record<string, unknown>>);
    return {
      vendorName: ctx.vendor.name,
      scopes: grantedScopes(ctx.vendor),
      baseUrl: "/api/vendor/v1" as const,
      keys: list.map((k) => ({
        id: Number(k.id),
        label: String(k.label),
        keyPrefix: String(k.key_prefix),
        last4: String(k.last4),
        createdAt: String(k.created_at),
        lastUsedAt: k.last_used_at ? String(k.last_used_at) : null,
        revokedAt: k.revoked_at ? String(k.revoked_at) : null,
      })),
    };
  }),
});
```

NOTE on the `content` input: zod v4 — if `rangeInput.sourceType()` is not available for a refined schema, build the content input as its own `z.object({ from: dateStr, to: dateStr, granularity: ..., ...contentExtras })` with the same two refines (duplicate the three base fields explicitly). Whichever compiles cleanly under `pnpm check`; the validation behavior is the contract, not the construction style.

- [ ] **Step 5: Register in app-router.ts**

```typescript
import { vendorRouter } from "./routers/vendor";
// inside appRouter:
  vendor: vendorRouter,
```

- [ ] **Step 6: Run tests + typecheck + full suite, commit**

Run: `pnpm test:server server/routers/vendor.test.ts` → 4 passed. `pnpm check` → clean. `pnpm test:server` → all green.

```bash
git add server/routers/vendor.ts server/routers/vendor.test.ts server/vendor/vendorApi.ts server/app-router.ts
git commit -m "feat(vendor): tRPC vendorRouter over shared kpiQueries + CSV reuse"
```

---

### Task 3: Client shell — route, gating, controls, shared components

**Files:**
- Create: `client/src/pages/vendor/VendorDashboard.tsx`, `client/src/pages/vendor/lib.tsx`
- Modify: `client/src/App.tsx` (route), `client/src/components/PersistentHeader.tsx` (role-conditional menu link)

**Interfaces:**
- Consumes: `trpc.vendor.me`, `useAuth` (`client/src/_core/hooks/useAuth.ts`), shadcn Tabs/Select/Card/Button/Input, wouter.
- Produces (in `lib.tsx`, consumed by Tasks 4-6):
  - `type Cell = { value: number | null; suppressed: boolean }`
  - `cellText(c: Cell, digits?: number): string` — `•••` when suppressed, `—` when null, else localized number
  - `chartVal(c: Cell): number | null` — null when suppressed/null (charts gap)
  - `ChartCard({ title, note, children }): JSX` — Card + h3 + children + `<p className="text-xs text-muted-foreground mt-3">{note}</p>`
  - `StatCard({ label, cell, digits? })` — compact stat tile using cellText
  - `downloadCsv(text: string, filename: string): void` — blob/anchor pattern (AdminDashboard.tsx:27-37)
  - `ExportButton({ family, range, dimension?, limit? })` — wraps `trpc.vendor.exportCsv.useMutation`, lucide `Download` icon, disabled while pending, `onSuccess` → downloadCsv, `onError` → `toast.error(e.message)`
  - `type VendorRange = { from: string; to: string; granularity: "day" | "week" | "month" }`
  - `VendorDashboard` renders: gate → header (vendor name from `me`) → controls row → `<Tabs>` where each in-scope family tab mounts its component (Tasks 4-5) with props `{ range: VendorRange, notes: Record<string,string> }`, plus API Access tab (Task 6). Until Tasks 4-6 land it renders `<p>Coming soon</p>` placeholders per tab — replaced in later tasks.

- [ ] **Step 1: Implement lib.tsx** (complete code)

```tsx
// client/src/pages/vendor/lib.tsx
// Shared primitives for the vendor dashboard tabs.
import type { ReactNode } from "react";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Download } from "lucide-react";
import { toast } from "sonner";
import { trpc } from "@/lib/trpc";

export type Cell = { value: number | null; suppressed: boolean };
export type VendorRange = { from: string; to: string; granularity: "day" | "week" | "month" };

export function cellText(c: Cell | undefined, digits = 0): string {
  if (!c) return "—";
  if (c.suppressed) return "•••";
  if (c.value === null) return "—";
  return c.value.toLocaleString(undefined, { maximumFractionDigits: digits });
}

export function chartVal(c: Cell | undefined): number | null {
  if (!c || c.suppressed || c.value === null) return null;
  return c.value;
}

export function downloadCsv(text: string, filename: string): void {
  const blob = new Blob([text], { type: "text/csv" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

export function ChartCard({ title, note, children }: { title: string; note?: string; children: ReactNode }) {
  return (
    <Card className="p-6">
      <h3 className="font-semibold mb-4">{title}</h3>
      {children}
      {note ? <p className="text-xs text-muted-foreground mt-3">{note}</p> : null}
    </Card>
  );
}

export function StatCard({ label, cell, digits = 0 }: { label: string; cell: Cell | undefined; digits?: number }) {
  return (
    <Card className="p-4">
      <p className="text-xs text-muted-foreground">{label}</p>
      <p className="text-2xl font-semibold">{cellText(cell, digits)}</p>
    </Card>
  );
}

export function ExportButton({
  family,
  range,
  dimension,
  limit,
}: {
  family: "growth" | "engagement" | "content" | "monetization";
  range: VendorRange;
  dimension?: "song" | "genre" | "decade";
  limit?: number;
}) {
  const exportMut = trpc.vendor.exportCsv.useMutation({
    onSuccess: (r) => downloadCsv(r.csv, r.filename),
    onError: (e) => toast.error(e.message),
  });
  return (
    <Button
      variant="outline"
      size="sm"
      disabled={exportMut.isPending}
      onClick={() => exportMut.mutate({ family, ...range, dimension, limit })}
    >
      <Download className="h-4 w-4 mr-2" />
      Export CSV
    </Button>
  );
}
```

- [ ] **Step 2: Implement VendorDashboard.tsx** (complete code; tab bodies are placeholders replaced by Tasks 4-6)

```tsx
// client/src/pages/vendor/VendorDashboard.tsx
import { useState } from "react";
import { useAuth } from "@/_core/hooks/useAuth";
import { trpc } from "@/lib/trpc";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Input } from "@/components/ui/input";
import type { VendorRange } from "./lib";

const FAMILY_LABELS: Record<string, string> = {
  growth: "Growth",
  engagement: "Engagement",
  content: "Content",
  monetization: "Monetization",
};

function isoDaysAgo(days: number): string {
  const d = new Date();
  d.setUTCDate(d.getUTCDate() - days);
  return d.toISOString().slice(0, 10);
}

export default function VendorDashboard() {
  const { user, loading } = useAuth();
  const [preset, setPreset] = useState<"7" | "30" | "90" | "custom">("30");
  const [customFrom, setCustomFrom] = useState(isoDaysAgo(30));
  const [customTo, setCustomTo] = useState(isoDaysAgo(1));
  const [granularity, setGranularity] = useState<VendorRange["granularity"]>("day");

  const enabled = user?.role === "vendor";
  const me = trpc.vendor.me.useQuery(undefined, { enabled });

  if (loading) return <div className="p-8 text-center text-muted-foreground">Loading…</div>;
  if (user?.role !== "vendor") {
    return (
      <div className="p-8 text-center">
        <p className="text-red-600 font-semibold">Access Denied: Vendor only</p>
      </div>
    );
  }

  const range: VendorRange =
    preset === "custom"
      ? { from: customFrom, to: customTo, granularity }
      : { from: isoDaysAgo(Number(preset)), to: isoDaysAgo(1), granularity };

  const scopes = me.data?.scopes ?? [];
  const notes = me.data?.definitions.metrics ?? {};

  return (
    <div className="max-w-6xl mx-auto p-6 space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold">{me.data?.vendorName ?? "Vendor"} — KPI Dashboard</h1>
          <p className="text-sm text-muted-foreground">
            Data {me.data?.dateRange.min ?? "…"} to {me.data?.dateRange.max ?? "…"} (nightly rollup)
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Select value={preset} onValueChange={(v) => setPreset(v as typeof preset)}>
            <SelectTrigger className="w-32"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="7">Last 7 days</SelectItem>
              <SelectItem value="30">Last 30 days</SelectItem>
              <SelectItem value="90">Last 90 days</SelectItem>
              <SelectItem value="custom">Custom</SelectItem>
            </SelectContent>
          </Select>
          {preset === "custom" ? (
            <>
              <Input type="date" className="w-40" value={customFrom} onChange={(e) => setCustomFrom(e.target.value)} />
              <Input type="date" className="w-40" value={customTo} onChange={(e) => setCustomTo(e.target.value)} />
            </>
          ) : null}
          <Select value={granularity} onValueChange={(v) => setGranularity(v as VendorRange["granularity"])}>
            <SelectTrigger className="w-28"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="day">Daily</SelectItem>
              <SelectItem value="week">Weekly</SelectItem>
              <SelectItem value="month">Monthly</SelectItem>
            </SelectContent>
          </Select>
        </div>
      </div>

      {me.isLoading ? (
        <p className="text-muted-foreground text-center py-12">Loading…</p>
      ) : (
        <Tabs defaultValue={scopes[0] ?? "api"} className="w-full">
          <TabsList>
            {scopes.map((s) => (
              <TabsTrigger key={s} value={s}>{FAMILY_LABELS[s]}</TabsTrigger>
            ))}
            <TabsTrigger value="api">API Access</TabsTrigger>
          </TabsList>
          {scopes.includes("growth") && (
            <TabsContent value="growth"><p className="text-muted-foreground p-6">Coming soon</p></TabsContent>
          )}
          {scopes.includes("engagement") && (
            <TabsContent value="engagement"><p className="text-muted-foreground p-6">Coming soon</p></TabsContent>
          )}
          {scopes.includes("content") && (
            <TabsContent value="content"><p className="text-muted-foreground p-6">Coming soon</p></TabsContent>
          )}
          {scopes.includes("monetization") && (
            <TabsContent value="monetization"><p className="text-muted-foreground p-6">Coming soon</p></TabsContent>
          )}
          <TabsContent value="api"><p className="text-muted-foreground p-6">Coming soon</p></TabsContent>
        </Tabs>
      )}
      <p className="text-xs text-muted-foreground">
        {(me.data?.definitions.notes ?? []).map((n) => (<span key={n} className="block">{n}</span>))}
      </p>
    </div>
  );
}
```

- [ ] **Step 3: Route + nav link**

In `client/src/App.tsx`: `import VendorDashboard from "@/pages/vendor/VendorDashboard";` and add `<Route path="/vendor" component={VendorDashboard} />` next to the `/admin` route (~line 72). In `client/src/components/PersistentHeader.tsx` user dropdown (~lines 110-134), add a role-conditional item (match the existing DropdownMenuItem style; lucide `BarChart3` icon):

```tsx
{user?.role === "vendor" && (
  <DropdownMenuItem onClick={() => navigate("/vendor")}>
    <BarChart3 className="h-4 w-4 mr-2" />
    Vendor Dashboard
  </DropdownMenuItem>
)}
```

(adapt to the file's actual navigation mechanism — wouter `useLocation` setter or `<Link>` — matching sibling items.)

- [ ] **Step 4: Verify + commit**

Run: `pnpm check` → clean. `pnpm exec vite build` → clean.

```bash
git add client/src/pages/vendor/ client/src/App.tsx client/src/components/PersistentHeader.tsx
git commit -m "feat(vendor-ui): /vendor shell — gate, range/granularity controls, scoped tabs"
```

---

### Task 4: Growth + Engagement tabs

**Files:**
- Create: `client/src/pages/vendor/tabs/GrowthTab.tsx`, `client/src/pages/vendor/tabs/EngagementTab.tsx`
- Modify: `client/src/pages/vendor/VendorDashboard.tsx` (replace the two placeholders with `<GrowthTab range={range} notes={notes} />` / `<EngagementTab range={range} notes={notes} />` + imports)

**Interfaces:**
- Consumes: `trpc.vendor.growth` / `trpc.vendor.engagement` (`useQuery(range, { enabled })`), lib.tsx primitives, recharts (import set from `AdminDashboard.tsx:6`), colors `#ef4444 #3b82f6 #a855f7 #f59e0b`.
- Props contract (both tabs, and Task 5's): `{ range: VendorRange; notes: Record<string, string> }`.

- [ ] **Step 1: Implement GrowthTab.tsx**

```tsx
// client/src/pages/vendor/tabs/GrowthTab.tsx
import { CartesianGrid, Legend, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { trpc } from "@/lib/trpc";
import { ChartCard, ExportButton, StatCard, chartVal, type VendorRange } from "../lib";

export default function GrowthTab({ range, notes }: { range: VendorRange; notes: Record<string, string> }) {
  const q = trpc.vendor.growth.useQuery(range);
  const rows = q.data ?? [];
  const latest = rows[rows.length - 1];
  const series = rows.map((r) => ({
    bucket: r.bucket,
    dau: chartVal(r.dau),
    wau: chartVal(r.wau),
    mau: chartVal(r.mau),
    newUsers: chartVal(r.newUsers),
  }));

  if (q.isLoading) return <p className="text-muted-foreground p-6">Loading…</p>;
  if (q.error) return <p className="text-red-600 p-6">{q.error.message}</p>;

  return (
    <div className="space-y-4 pt-4">
      <div className="flex justify-end"><ExportButton family="growth" range={range} /></div>
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <StatCard label="DAU (latest)" cell={latest?.dau} />
        <StatCard label="MAU (latest)" cell={latest?.mau} />
        <StatCard label="Stickiness" cell={latest?.stickiness} digits={3} />
        <StatCard label="New users (latest)" cell={latest?.newUsers} />
      </div>
      <ChartCard title="Active users" note={notes.dau}>
        {series.length === 0 ? (
          <p className="text-sm text-muted-foreground py-8 text-center">No data in range.</p>
        ) : (
          <ResponsiveContainer width="100%" height={280}>
            <LineChart data={series}>
              <CartesianGrid strokeDasharray="3 3" />
              <XAxis dataKey="bucket" interval="preserveStartEnd" tick={{ fontSize: 11 }} />
              <YAxis />
              <Tooltip />
              <Legend />
              <Line type="monotone" dataKey="dau" stroke="#3b82f6" name="DAU" dot={false} connectNulls={false} />
              <Line type="monotone" dataKey="wau" stroke="#a855f7" name="WAU" dot={false} connectNulls={false} />
              <Line type="monotone" dataKey="mau" stroke="#f59e0b" name="MAU" dot={false} connectNulls={false} />
            </LineChart>
          </ResponsiveContainer>
        )}
      </ChartCard>
      <ChartCard title="New users & guest conversions" note={notes.guest_conversions}>
        {series.length === 0 ? (
          <p className="text-sm text-muted-foreground py-8 text-center">No data in range.</p>
        ) : (
          <ResponsiveContainer width="100%" height={220}>
            <LineChart data={rows.map((r) => ({ bucket: r.bucket, newUsers: chartVal(r.newUsers), newGuests: chartVal(r.newGuests), conversions: chartVal(r.guestConversions) }))}>
              <CartesianGrid strokeDasharray="3 3" />
              <XAxis dataKey="bucket" interval="preserveStartEnd" tick={{ fontSize: 11 }} />
              <YAxis />
              <Tooltip />
              <Legend />
              <Line type="monotone" dataKey="newUsers" stroke="#3b82f6" name="New users" dot={false} connectNulls={false} />
              <Line type="monotone" dataKey="newGuests" stroke="#ef4444" name="New guests" dot={false} connectNulls={false} />
              <Line type="monotone" dataKey="conversions" stroke="#a855f7" name="Guest conversions" dot={false} connectNulls={false} />
            </LineChart>
          </ResponsiveContainer>
        )}
      </ChartCard>
    </div>
  );
}
```

- [ ] **Step 2: Implement EngagementTab.tsx**

```tsx
// client/src/pages/vendor/tabs/EngagementTab.tsx
import { CartesianGrid, Legend, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { trpc } from "@/lib/trpc";
import { ChartCard, ExportButton, StatCard, cellText, chartVal, type VendorRange } from "../lib";

export default function EngagementTab({ range, notes }: { range: VendorRange; notes: Record<string, string> }) {
  const q = trpc.vendor.engagement.useQuery(range);
  const series = q.data?.series ?? [];
  const retention = q.data?.retention ?? [];
  const latest = series[series.length - 1];

  if (q.isLoading) return <p className="text-muted-foreground p-6">Loading…</p>;
  if (q.error) return <p className="text-red-600 p-6">{q.error.message}</p>;

  const chartData = series.map((r) => ({
    bucket: r.bucket,
    sessions: chartVal(r.sessions),
    rounds: chartVal(r.rounds),
    avgSeconds: chartVal(r.avgSessionSeconds),
  }));

  return (
    <div className="space-y-4 pt-4">
      <div className="flex justify-end"><ExportButton family="engagement" range={range} /></div>
      <div className="grid grid-cols-2 md:grid-cols-3 gap-4">
        <StatCard label="Sessions (latest)" cell={latest?.sessions} />
        <StatCard label="Rounds / session" cell={latest?.roundsPerSession} digits={2} />
        <StatCard label="Avg session (sec)" cell={latest?.avgSessionSeconds} digits={1} />
      </div>
      <ChartCard title="Sessions & rounds" note={notes.sessions}>
        {chartData.length === 0 ? (
          <p className="text-sm text-muted-foreground py-8 text-center">No data in range.</p>
        ) : (
          <ResponsiveContainer width="100%" height={280}>
            <LineChart data={chartData}>
              <CartesianGrid strokeDasharray="3 3" />
              <XAxis dataKey="bucket" interval="preserveStartEnd" tick={{ fontSize: 11 }} />
              <YAxis />
              <Tooltip />
              <Legend />
              <Line type="monotone" dataKey="sessions" stroke="#3b82f6" name="Sessions" dot={false} connectNulls={false} />
              <Line type="monotone" dataKey="rounds" stroke="#f59e0b" name="Rounds" dot={false} connectNulls={false} />
            </LineChart>
          </ResponsiveContainer>
        )}
      </ChartCard>
      <ChartCard title="Retention cohorts (D1 / D7 / D30)" note={notes.retention}>
        {retention.length === 0 ? (
          <p className="text-sm text-muted-foreground py-8 text-center">No cohorts in range.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b text-left text-muted-foreground">
                  <th className="py-2 pr-4">Cohort</th>
                  <th className="py-2 pr-4">Offset</th>
                  <th className="py-2 pr-4">Cohort size</th>
                  <th className="py-2">Retained rate</th>
                </tr>
              </thead>
              <tbody>
                {retention.map((r) => (
                  <tr key={`${r.cohortDate}-${r.dayOffset}`} className="border-b last:border-0">
                    <td className="py-2 pr-4">{r.cohortDate}</td>
                    <td className="py-2 pr-4">D{r.dayOffset}</td>
                    <td className="py-2 pr-4">{cellText(r.cohortSize)}</td>
                    <td className="py-2">{cellText(r.retainedRate, 2)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </ChartCard>
    </div>
  );
}
```

- [ ] **Step 3: Wire into VendorDashboard.tsx** — replace the growth/engagement placeholders:

```tsx
import GrowthTab from "./tabs/GrowthTab";
import EngagementTab from "./tabs/EngagementTab";
// …
<TabsContent value="growth"><GrowthTab range={range} notes={notes} /></TabsContent>
<TabsContent value="engagement"><EngagementTab range={range} notes={notes} /></TabsContent>
```

- [ ] **Step 4: Verify + commit**

Run: `pnpm check` → clean. `pnpm exec vite build` → clean.

```bash
git add client/src/pages/vendor/
git commit -m "feat(vendor-ui): growth + engagement tabs with charts, retention, CSV"
```

---

### Task 5: Content + Monetization tabs

**Files:**
- Create: `client/src/pages/vendor/tabs/ContentTab.tsx`, `client/src/pages/vendor/tabs/MonetizationTab.tsx`
- Modify: `client/src/pages/vendor/VendorDashboard.tsx` (replace the two placeholders, same wiring pattern as Task 4 Step 3)

**Interfaces:** same props contract `{ range, notes }`; consumes `trpc.vendor.content` (with `dimension`/`limit` state local to ContentTab) and `trpc.vendor.monetization`.

- [ ] **Step 1: Implement ContentTab.tsx**

```tsx
// client/src/pages/vendor/tabs/ContentTab.tsx
import { useState } from "react";
import { Bar, BarChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { trpc } from "@/lib/trpc";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { ChartCard, ExportButton, cellText, chartVal, type VendorRange } from "../lib";

export default function ContentTab({ range, notes }: { range: VendorRange; notes: Record<string, string> }) {
  const [dimension, setDimension] = useState<"song" | "genre" | "decade">("song");
  const q = trpc.vendor.content.useQuery({ ...range, dimension, limit: 50 });
  const rows = q.data ?? [];
  const top = rows.slice(0, 15).map((r) => ({ key: r.key, displays: chartVal(r.displays) }));

  if (q.isLoading) return <p className="text-muted-foreground p-6">Loading…</p>;
  if (q.error) return <p className="text-red-600 p-6">{q.error.message}</p>;

  return (
    <div className="space-y-4 pt-4">
      <div className="flex items-center justify-between">
        <Select value={dimension} onValueChange={(v) => setDimension(v as typeof dimension)}>
          <SelectTrigger className="w-36"><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="song">By song</SelectItem>
            <SelectItem value="genre">By genre</SelectItem>
            <SelectItem value="decade">By decade</SelectItem>
          </SelectContent>
        </Select>
        <ExportButton family="content" range={range} dimension={dimension} limit={50} />
      </div>
      <ChartCard title={`Top ${dimension}s by displays`} note={notes.displays}>
        {top.length === 0 ? (
          <p className="text-sm text-muted-foreground py-8 text-center">No data in range{dimension !== "song" ? " (genre/decade views are unavailable when a catalog filter is set)" : ""}.</p>
        ) : (
          <ResponsiveContainer width="100%" height={300}>
            <BarChart data={top} layout="vertical" margin={{ left: 120 }}>
              <CartesianGrid strokeDasharray="3 3" />
              <XAxis type="number" />
              <YAxis type="category" dataKey="key" width={120} tick={{ fontSize: 11 }} />
              <Tooltip />
              <Bar dataKey="displays" fill="#3b82f6" name="Displays" />
            </BarChart>
          </ResponsiveContainer>
        )}
      </ChartCard>
      <ChartCard title="Detail" note={notes.correct_rate}>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b text-left text-muted-foreground">
                <th className="py-2 pr-4">{dimension === "song" ? "Song — Artist" : dimension === "genre" ? "Genre" : "Decade"}</th>
                <th className="py-2 pr-4">Displays</th>
                <th className="py-2 pr-4">Rounds</th>
                <th className="py-2 pr-4">Correct rate</th>
                <th className="py-2">Avg response (s)</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.key} className="border-b last:border-0">
                  <td className="py-2 pr-4">{r.key}</td>
                  <td className="py-2 pr-4">{cellText(r.displays)}</td>
                  <td className="py-2 pr-4">{cellText(r.roundsPlayed)}</td>
                  <td className="py-2 pr-4">{cellText(r.correctRate, 2)}</td>
                  <td className="py-2">{cellText(r.avgResponseSeconds, 1)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </ChartCard>
    </div>
  );
}
```

- [ ] **Step 2: Implement MonetizationTab.tsx**

```tsx
// client/src/pages/vendor/tabs/MonetizationTab.tsx
import { Bar, BarChart, CartesianGrid, Legend, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { trpc } from "@/lib/trpc";
import { ChartCard, ExportButton, StatCard, cellText, chartVal, type VendorRange } from "../lib";

export default function MonetizationTab({ range, notes }: { range: VendorRange; notes: Record<string, string> }) {
  const q = trpc.vendor.monetization.useQuery(range);
  const rows = q.data ?? [];
  const latest = rows[rows.length - 1];

  if (q.isLoading) return <p className="text-muted-foreground p-6">Loading…</p>;
  if (q.error) return <p className="text-red-600 p-6">{q.error.message}</p>;

  const revenueSeries = rows.map((r) => ({
    bucket: r.bucket,
    addon: chartVal(r.addonRevenueUsd),
    entryFees: chartVal(r.entryFeeRevenueUsd),
    prizes: chartVal(r.prizesPaidUsd),
  }));
  const arpdauSeries = rows.map((r) => ({ bucket: r.bucket, arpdau: chartVal(r.arpdau), gnPurchased: chartVal(r.gnPurchased) }));
  const tierEntries = Object.entries(latest?.subscriptionsByTier ?? {});
  const kindEntries = Object.entries(latest?.gnSpentByKind ?? {});

  return (
    <div className="space-y-4 pt-4">
      <div className="flex justify-end"><ExportButton family="monetization" range={range} /></div>
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <StatCard label="ARPDAU (latest)" cell={latest?.arpdau} digits={4} />
        <StatCard label="Add-on revenue $ (latest)" cell={latest?.addonRevenueUsd} digits={2} />
        <StatCard label="Entry fees $ (latest)" cell={latest?.entryFeeRevenueUsd} digits={2} />
        <StatCard label="GN purchased (latest)" cell={latest?.gnPurchased} />
      </div>
      <ChartCard title="Revenue (USD, gross)" note={notes.addon_revenue_usd}>
        {revenueSeries.length === 0 ? (
          <p className="text-sm text-muted-foreground py-8 text-center">No data in range.</p>
        ) : (
          <ResponsiveContainer width="100%" height={260}>
            <BarChart data={revenueSeries}>
              <CartesianGrid strokeDasharray="3 3" />
              <XAxis dataKey="bucket" interval="preserveStartEnd" tick={{ fontSize: 11 }} />
              <YAxis />
              <Tooltip />
              <Legend />
              <Bar dataKey="addon" stackId="rev" fill="#3b82f6" name="Add-on purchases" />
              <Bar dataKey="entryFees" stackId="rev" fill="#a855f7" name="Entry fees" />
              <Bar dataKey="prizes" fill="#ef4444" name="Prizes paid" />
            </BarChart>
          </ResponsiveContainer>
        )}
      </ChartCard>
      <ChartCard title="ARPDAU & Golden Notes purchased" note={notes.arpdau}>
        {arpdauSeries.length === 0 ? (
          <p className="text-sm text-muted-foreground py-8 text-center">No data in range.</p>
        ) : (
          <ResponsiveContainer width="100%" height={220}>
            <LineChart data={arpdauSeries}>
              <CartesianGrid strokeDasharray="3 3" />
              <XAxis dataKey="bucket" interval="preserveStartEnd" tick={{ fontSize: 11 }} />
              <YAxis yAxisId="l" />
              <YAxis yAxisId="r" orientation="right" />
              <Tooltip />
              <Legend />
              <Line yAxisId="l" type="monotone" dataKey="arpdau" stroke="#f59e0b" name="ARPDAU ($)" dot={false} connectNulls={false} />
              <Line yAxisId="r" type="monotone" dataKey="gnPurchased" stroke="#3b82f6" name="GN purchased" dot={false} connectNulls={false} />
            </LineChart>
          </ResponsiveContainer>
        )}
      </ChartCard>
      <div className="grid md:grid-cols-2 gap-4">
        <ChartCard title="Active subscriptions by tier (latest)" note={notes.active_subscriptions}>
          {tierEntries.length === 0 ? (
            <p className="text-sm text-muted-foreground py-4 text-center">None in range.</p>
          ) : (
            <ul className="text-sm space-y-1">
              {tierEntries.map(([tier, cell]) => (
                <li key={tier} className="flex justify-between border-b last:border-0 py-1">
                  <span className="capitalize">{tier}</span><span>{cellText(cell)}</span>
                </li>
              ))}
            </ul>
          )}
        </ChartCard>
        <ChartCard title="GN spend by kind (latest)" note={notes.gn_spent}>
          {kindEntries.length === 0 ? (
            <p className="text-sm text-muted-foreground py-4 text-center">None in range.</p>
          ) : (
            <ul className="text-sm space-y-1">
              {kindEntries.map(([kind, cell]) => (
                <li key={kind} className="flex justify-between border-b last:border-0 py-1">
                  <span>{kind.replace(/_/g, " ")}</span><span>{cellText(cell)}</span>
                </li>
              ))}
            </ul>
          )}
        </ChartCard>
      </div>
    </div>
  );
}
```

- [ ] **Step 3: Wire both into VendorDashboard.tsx** (same pattern as Task 4 Step 3, values `content` / `monetization`).

- [ ] **Step 4: Verify + commit**

Run: `pnpm check` → clean. `pnpm exec vite build` → clean.

```bash
git add client/src/pages/vendor/
git commit -m "feat(vendor-ui): content + monetization tabs"
```

---

### Task 6: API Access tab + live verification + close-out

**Files:**
- Create: `client/src/pages/vendor/tabs/ApiAccessTab.tsx`
- Modify: `client/src/pages/vendor/VendorDashboard.tsx` (replace API placeholder), `todo.md`

- [ ] **Step 1: Implement ApiAccessTab.tsx**

```tsx
// client/src/pages/vendor/tabs/ApiAccessTab.tsx
import { trpc } from "@/lib/trpc";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { ChartCard } from "../lib";

export default function ApiAccessTab() {
  const q = trpc.vendor.apiAccess.useQuery();
  if (q.isLoading) return <p className="text-muted-foreground p-6">Loading…</p>;
  if (q.error) return <p className="text-red-600 p-6">{q.error.message}</p>;
  const d = q.data!;

  const curl = `curl -H "Authorization: Bearer lp_live_YOUR_KEY" \\\n  "${window.location.origin}${d.baseUrl}/metrics/${d.scopes[0] ?? "growth"}?from=2026-06-01&to=2026-07-01&granularity=day"`;

  return (
    <div className="space-y-4 pt-4">
      <ChartCard title="Your API keys" note="Keys are issued and revoked by the LyricPro team. The full key is shown only once at issuance — contact us if you need a new one.">
        {d.keys.length === 0 ? (
          <p className="text-sm text-muted-foreground py-4">No keys issued yet — contact the LyricPro team.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b text-left text-muted-foreground">
                  <th className="py-2 pr-4">Key</th>
                  <th className="py-2 pr-4">Label</th>
                  <th className="py-2 pr-4">Created</th>
                  <th className="py-2 pr-4">Last used</th>
                  <th className="py-2">Status</th>
                </tr>
              </thead>
              <tbody>
                {d.keys.map((k) => (
                  <tr key={k.id} className="border-b last:border-0">
                    <td className="py-2 pr-4 font-mono">{k.keyPrefix}…{k.last4}</td>
                    <td className="py-2 pr-4">{k.label}</td>
                    <td className="py-2 pr-4">{k.createdAt.slice(0, 10)}</td>
                    <td className="py-2 pr-4">{k.lastUsedAt ? k.lastUsedAt.slice(0, 10) : "never"}</td>
                    <td className="py-2">{k.revokedAt ? <Badge variant="destructive">Revoked</Badge> : <Badge>Active</Badge>}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </ChartCard>
      <ChartCard title="REST API" note="Rate limit: 120 requests/minute per key. Data is aggregate-only; cells below the privacy threshold return null with suppressed=true.">
        <div className="text-sm space-y-2">
          <p>Base URL: <code className="bg-muted px-1 rounded">{window.location.origin}{d.baseUrl}</code></p>
          <p>Your scopes: {d.scopes.map((s) => <Badge key={s} variant="outline" className="mr-1">{s}</Badge>)}</p>
          <ul className="list-disc pl-5 space-y-1">
            <li><code>GET /meta</code> — scopes, available date range, metric definitions</li>
            <li><code>GET /metrics/{"{family}"}?from&to&granularity=day|week|month</code> — family ∈ your scopes; <code>&format=csv</code> for CSV</li>
            <li><code>GET /metrics/content?dimension=song|genre|decade&limit=1..200</code></li>
            <li><code>POST /reports</code> — body <code>{"{ reports: [families], from, to, granularity }"}</code></li>
          </ul>
          <pre className="bg-muted p-3 rounded text-xs overflow-x-auto">{curl}</pre>
        </div>
      </ChartCard>
    </div>
  );
}
```

- [ ] **Step 2: Wire into VendorDashboard.tsx** (`<TabsContent value="api"><ApiAccessTab /></TabsContent>`).

- [ ] **Step 3: Live verification (dev server against shared DB)**

Start `pnpm dev` in background. Seed a temp vendor + member linked to a temp user via a node one-liner (postgres pkg, pattern of scripts/smoke-vendor-api.mjs — vendor named `__p3_smoke__`, all four scopes true; INSERT a users row `(openId '__p3_smoke__', role 'vendor')` and a vendor_members row). Then verify the tRPC path end-to-end WITHOUT a browser: `curl -s "http://localhost:3000/api/trpc/vendor.me" -H "Authorization: Bearer invalid"` → expect a tRPC UNAUTHORIZED envelope (proves route + middleware wired; full authed flow needs a Supabase session which is manual). Clean up the seed rows (DELETE users cascade removes membership; DELETE vendor). Record in report. `pnpm check` + `pnpm exec vite build` + `pnpm test:server` all green.

- [ ] **Step 4: todo.md close-out**

In the "Vendor KPI follow-ups" section: mark the Phase 3 item done (`- [x] Phase 3: /vendor dashboard UI …`) and append:

```markdown
- [ ] Manual E2E: sign in as a vendor-linked account, verify /vendor tabs render real data, suppressed cells show •••, CSV downloads (needs a real Supabase session — owner action)
- [ ] Vendor dashboard polish candidates: retention cohort chart (currently table), per-tab loading skeletons, dark-mode chart color audit, auto-redirect vendor-role users from / to /vendor after login (spec "vendors land here"; currently reached via header menu link)
```

- [ ] **Step 5: Commit**

```bash
git add client/src/pages/vendor/ todo.md
git commit -m "feat(vendor-ui): API access tab + docs; phase 3 close-out"
```
