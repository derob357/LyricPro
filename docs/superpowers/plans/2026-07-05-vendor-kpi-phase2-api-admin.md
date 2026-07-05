# Vendor KPI Phase 2 — REST API + Admin Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Vendors get admin-provisioned, scope-limited, API-key-authenticated REST access (`/api/vendor/v1/*`) to the Phase 1 KPI rollups, with an admin "Vendors" tab to manage vendors, members, scopes, and keys.

**Architecture:** New vendor tables + `vendor` role (hand-applied SQL, then drizzle `db:generate` per current convention). A shared read layer (`server/vendor/kpiQueries.ts`) applies k-anonymity suppression and granularity bucketing over the rollup tables; pure handler functions (`vendorApi.ts`) produce envelope/CSV responses; a thin Express router (`vendorRest.ts`) does key auth + rate limiting and registers in `server/_core/index.ts`. Admin CRUD is a standard tRPC `adminProcedure` router + a `VendorsTab` in the existing admin dashboard. Spec: `docs/superpowers/specs/2026-07-02-vendor-kpi-dashboard-api-design.md` (Phase 2 scope).

**Tech Stack:** Express 4, tRPC 11, zod 4, drizzle + postgres.js, vitest (fake-db pattern), wouter + sonner + lucide-react (client), node:crypto.

## Global Constraints

- Suppression threshold: env `VENDOR_KPI_MIN_COHORT`, **default 10** (user decision 2026-07-05; spec's k=50 deferred until traffic grows). Complementary suppression required. Disclosed in definitions.
- Rate limiting: **in-process** `rateLimit()` from `server/_core/rateLimit.ts` keyed by key id (user decision; Upstash Redis deferred — todo item exists).
- Uniform auth failure: `401 {"error":"invalid_api_key","correlationId":"…"}` for missing/malformed/unknown/revoked/expired keys and suspended vendors — reason logged server-side only. `403 {"error":"scope_not_granted",…}` only for a valid key requesting an unscoped family.
- Max **2 active (non-revoked) keys per vendor**. Full key shown exactly ONCE at creation; store SHA-256 hex hash + prefix (first 12 chars) + last4. Key format `lp_live_` + 40 base62 chars (crypto.randomInt — no modulo bias).
- Date params `YYYY-MM-DD`; range cap **400 days** → 400 `{"error":"invalid_range",…}`. Timezone: America/New_York everywhere (rollup dates already are).
- Metric keys are the Phase 1 contract: dau, wau, mau, new_users, new_guests, guest_conversions, sessions, sessions_with_end, session_seconds_sum, rounds, displays (dims all/genre/decade), gn_purchased, gn_spent (dim kind), addon_revenue_usd, entry_fee_revenue_usd, prizes_paid_usd, active_subscriptions (dim tier).
- Definitions footnotes must state: active-user definition, classic bounded retention (registered users only), timezone, gross revenue basis, GN units vs USD units, current k, and the `active_subscriptions` backfill caveat (2026-04-05..2026-07-04 reflects state at backfill time).
- Raw-table columns quoted camelCase; NEW tables snake_case. Drizzle workflow: edit schema.ts → `pnpm db:generate` → commit schema + generated sql (header-marked pre-applied) + meta together; `pnpm db:check` must pass. NEVER `db:push`.
- Migrations: hand-written SQL in `scripts/migrations/applied/` applied FIRST via `node scripts/apply-kpi-migration.mjs <file> [--dry-run]` (hits PROD — single-Supabase; dry-run first).
- SECURITY: never print env var values; do not Read .env. No PII in any vendor-visible response. Conventional commits, NO Co-Authored-By trailer.
- TypeScript strict, ESM. Server tests: `pnpm test:server <path>`. Typecheck: `pnpm check`.

---

### Task 1: Vendor tables + `vendor` role (migration + drizzle)

**Files:**
- Create: `scripts/migrations/applied/2026-07-05-vendor-tables.sql`
- Modify: `drizzle/schema.ts` (line 28 enum + append tables after the KPI rollup block ~line 1513)

**Interfaces:**
- Produces: drizzle exports `vendors`, `vendorMembers`, `vendorApiKeys`, `vendorApiUsage`; `userRoleEnum` now `["user","admin","vendor"]`; type `Vendor = typeof vendors.$inferSelect`.

- [ ] **Step 1: Write the migration SQL**

```sql
-- 2026-07-05-vendor-tables.sql
-- Vendor KPI Phase 2: vendor org/member/key tables + 'vendor' user role.
-- Idempotent. Applied via: scripts/apply-kpi-migration.mjs (generic runner).
-- Spec: docs/superpowers/specs/2026-07-02-vendor-kpi-dashboard-api-design.md

ALTER TYPE user_role ADD VALUE IF NOT EXISTS 'vendor';

CREATE TABLE IF NOT EXISTS vendors (
  id              serial PRIMARY KEY,
  name            varchar(128) NOT NULL,
  contact_email   varchar(320),
  status          varchar(16) NOT NULL DEFAULT 'active', -- 'active' | 'suspended'
  scope_growth       boolean NOT NULL DEFAULT false,
  scope_engagement   boolean NOT NULL DEFAULT false,
  scope_content      boolean NOT NULL DEFAULT false,
  scope_monetization boolean NOT NULL DEFAULT false,
  catalog_filter  jsonb,             -- {"songIds":[..]} and/or {"artists":[..]}; NULL = all content
  created_at      timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS vendor_members (
  id         serial PRIMARY KEY,
  vendor_id  integer NOT NULL REFERENCES vendors(id) ON DELETE CASCADE,
  user_id    integer NOT NULL UNIQUE REFERENCES users(id) ON DELETE CASCADE,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS vendor_members_vendor_idx ON vendor_members (vendor_id);

CREATE TABLE IF NOT EXISTS vendor_api_keys (
  id           serial PRIMARY KEY,
  vendor_id    integer NOT NULL REFERENCES vendors(id) ON DELETE CASCADE,
  label        varchar(64) NOT NULL,
  key_prefix   varchar(16) NOT NULL,  -- e.g. 'lp_live_Ab3d'
  last4        varchar(4)  NOT NULL,
  key_hash     varchar(64) NOT NULL UNIQUE, -- sha256 hex of full plaintext key
  last_used_at timestamptz,
  expires_at   timestamptz,
  revoked_at   timestamptz,
  created_at   timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS vendor_api_keys_vendor_idx ON vendor_api_keys (vendor_id);

CREATE TABLE IF NOT EXISTS vendor_api_usage (
  key_id        integer NOT NULL REFERENCES vendor_api_keys(id) ON DELETE CASCADE,
  date          date NOT NULL,
  request_count integer NOT NULL DEFAULT 0,
  PRIMARY KEY (key_id, date)
);
```

- [ ] **Step 2: Dry-run then apply (PROD — deliberate)**

Run: `node scripts/apply-kpi-migration.mjs scripts/migrations/applied/2026-07-05-vendor-tables.sql --dry-run` → preview, exit 0.
Run: `node scripts/apply-kpi-migration.mjs scripts/migrations/applied/2026-07-05-vendor-tables.sql` → `Applied OK.`
(Note: `ALTER TYPE … ADD VALUE IF NOT EXISTS` is transaction-safe on PG12+; the new value is not used in the same transaction.)

- [ ] **Step 3: Update drizzle schema**

In `drizzle/schema.ts` line 28: `export const userRoleEnum = pgEnum("user_role", ["user", "admin", "vendor"]);`

Append after the KPI rollup tables block:

```typescript
// ─── Vendor KPI Phase 2: vendor orgs, members, API keys ─────────────────────
export const vendors = pgTable("vendors", {
  id: serial("id").primaryKey(),
  name: varchar("name", { length: 128 }).notNull(),
  contactEmail: varchar("contact_email", { length: 320 }),
  status: varchar("status", { length: 16 }).default("active").notNull(), // active | suspended
  scopeGrowth: boolean("scope_growth").default(false).notNull(),
  scopeEngagement: boolean("scope_engagement").default(false).notNull(),
  scopeContent: boolean("scope_content").default(false).notNull(),
  scopeMonetization: boolean("scope_monetization").default(false).notNull(),
  catalogFilter: jsonb("catalog_filter").$type<{ songIds?: number[]; artists?: string[] } | null>(),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
});
export type Vendor = typeof vendors.$inferSelect;

export const vendorMembers = pgTable("vendor_members", {
  id: serial("id").primaryKey(),
  vendorId: integer("vendor_id").notNull().references(() => vendors.id, { onDelete: "cascade" }),
  userId: integer("user_id").notNull().unique().references(() => users.id, { onDelete: "cascade" }),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
});

export const vendorApiKeys = pgTable("vendor_api_keys", {
  id: serial("id").primaryKey(),
  vendorId: integer("vendor_id").notNull().references(() => vendors.id, { onDelete: "cascade" }),
  label: varchar("label", { length: 64 }).notNull(),
  keyPrefix: varchar("key_prefix", { length: 16 }).notNull(),
  last4: varchar("last4", { length: 4 }).notNull(),
  keyHash: varchar("key_hash", { length: 64 }).notNull().unique(),
  lastUsedAt: timestamp("last_used_at", { withTimezone: true }),
  expiresAt: timestamp("expires_at", { withTimezone: true }),
  revokedAt: timestamp("revoked_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
});

export const vendorApiUsage = pgTable(
  "vendor_api_usage",
  {
    keyId: integer("key_id").notNull().references(() => vendorApiKeys.id, { onDelete: "cascade" }),
    date: date("date").notNull(),
    requestCount: integer("request_count").default(0).notNull(),
  },
  (t) => ({ pk: primaryKey({ columns: [t.keyId, t.date] }) }),
);
```

- [ ] **Step 4: Generate snapshot, mark pre-applied, verify**

Run: `pnpm exec drizzle-kit generate --name vendor_tables`
Prepend to the generated `drizzle/0004_vendor_tables.sql` (keep generated content below):

```
-- ALREADY APPLIED TO PROD (manually, 2026-07-05) via
-- scripts/migrations/applied/2026-07-05-vendor-tables.sql.
-- Kept for drizzle journal coherence; do NOT re-apply.
```

Run: `pnpm check` → clean. Commit, then `pnpm db:check` → "in sync".

- [ ] **Step 5: Commit**

```bash
git add scripts/migrations/applied/2026-07-05-vendor-tables.sql drizzle/
git commit -m "feat(vendor): vendor org/member/key tables + vendor role (pre-applied to prod)"
```

---

### Task 2: API key generation + authentication (`vendorAuth.ts`, TDD)

**Files:**
- Create: `server/vendor/vendorAuth.ts`
- Test: `server/vendor/vendorAuth.test.ts`

**Interfaces:**
- Consumes: `vendors`, `vendorApiKeys`, `vendorApiUsage` (Task 1); `getDb` type from `server/db.ts`.
- Produces:
  - `generateApiKey(): GeneratedKey` — `{ plaintext, prefix, last4, hash }`
  - `hashKey(plaintext: string): string` — sha256 hex
  - `authenticateVendorKey(db, authHeader: string | undefined): Promise<VendorAuth | null>` — `VendorAuth = { keyId: number; vendor: { id: number; name: string; status: string; scopeGrowth: boolean; scopeEngagement: boolean; scopeContent: boolean; scopeMonetization: boolean; catalogFilter: { songIds?: number[]; artists?: string[] } | null } }`. Returns null for EVERY failure mode (uniformity). On success, fire-and-forget bumps `last_used_at` + `vendor_api_usage`.

- [ ] **Step 1: Write the failing test**

```typescript
// server/vendor/vendorAuth.test.ts
import { describe, expect, it, vi } from "vitest";
import { authenticateVendorKey, generateApiKey, hashKey } from "./vendorAuth";

function makeFakeDb(queue: unknown[][]) {
  let call = 0;
  return { execute: vi.fn().mockImplementation(() => Promise.resolve(queue[call++] ?? [])) };
}

const VENDOR_ROW = {
  key_id: 7, vendor_id: 3, name: "Acme", status: "active",
  scope_growth: true, scope_engagement: false, scope_content: true, scope_monetization: false,
  catalog_filter: { songIds: [1, 2] }, expires_at: null,
};

describe("generateApiKey", () => {
  it("produces lp_live_ + 40 base62 chars with matching prefix/last4/hash", () => {
    const k = generateApiKey();
    expect(k.plaintext).toMatch(/^lp_live_[A-Za-z0-9]{40}$/);
    expect(k.prefix).toBe(k.plaintext.slice(0, 12));
    expect(k.last4).toBe(k.plaintext.slice(-4));
    expect(k.hash).toBe(hashKey(k.plaintext));
    expect(k.hash).toMatch(/^[a-f0-9]{64}$/);
  });
  it("generates unique keys", () => {
    expect(generateApiKey().plaintext).not.toBe(generateApiKey().plaintext);
  });
});

describe("authenticateVendorKey", () => {
  it("returns VendorAuth for a valid key", async () => {
    const db = makeFakeDb([[VENDOR_ROW], [], []]);
    const auth = await authenticateVendorKey(db as never, "Bearer lp_live_" + "a".repeat(40));
    expect(auth).toEqual({
      keyId: 7,
      vendor: {
        id: 3, name: "Acme", status: "active",
        scopeGrowth: true, scopeEngagement: false, scopeContent: true, scopeMonetization: false,
        catalogFilter: { songIds: [1, 2] },
      },
    });
  });
  it("returns null for missing/malformed headers without touching the db", async () => {
    const db = makeFakeDb([]);
    expect(await authenticateVendorKey(db as never, undefined)).toBeNull();
    expect(await authenticateVendorKey(db as never, "Bearer wrong_format")).toBeNull();
    expect(await authenticateVendorKey(db as never, "Bearer lp_live_short")).toBeNull();
    expect(db.execute).not.toHaveBeenCalled();
  });
  it("returns null when no key row matches (unknown or revoked)", async () => {
    const db = makeFakeDb([[]]);
    expect(await authenticateVendorKey(db as never, "Bearer lp_live_" + "a".repeat(40))).toBeNull();
  });
  it("returns null for an expired key", async () => {
    const db = makeFakeDb([[{ ...VENDOR_ROW, expires_at: new Date("2020-01-01") }]]);
    expect(await authenticateVendorKey(db as never, "Bearer lp_live_" + "a".repeat(40))).toBeNull();
  });
  it("returns null for a suspended vendor", async () => {
    const db = makeFakeDb([[{ ...VENDOR_ROW, status: "suspended" }]]);
    expect(await authenticateVendorKey(db as never, "Bearer lp_live_" + "a".repeat(40))).toBeNull();
  });
});
```

- [ ] **Step 2: Run to verify failure**

Run: `pnpm test:server server/vendor/vendorAuth.test.ts` → FAIL (module not found).

- [ ] **Step 3: Implement**

```typescript
// server/vendor/vendorAuth.ts
// API-key generation + authentication for the vendor REST API.
// Failure modes are deliberately indistinguishable to callers (uniform null);
// the true reason is only ever logged server-side by the caller.
import crypto from "node:crypto";
import { sql } from "drizzle-orm";
import type { getDb } from "../db";

type Db = NonNullable<Awaited<ReturnType<typeof getDb>>>;

export interface GeneratedKey {
  plaintext: string;
  prefix: string;
  last4: string;
  hash: string;
}

export interface VendorAuth {
  keyId: number;
  vendor: {
    id: number;
    name: string;
    status: string;
    scopeGrowth: boolean;
    scopeEngagement: boolean;
    scopeContent: boolean;
    scopeMonetization: boolean;
    catalogFilter: { songIds?: number[]; artists?: string[] } | null;
  };
}

const ALPHABET = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789";
const KEY_RE = /^Bearer\s+(lp_live_[A-Za-z0-9]{40})$/;

export function hashKey(plaintext: string): string {
  return crypto.createHash("sha256").update(plaintext).digest("hex");
}

export function generateApiKey(): GeneratedKey {
  let secret = "";
  for (let i = 0; i < 40; i++) secret += ALPHABET[crypto.randomInt(ALPHABET.length)];
  const plaintext = `lp_live_${secret}`;
  return {
    plaintext,
    prefix: plaintext.slice(0, 12),
    last4: plaintext.slice(-4),
    hash: hashKey(plaintext),
  };
}

function toRows(result: unknown): Record<string, unknown>[] {
  return Array.isArray(result)
    ? (result as Record<string, unknown>[])
    : Array.from(result as Iterable<Record<string, unknown>>);
}

export async function authenticateVendorKey(
  db: Db,
  authHeader: string | undefined,
): Promise<VendorAuth | null> {
  const m = KEY_RE.exec(authHeader ?? "");
  if (!m) return null;
  const hash = hashKey(m[1]!);

  const rows = toRows(
    await db.execute(sql`
      SELECT k.id AS key_id, k.expires_at,
             v.id AS vendor_id, v.name, v.status,
             v.scope_growth, v.scope_engagement, v.scope_content, v.scope_monetization,
             v.catalog_filter
      FROM vendor_api_keys k
      JOIN vendors v ON v.id = k.vendor_id
      WHERE k.key_hash = ${hash} AND k.revoked_at IS NULL
      LIMIT 1
    `),
  );
  const row = rows[0];
  if (!row) return null;
  if (row.expires_at && new Date(row.expires_at as string | Date) < new Date()) return null;
  if (row.status !== "active") return null;

  const keyId = Number(row.key_id);
  // Fire-and-forget bookkeeping — auth latency must not pay for it, and a
  // bookkeeping failure must not fail the request.
  void Promise.allSettled([
    db.execute(sql`UPDATE vendor_api_keys SET last_used_at = now() WHERE id = ${keyId}`),
    db.execute(sql`
      INSERT INTO vendor_api_usage (key_id, date, request_count)
      VALUES (${keyId}, (now() AT TIME ZONE 'America/New_York')::date, 1)
      ON CONFLICT (key_id, date) DO UPDATE
        SET request_count = vendor_api_usage.request_count + 1
    `),
  ]);

  return {
    keyId,
    vendor: {
      id: Number(row.vendor_id),
      name: String(row.name),
      status: String(row.status),
      scopeGrowth: Boolean(row.scope_growth),
      scopeEngagement: Boolean(row.scope_engagement),
      scopeContent: Boolean(row.scope_content),
      scopeMonetization: Boolean(row.scope_monetization),
      catalogFilter: (row.catalog_filter ?? null) as VendorAuth["vendor"]["catalogFilter"],
    },
  };
}
```

- [ ] **Step 4: Run to verify pass**

Run: `pnpm test:server server/vendor/vendorAuth.test.ts` → 7 passed.
Note: the valid-key test's fake queue includes two empty arrays for the fire-and-forget calls; `Promise.allSettled` swallows their absence either way.

- [ ] **Step 5: Commit**

```bash
git add server/vendor/vendorAuth.ts server/vendor/vendorAuth.test.ts
git commit -m "feat(vendor): API key generation + uniform key authentication"
```

---

### Task 3: Suppression + bucketing + definitions (`kpiSuppress.ts`, `kpiDefinitions.ts`, TDD)

**Files:**
- Create: `server/vendor/kpiSuppress.ts`, `server/vendor/kpiDefinitions.ts`
- Test: `server/vendor/kpiSuppress.test.ts`

**Interfaces:**
- Produces:
  - `minCohort(): number` — env `VENDOR_KPI_MIN_COHORT`, default 10, non-negative int
  - `suppressCell(value: number, userCount: number, k: number): { value: number | null; suppressed: boolean }`
  - `applyBreakdownSuppression<T extends { value: number | null; userCount: number; suppressed: boolean }>(cells: T[], k: number): T[]` — primary + complementary rule
  - `bucketKey(isoDate: string, g: "day" | "week" | "month"): string`
  - `KPI_DEFINITIONS: Record<string, string>` and `DEFINITION_NOTES: string[]` (from kpiDefinitions.ts)

- [ ] **Step 1: Write the failing test**

```typescript
// server/vendor/kpiSuppress.test.ts
import { afterEach, describe, expect, it } from "vitest";
import { applyBreakdownSuppression, bucketKey, minCohort, suppressCell } from "./kpiSuppress";

afterEach(() => { delete process.env.VENDOR_KPI_MIN_COHORT; });

describe("minCohort", () => {
  it("defaults to 10", () => { expect(minCohort()).toBe(10); });
  it("reads env override", () => {
    process.env.VENDOR_KPI_MIN_COHORT = "50";
    expect(minCohort()).toBe(50);
  });
  it("falls back to 10 on garbage", () => {
    process.env.VENDOR_KPI_MIN_COHORT = "-3";
    expect(minCohort()).toBe(10);
  });
});

describe("suppressCell", () => {
  it("suppresses below k", () => {
    expect(suppressCell(42, 9, 10)).toEqual({ value: null, suppressed: true });
  });
  it("passes at or above k", () => {
    expect(suppressCell(42, 10, 10)).toEqual({ value: 42, suppressed: false });
  });
  it("k=0 disables suppression", () => {
    expect(suppressCell(42, 0, 0)).toEqual({ value: 42, suppressed: false });
  });
});

describe("applyBreakdownSuppression (complementary rule)", () => {
  const cell = (v: number, uc: number) => ({ value: v as number | null, userCount: uc, suppressed: false });
  it("suppresses each cell below k", () => {
    const out = applyBreakdownSuppression([cell(100, 50), cell(5, 5)], 10);
    expect(out[0]!.suppressed).toBe(false);
    expect(out[1]!).toMatchObject({ value: null, suppressed: true });
  });
  it("when exactly one cell is suppressed, also suppresses the next-smallest (anti-differencing)", () => {
    const out = applyBreakdownSuppression([cell(100, 50), cell(30, 20), cell(5, 5)], 10);
    expect(out.filter((c) => c.suppressed)).toHaveLength(2);
    expect(out[1]!).toMatchObject({ value: null, suppressed: true }); // next-smallest by userCount
    expect(out[0]!.suppressed).toBe(false);
  });
  it("no suppression → untouched", () => {
    const out = applyBreakdownSuppression([cell(100, 50), cell(30, 20)], 10);
    expect(out.every((c) => !c.suppressed)).toBe(true);
  });
});

describe("bucketKey", () => {
  it("day is identity", () => { expect(bucketKey("2026-07-05", "day")).toBe("2026-07-05"); });
  it("week is the Monday of the ISO week", () => {
    expect(bucketKey("2026-07-05", "week")).toBe("2026-06-29"); // Sunday → prior Monday
    expect(bucketKey("2026-06-29", "week")).toBe("2026-06-29"); // Monday → itself
  });
  it("month is YYYY-MM", () => { expect(bucketKey("2026-07-05", "month")).toBe("2026-07"); });
});
```

- [ ] **Step 2: Run to verify failure**

Run: `pnpm test:server server/vendor/kpiSuppress.test.ts` → FAIL (module not found).

- [ ] **Step 3: Implement kpiSuppress.ts**

```typescript
// server/vendor/kpiSuppress.ts
// k-anonymity suppression + granularity bucketing for vendor-visible KPIs.

export function minCohort(): number {
  const raw = Number(process.env.VENDOR_KPI_MIN_COHORT ?? "10");
  return Number.isInteger(raw) && raw >= 0 ? raw : 10;
}

export function suppressCell(
  value: number,
  userCount: number,
  k: number,
): { value: number | null; suppressed: boolean } {
  if (k > 0 && userCount < k) return { value: null, suppressed: true };
  return { value, suppressed: false };
}

// Complementary suppression: after primary suppression, if EXACTLY ONE cell in
// a breakdown is suppressed, its value could be derived by subtracting the
// visible cells from the (visible) total — so also suppress the next-smallest
// visible cell (by userCount).
export function applyBreakdownSuppression<
  T extends { value: number | null; userCount: number; suppressed: boolean },
>(cells: T[], k: number): T[] {
  const out = cells.map((c) => {
    if (c.value === null || c.suppressed) return { ...c, value: null, suppressed: true };
    const s = suppressCell(c.value, c.userCount, k);
    return { ...c, value: s.value, suppressed: s.suppressed };
  });
  if (out.filter((c) => c.suppressed).length === 1) {
    const visible = out.filter((c) => !c.suppressed).sort((a, b) => a.userCount - b.userCount);
    const target = visible[0];
    if (target) {
      target.value = null;
      target.suppressed = true;
    }
  }
  return out;
}

export type Granularity = "day" | "week" | "month";

export function bucketKey(isoDate: string, g: Granularity): string {
  if (g === "day") return isoDate;
  if (g === "month") return isoDate.slice(0, 7);
  // week → Monday of the ISO week (UTC-safe: date-only math)
  const d = new Date(`${isoDate}T00:00:00Z`);
  const dow = d.getUTCDay(); // 0=Sun..6=Sat
  const back = dow === 0 ? 6 : dow - 1;
  d.setUTCDate(d.getUTCDate() - back);
  return d.toISOString().slice(0, 10);
}
```

- [ ] **Step 4: Implement kpiDefinitions.ts** (no test — static data; type-checked)

```typescript
// server/vendor/kpiDefinitions.ts
// Machine-readable definition footnotes served in /v1/meta and rendered under
// every dashboard chart. Unlabeled metrics get assumed to be the strictest
// standard definition during diligence — always ship these alongside numbers.
import { minCohort } from "./kpiSuppress";

export const KPI_DEFINITIONS: Record<string, string> = {
  dau: "Unique users+guests with ≥1 game session started or lyric displayed that calendar day (America/New_York). Guests identified by session token.",
  wau: "Unique users+guests active in the trailing 7 calendar days ending that day (inclusive).",
  mau: "Unique users+guests active in the trailing 30 calendar days ending that day (inclusive).",
  stickiness: "Average DAU over the range ÷ MAU on the range's last day.",
  new_users: "Registered accounts created that day.",
  new_guests: "Guest sessions created that day.",
  guest_conversions: "Registered accounts created that day whose email matches a guest session from the prior 30 days.",
  sessions: "Game sessions started that day. No inactivity-timeout model — a session is one game.",
  avg_session_seconds: "Sum of (ended−started) over sessions with a recorded end ÷ count of those sessions.",
  rounds: "Round results recorded that day.",
  rounds_per_session: "Rounds ÷ sessions for the same period.",
  retention: "Classic bounded N-day retention: % of registered accounts created on the cohort day (day 0) active exactly on day N (N=1/7/30). Registered users only — guests lack stable cross-device identity.",
  displays: "Lyric displays (one per lyric shown).",
  correct_rate: "Rounds with lyric points > 0 ÷ rounds played.",
  avg_response_seconds: "Mean recorded response time over rounds with a response time.",
  gn_purchased: "Golden Notes purchased (GN units — virtual currency, not USD).",
  gn_spent: "Golden Notes spent, by spend kind (GN units).",
  addon_revenue_usd: "Completed add-on game purchases, USD gross (before payment fees).",
  entry_fee_revenue_usd: "Total entry fees collected for games completed that day, USD gross.",
  prizes_paid_usd: "Completed prize payouts, USD.",
  active_subscriptions: "Paid subscriptions (tier ≠ free) active on that day, by tier. CAVEAT: days backfilled on 2026-07-05 (range 2026-04-05..2026-07-04) reflect subscription state at backfill time, not historical state.",
  arpdau: "Day's gross transactional revenue (GN purchase spend excluded — GN is virtual; uses addon + entry-fee USD) ÷ DAU.",
};

export function definitionNotes(): string[] {
  return [
    "Timezone: all days are calendar days in America/New_York.",
    "Identity: user id for registered accounts, session token for guests; multi-device users may count once per identity.",
    "Revenue basis: gross, before store/payment fees. GN metrics are virtual-currency units, not USD.",
    `Privacy: cells derived from fewer than ${minCohort()} users are suppressed (value=null, suppressed=true); complementary cells may also be suppressed to prevent differencing.`,
    "Weekly/monthly granularity: additive metrics are summed; dau is averaged; wau/mau/active_subscriptions use the bucket's last available day.",
    "Data freshness: nightly rollup — figures are as of the last closed day.",
  ];
}
```

- [ ] **Step 5: Run tests + typecheck, commit**

Run: `pnpm test:server server/vendor/kpiSuppress.test.ts` → 10 passed. `pnpm check` → clean.

```bash
git add server/vendor/kpiSuppress.ts server/vendor/kpiSuppress.test.ts server/vendor/kpiDefinitions.ts
git commit -m "feat(vendor): suppression/bucketing core + KPI definition footnotes"
```

---

### Task 4: Shared read layer (`kpiQueries.ts`, TDD)

**Files:**
- Create: `server/vendor/kpiQueries.ts`
- Test: `server/vendor/kpiQueries.test.ts`

**Interfaces:**
- Consumes: Task 3 helpers; rollup tables via `db.execute(sql\`…\`)` (fake-db-friendly).
- Produces (all take `(db, params)`; every numeric cell is `{ value: number | null, suppressed: boolean }`):
  - `type Range = { from: string; to: string; granularity: Granularity }`
  - `getDateRange(db): Promise<{ min: string | null; max: string | null }>`
  - `getGrowth(db, r: Range): Promise<GrowthRow[]>` — `GrowthRow = { bucket: string; dau: Cell; wau: Cell; mau: Cell; newUsers: Cell; newGuests: Cell; guestConversions: Cell; stickiness: Cell }`
  - `getEngagement(db, r: Range): Promise<{ series: EngagementRow[]; retention: RetentionRow[] }>` — `EngagementRow = { bucket: string; sessions: Cell; avgSessionSeconds: Cell; rounds: Cell; roundsPerSession: Cell }`, `RetentionRow = { cohortDate: string; dayOffset: number; cohortSize: Cell; retainedRate: Cell }`
  - `getContent(db, r: Range & { dimension: "song" | "genre" | "decade"; limit: number; catalogFilter: { songIds?: number[]; artists?: string[] } | null }): Promise<ContentRow[]>` — `ContentRow = { key: string; displays: Cell; roundsPlayed: Cell; correctRate: Cell; avgResponseSeconds: Cell }`
  - `getMonetization(db, r: Range): Promise<MonetizationRow[]>` — `{ bucket: string; gnPurchased: Cell; gnSpentByKind: Record<string, Cell>; addonRevenueUsd: Cell; entryFeeRevenueUsd: Cell; prizesPaidUsd: Cell; subscriptionsByTier: Record<string, Cell>; arpdau: Cell }`
  - `type Cell = { value: number | null; suppressed: boolean }`

Implementation strategy (binding): ONE SQL query per function against `kpi_daily_metrics` (`WHERE metric = ANY(...) AND date BETWEEN from AND to`), all bucketing/derivation/suppression in TS using Task 3 helpers. `getContent` with `dimension: "song"` queries `kpi_daily_song_stats JOIN songs` (title/artist for labels, catalog filter as `AND (s.id = ANY(${songIds}) OR lower(s."artistName") = ANY(${artistsLower}))` when filter present); genre/decade read `kpi_daily_metrics` dimension rows and are NOT catalog-filtered (aggregate dims) — but when a catalogFilter is set, genre/decade dimensions return `[]` (a filtered vendor sees only song-level stats for their catalog; documented in meta).

Aggregation rules (binding, must match `definitionNotes()`): additive metrics sum `value` and sum `userCount` per bucket; `dau` averages value (userCount = min of days' userCount in bucket); `wau`/`mau`/`active_subscriptions` take the bucket's last day; rates computed AFTER bucketing from bucketed numerators/denominators; suppression applied last (per-bucket for series using the bucket userCount; `applyBreakdownSuppression` for gnSpentByKind/subscriptionsByTier/content rows). `retainedRate.value = retainedCount/cohortSize` (2 dp), suppressed when `cohortSize < k`. `stickiness = avg(dau)/mau_last` (3 dp). `arpdau = (addon + entryFee + prizes? NO — addon + entryFee only) / dau` per bucket, 4 dp, suppressed if dau suppressed or 0.

- [ ] **Step 1: Write the failing test**

```typescript
// server/vendor/kpiQueries.test.ts
import { describe, expect, it, vi } from "vitest";
import { getContent, getGrowth, getMonetization } from "./kpiQueries";

function makeFakeDb(queue: unknown[][]) {
  let call = 0;
  return { execute: vi.fn().mockImplementation(() => Promise.resolve(queue[call++] ?? [])) };
}
const R = { from: "2026-07-01", to: "2026-07-02", granularity: "day" as const };
const m = (date: string, metric: string, value: number, user_count: number, dimension = "all", dimension_value = "all") =>
  ({ date, metric, dimension, dimension_value, value, user_count });

describe("getGrowth", () => {
  it("maps daily metric rows into per-bucket cells with suppression (k=10 default)", async () => {
    const db = makeFakeDb([[
      m("2026-07-01", "dau", 25, 25), m("2026-07-01", "mau", 60, 60), m("2026-07-01", "wau", 40, 40),
      m("2026-07-01", "new_users", 3, 3),
      m("2026-07-02", "dau", 5, 5), m("2026-07-02", "mau", 61, 61), m("2026-07-02", "wau", 41, 41),
    ]]);
    const rows = await getGrowth(db as never, R);
    expect(rows).toHaveLength(2);
    expect(rows[0]!.dau).toEqual({ value: 25, suppressed: false });
    expect(rows[0]!.newUsers).toEqual({ value: null, suppressed: true }); // 3 < 10
    expect(rows[1]!.dau).toEqual({ value: null, suppressed: true });      // 5 < 10
    expect(rows[1]!.mau).toEqual({ value: 61, suppressed: false });
  });
  it("weekly granularity averages dau and takes last-day mau", async () => {
    const db = makeFakeDb([[
      m("2026-06-29", "dau", 20, 20), m("2026-06-30", "dau", 30, 30),
      m("2026-06-29", "mau", 100, 100), m("2026-06-30", "mau", 110, 110),
    ]]);
    const rows = await getGrowth(db as never, { from: "2026-06-29", to: "2026-06-30", granularity: "week" });
    expect(rows).toHaveLength(1);
    expect(rows[0]!.bucket).toBe("2026-06-29");
    expect(rows[0]!.dau.value).toBe(25);   // avg(20,30)
    expect(rows[0]!.mau.value).toBe(110);  // last day
  });
});

describe("getContent (song dimension)", () => {
  it("computes correct_rate after summing and suppresses small rows", async () => {
    const db = makeFakeDb([[
      { key: "Song A — Artist A", displays: 100, rounds_played: 50, correct_rounds: 30, response_seconds_sum: 250, response_count: 50, user_count: 40 },
      { key: "Song B — Artist B", displays: 4, rounds_played: 2, correct_rounds: 1, response_seconds_sum: 9, response_count: 2, user_count: 2 },
    ]]);
    const rows = await getContent(db as never, { ...R, dimension: "song", limit: 50, catalogFilter: null });
    expect(rows[0]!.correctRate).toEqual({ value: 0.6, suppressed: false });
    expect(rows[0]!.avgResponseSeconds).toEqual({ value: 5, suppressed: false });
    expect(rows[1]!.displays).toEqual({ value: null, suppressed: true });
  });
  it("returns [] for genre dimension when a catalogFilter is set", async () => {
    const db = makeFakeDb([]);
    const rows = await getContent(db as never, { ...R, dimension: "genre", limit: 50, catalogFilter: { songIds: [1] } });
    expect(rows).toEqual([]);
    expect(db.execute).not.toHaveBeenCalled();
  });
});

describe("getMonetization", () => {
  it("builds kind/tier breakdowns with complementary suppression and arpdau", async () => {
    const db = makeFakeDb([[
      m("2026-07-01", "dau", 20, 20),
      m("2026-07-01", "addon_revenue_usd", 100, 15),
      m("2026-07-01", "entry_fee_revenue_usd", 60, 12),
      m("2026-07-01", "gn_spent", 500, 30, "kind", "spend_hint"),
      m("2026-07-01", "gn_spent", 40, 4, "kind", "spend_tournament"),
      m("2026-07-01", "gn_spent", 200, 12, "kind", "spend_extra_game"),
    ]]);
    const rows = await getMonetization(db as never, { ...R, to: "2026-07-01" });
    expect(rows[0]!.arpdau).toEqual({ value: 8, suppressed: false }); // (100+60)/20
    const kinds = rows[0]!.gnSpentByKind;
    expect(kinds.spend_tournament).toEqual({ value: null, suppressed: true }); // 4 < 10
    // complementary: exactly one suppressed → next-smallest (spend_extra_game, uc 12) also suppressed
    expect(kinds.spend_extra_game).toEqual({ value: null, suppressed: true });
    expect(kinds.spend_hint!.suppressed).toBe(false);
  });
});
```

- [ ] **Step 2: Run to verify failure**

Run: `pnpm test:server server/vendor/kpiQueries.test.ts` → FAIL (module not found).

- [ ] **Step 3: Implement kpiQueries.ts**

Write `server/vendor/kpiQueries.ts` exporting exactly the Interfaces block's functions/types. Follow the binding implementation strategy and aggregation rules above. Skeleton for the metric-series pattern (getGrowth shown; getEngagement/getMonetization follow the same fetch→bucket→derive→suppress shape):

```typescript
// server/vendor/kpiQueries.ts
// Shared KPI read layer — consumed by BOTH the vendor REST API and (Phase 3)
// the tRPC vendorRouter, so dashboard and API numbers cannot drift.
import { sql } from "drizzle-orm";
import type { getDb } from "../db";
import { applyBreakdownSuppression, bucketKey, minCohort, suppressCell, type Granularity } from "./kpiSuppress";

type Db = NonNullable<Awaited<ReturnType<typeof getDb>>>;
export type Cell = { value: number | null; suppressed: boolean };
export type Range = { from: string; to: string; granularity: Granularity };

type MetricRow = { date: string; metric: string; dimension: string; dimension_value: string; value: number; user_count: number };

function toRows(result: unknown): Record<string, unknown>[] {
  return Array.isArray(result)
    ? (result as Record<string, unknown>[])
    : Array.from(result as Iterable<Record<string, unknown>>);
}

async function fetchMetrics(db: Db, metrics: string[], from: string, to: string): Promise<MetricRow[]> {
  const rows = toRows(await db.execute(sql`
    SELECT date::text AS date, metric, dimension, dimension_value, value, user_count
    FROM kpi_daily_metrics
    WHERE metric = ANY(${metrics}) AND date >= ${from}::date AND date <= ${to}::date
    ORDER BY date
  `));
  return rows.map((r) => ({
    date: String(r.date), metric: String(r.metric),
    dimension: String(r.dimension), dimension_value: String(r.dimension_value),
    value: Number(r.value), user_count: Number(r.user_count),
  }));
}

// Aggregation modes per the definitions contract.
type Agg = "sum" | "avg" | "last";
function aggregate(rows: MetricRow[], g: Granularity, mode: Agg): Map<string, { value: number; userCount: number }> {
  const buckets = new Map<string, { values: number[]; userCounts: number[] }>();
  for (const r of rows) {
    const b = bucketKey(r.date, g);
    const cur = buckets.get(b) ?? { values: [], userCounts: [] };
    cur.values.push(r.value); cur.userCounts.push(r.user_count);
    buckets.set(b, cur);
  }
  const out = new Map<string, { value: number; userCount: number }>();
  for (const [b, { values, userCounts }] of buckets) {
    if (mode === "sum") out.set(b, { value: values.reduce((a, v) => a + v, 0), userCount: userCounts.reduce((a, v) => a + v, 0) });
    else if (mode === "avg") out.set(b, { value: values.reduce((a, v) => a + v, 0) / values.length, userCount: Math.min(...userCounts) });
    else out.set(b, { value: values[values.length - 1]!, userCount: userCounts[userCounts.length - 1]! });
  }
  return out;
}

function cellAt(m: Map<string, { value: number; userCount: number }>, bucket: string, k: number): Cell {
  const e = m.get(bucket);
  if (!e) return { value: 0, suppressed: false };
  return suppressCell(round2(e.value), e.userCount, k);
}
const round2 = (n: number) => Math.round(n * 100) / 100;
```

…then `getGrowth` assembles buckets (union of bucket keys, sorted), computes `stickiness` from avg-dau ÷ last-mau per bucket, and returns rows. `getEngagement` additionally queries `kpi_retention_cohorts` (`SELECT cohort_date::text, day_offset, cohort_size, retained_count FROM kpi_retention_cohorts WHERE cohort_date >= ${from}::date AND cohort_date <= ${to}::date ORDER BY cohort_date, day_offset`) and computes `retainedRate`. `getContent` song-dimension SQL:

```sql
SELECT s.title || ' — ' || s."artistName" AS key,
       COALESCE(sum(st.displays),0)::int AS displays,
       COALESCE(sum(st.rounds_played),0)::int AS rounds_played,
       COALESCE(sum(st.correct_rounds),0)::int AS correct_rounds,
       COALESCE(sum(st.response_seconds_sum),0) AS response_seconds_sum,
       COALESCE(sum(st.response_count),0)::int AS response_count,
       COALESCE(max(st.user_count),0)::int AS user_count
FROM kpi_daily_song_stats st JOIN songs s ON s.id = st.song_id
WHERE st.date >= ${from}::date AND st.date <= ${to}::date
  [AND (st.song_id = ANY(${songIds}) OR lower(s."artistName") = ANY(${artistsLower}))]  -- only when catalogFilter
GROUP BY s.id, s.title, s."artistName"
ORDER BY 2 DESC
LIMIT ${limit}
```

(the catalog predicate: include the `song_id = ANY` arm only when `songIds?.length`, the artist arm only when `artists?.length`; combine with OR when both — build with drizzle `sql` composition). `user_count` for a multi-day song row uses `max` (a user active 2 days isn't 2 users; max of daily counts is the honest lower bound — note this in a comment). All content rows pass through `applyBreakdownSuppression`. genre/decade dims: `fetchMetrics(db, ["displays"], …)` filtered to `dimension = 'genre' | 'decade'`, summed per dimension_value, suppressed as a breakdown; return `[]` without querying when `catalogFilter` is set.

- [ ] **Step 4: Run to verify pass**

Run: `pnpm test:server server/vendor/kpiQueries.test.ts` → 5 passed. `pnpm check` → clean.

- [ ] **Step 5: Commit**

```bash
git add server/vendor/kpiQueries.ts server/vendor/kpiQueries.test.ts
git commit -m "feat(vendor): shared KPI read layer with suppression + bucketing"
```

---

### Task 5: Pure REST handlers + CSV (`vendorApi.ts`, TDD)

**Files:**
- Create: `server/vendor/vendorApi.ts`
- Test: `server/vendor/vendorApi.test.ts`

**Interfaces:**
- Consumes: Task 4 query functions + types; Task 3 definitions; Task 2 `VendorAuth`.
- Produces:
  - `type ApiResult = { status: number; body: unknown; csv?: { filename: string; content: string } }`
  - `handleMeta(db, auth: VendorAuth): Promise<ApiResult>`
  - `handleMetrics(db, auth: VendorAuth, family: string, query: Record<string, unknown>): Promise<ApiResult>` — validates family + query (zod), enforces scope (403), dispatches to kpiQueries, wraps in envelope, `format=csv` adds `csv`
  - `handleReports(db, auth: VendorAuth, body: unknown): Promise<ApiResult>` — `{reports: string[], from, to, granularity?}` → combined document, per-family scope filtering (unscoped requested family → 403, not silent omission)
  - `toCsv(rows: Record<string, unknown>[]): string` — flattens Cells to value or empty string + `<key>_suppressed` column; csvEscape per adminActions pattern

Envelope (binding): `{ meta: { vendor: string, range: { from, to, granularity }, generatedAt: string, definitions: { metrics: Record<string,string>, notes: string[] } }, data: … }`. `generatedAt = new Date().toISOString()`. Definitions in `meta` are filtered to the family's metrics (reports/meta include all granted families'). Errors: `{ error: string, correlationId: string }` — correlationId = `crypto.randomUUID()`, generated in these handlers so tests can assert shape.

Validation (zod, binding): `from`/`to` match `/^\d{4}-\d{2}-\d{2}$/`, `from <= to`, span ≤ 400 days → else 400 `invalid_range`. `granularity` enum day|week|month default day. `dimension` enum song|genre|decade default song; `limit` int 1–200 default 50. `family` ∈ growth|engagement|content|monetization → else 404 `not_found`. Scope map: growth→scopeGrowth, engagement→scopeEngagement, content→scopeContent, monetization→scopeMonetization.

- [ ] **Step 1: Write the failing test** (representative cases — write exactly these)

```typescript
// server/vendor/vendorApi.test.ts
import { describe, expect, it, vi } from "vitest";
import { handleMeta, handleMetrics, handleReports, toCsv } from "./vendorApi";
import type { VendorAuth } from "./vendorAuth";

function makeFakeDb(queue: unknown[][]) {
  let call = 0;
  return { execute: vi.fn().mockImplementation(() => Promise.resolve(queue[call++] ?? [])) };
}
const AUTH: VendorAuth = {
  keyId: 7,
  vendor: { id: 3, name: "Acme", status: "active", scopeGrowth: true, scopeEngagement: false, scopeContent: true, scopeMonetization: false, catalogFilter: null },
};
const Q = { from: "2026-07-01", to: "2026-07-02" };

describe("handleMetrics", () => {
  it("returns enveloped growth data for a scoped family", async () => {
    const db = makeFakeDb([[{ date: "2026-07-01", metric: "dau", dimension: "all", dimension_value: "all", value: 25, user_count: 25 }]]);
    const r = await handleMetrics(db as never, AUTH, "growth", Q);
    expect(r.status).toBe(200);
    const body = r.body as { meta: { vendor: string; range: { granularity: string } }; data: unknown[] };
    expect(body.meta.vendor).toBe("Acme");
    expect(body.meta.range.granularity).toBe("day");
    expect(body.data).toHaveLength(1);
  });
  it("403 scope_not_granted for unscoped family", async () => {
    const r = await handleMetrics(makeFakeDb([]) as never, AUTH, "engagement", Q);
    expect(r.status).toBe(403);
    expect(r.body).toMatchObject({ error: "scope_not_granted" });
    expect((r.body as { correlationId: string }).correlationId).toMatch(/[0-9a-f-]{36}/);
  });
  it("404 for unknown family", async () => {
    const r = await handleMetrics(makeFakeDb([]) as never, AUTH, "finance", Q);
    expect(r.status).toBe(404);
  });
  it("400 invalid_range for >400-day span and bad dates", async () => {
    expect((await handleMetrics(makeFakeDb([]) as never, AUTH, "growth", { from: "2020-01-01", to: "2026-01-01" })).status).toBe(400);
    expect((await handleMetrics(makeFakeDb([]) as never, AUTH, "growth", { from: "07/01/2026", to: "2026-07-02" })).status).toBe(400);
    expect((await handleMetrics(makeFakeDb([]) as never, AUTH, "growth", { from: "2026-07-02", to: "2026-07-01" })).status).toBe(400);
  });
  it("format=csv attaches a csv artifact", async () => {
    const db = makeFakeDb([[{ date: "2026-07-01", metric: "dau", dimension: "all", dimension_value: "all", value: 25, user_count: 25 }]]);
    const r = await handleMetrics(db as never, AUTH, "growth", { ...Q, format: "csv" });
    expect(r.status).toBe(200);
    expect(r.csv!.filename).toBe("lyricpro-growth-2026-07-01-2026-07-02.csv");
    expect(r.csv!.content.split("\n")[0]).toContain("bucket");
  });
});

describe("handleReports", () => {
  it("combines scoped families and 403s if any requested family is unscoped", async () => {
    const bad = await handleReports(makeFakeDb([]) as never, AUTH, { reports: ["growth", "monetization"], ...Q });
    expect(bad.status).toBe(403);
    const db = makeFakeDb([[], []]); // growth metrics, content song rows
    const ok = await handleReports(db as never, AUTH, { reports: ["growth", "content"], ...Q });
    expect(ok.status).toBe(200);
    expect(Object.keys((ok.body as { data: Record<string, unknown> }).data).sort()).toEqual(["content", "growth"]);
  });
  it("400 on malformed body", async () => {
    expect((await handleReports(makeFakeDb([]) as never, AUTH, { reports: "growth" })).status).toBe(400);
  });
});

describe("handleMeta", () => {
  it("returns scopes, date range and definitions", async () => {
    const db = makeFakeDb([[{ min: "2026-04-05", max: "2026-07-04" }]]);
    const r = await handleMeta(db as never, AUTH);
    expect(r.status).toBe(200);
    const body = r.body as { data: { scopes: string[]; dateRange: { min: string } } };
    expect(body.data.scopes.sort()).toEqual(["content", "growth"]);
    expect(body.data.dateRange.min).toBe("2026-04-05");
  });
});

describe("toCsv", () => {
  it("flattens cells and escapes", () => {
    const csv = toCsv([{ bucket: "2026-07-01", dau: { value: 25, suppressed: false }, note: 'a,"b"' }]);
    expect(csv.split("\n")[0]).toBe("bucket,dau,dau_suppressed,note");
    expect(csv.split("\n")[1]).toBe('2026-07-01,25,false,"a,""b"""');
  });
  it("suppressed cells emit empty value", () => {
    const csv = toCsv([{ dau: { value: null, suppressed: true } }]);
    expect(csv.split("\n")[1]).toBe(",true");
  });
});
```

- [ ] **Step 2: Run to verify failure** → module not found.

- [ ] **Step 3: Implement vendorApi.ts**

Implement exactly the Produces interface. Key parts: zod schemas at top (`rangeSchema` with `.refine` for order + ≤400-day span via `Date.UTC` diff); `SCOPE_MAP: Record<string, keyof VendorAuth["vendor"]>`; family dispatch `growth → getGrowth`, `engagement → getEngagement`, `content → getContent (dimension/limit/catalogFilter from auth)`, `monetization → getMonetization`; `envelope(auth, range, familyMetricKeys, data)` builder filtering `KPI_DEFINITIONS`; `err(status, code)` returning `{ status, body: { error: code, correlationId: crypto.randomUUID() } }`; `getDateRange` for meta via `SELECT min(date)::text AS min, max(date)::text AS max FROM kpi_daily_metrics`; `toCsv` flattening `{value,suppressed}` objects into two columns, csvEscape identical to `server/routers/adminActions.ts:117-123` pattern. CSV filename: `lyricpro-<family>-<from>-<to>.csv`.

- [ ] **Step 4: Run to verify pass**

Run: `pnpm test:server server/vendor/vendorApi.test.ts` → 9 passed. `pnpm check` → clean.

- [ ] **Step 5: Commit**

```bash
git add server/vendor/vendorApi.ts server/vendor/vendorApi.test.ts
git commit -m "feat(vendor): REST handler core with envelopes, scopes, CSV"
```

---

### Task 6: Express glue + registration (`vendorRest.ts`)

**Files:**
- Create: `server/vendor/vendorRest.ts`
- Modify: `server/_core/index.ts` (after `express.json()` block ~line 140, BEFORE the tRPC middleware)

**Interfaces:**
- Consumes: Tasks 2+5; `getDb` from `server/db.ts`; `rateLimit` from `server/_core/rateLimit.ts`.
- Produces: `registerVendorRoutes(app: Express): void` mounting GET `/api/vendor/v1/meta`, GET `/api/vendor/v1/metrics/:family`, POST `/api/vendor/v1/reports`.

- [ ] **Step 1: Implement vendorRest.ts**

```typescript
// server/vendor/vendorRest.ts
// Express glue for the vendor REST API. All logic lives in vendorApi.ts /
// vendorAuth.ts (unit-tested); this file only wires auth, rate limiting,
// and response formatting.
import crypto from "node:crypto";
import type { Express, Request, Response } from "express";
import { getDb } from "../db";
import { rateLimit } from "../_core/rateLimit";
import { authenticateVendorKey, type VendorAuth } from "./vendorAuth";
import { handleMeta, handleMetrics, handleReports, type ApiResult } from "./vendorApi";

function fail(res: Response, status: number, error: string): void {
  res.status(status).json({ error, correlationId: crypto.randomUUID() });
}

function send(res: Response, r: ApiResult, wantCsv: boolean): void {
  if (wantCsv && r.csv) {
    res
      .status(r.status)
      .setHeader("Content-Type", "text/csv; charset=utf-8")
      .setHeader("Content-Disposition", `attachment; filename="${r.csv.filename}"`)
      .send(r.csv.content);
    return;
  }
  res.status(r.status).json(r.body);
}

type Handler = (db: NonNullable<Awaited<ReturnType<typeof getDb>>>, auth: VendorAuth, req: Request) => Promise<ApiResult>;

function route(handler: Handler) {
  return async (req: Request, res: Response): Promise<void> => {
    try {
      const db = await getDb();
      if (!db) return fail(res, 503, "service_unavailable");
      const auth = await authenticateVendorKey(db, req.headers.authorization);
      if (!auth) return fail(res, 401, "invalid_api_key");
      try {
        // In-process token bucket (best-effort on serverless — Upstash swap is
        // a recorded follow-up). 120 requests/min per key.
        rateLimit("vendor.api", auth.keyId, { max: 120, windowMs: 60_000 });
      } catch {
        return fail(res, 429, "rate_limited");
      }
      const result = await handler(db, auth, req);
      send(res, result, req.query.format === "csv" || (req.body as { format?: string } | undefined)?.format === "csv");
    } catch (err) {
      console.error("[vendor-api] unhandled:", err);
      fail(res, 500, "internal_error");
    }
  };
}

export function registerVendorRoutes(app: Express): void {
  app.get("/api/vendor/v1/meta", route((db, auth) => handleMeta(db, auth)));
  app.get("/api/vendor/v1/metrics/:family", route((db, auth, req) =>
    handleMetrics(db, auth, req.params.family ?? "", req.query as Record<string, unknown>)));
  app.post("/api/vendor/v1/reports", route((db, auth, req) => handleReports(db, auth, req.body)));
}
```

Check `server/_core/rateLimit.ts`'s failure signaling first: if it THROWS on limit (see the auth.sendMagicLink call sites — they rely on the throw propagating as a TRPCError or plain error), the try/catch above is correct; if it returns a boolean, adapt to `if (!rateLimit(...)) return fail(res, 429, "rate_limited")` and note the deviation in your report.

- [ ] **Step 2: Register in server/_core/index.ts**

After the `express.json()` / `express.urlencoded()` lines and BEFORE the `/api/trpc` middleware, add:

```typescript
import { registerVendorRoutes } from "../vendor/vendorRest";
// …
registerVendorRoutes(app);
```

(import at top with the other local imports; call in the setup sequence. Helmet already strips `x-powered-by`.)

- [ ] **Step 3: Typecheck + full server suite**

Run: `pnpm check` → clean. `pnpm test:server` → all pass (no new tests here; glue is covered by Task 9's live smoke).

- [ ] **Step 4: Commit**

```bash
git add server/vendor/vendorRest.ts server/_core/index.ts
git commit -m "feat(vendor): mount /api/vendor/v1 REST routes with key auth + rate limiting"
```

---

### Task 7: Admin router (`adminVendors.ts`, TDD) + audit + registration

**Files:**
- Create: `server/routers/adminVendors.ts`
- Test: `server/routers/adminVendors.test.ts`
- Modify: `server/_core/audit.ts` (additive union extension), `server/app-router.ts` (register router)

**Interfaces:**
- Consumes: Task 1 tables, Task 2 `generateApiKey`; `adminProcedure` from `server/_core/trpc.ts`; `recordAdminAction` from `server/_core/audit.ts`; drizzle `getDb`.
- Produces tRPC router `adminVendorsRouter` with procedures:
  - `list()` → vendors + member emails + key summaries (prefix/last4/lastUsedAt/revokedAt)
  - `create({ name, contactEmail? })` → vendor row
  - `update({ id, name?, contactEmail?, status?, scopeGrowth?, scopeEngagement?, scopeContent?, scopeMonetization?, catalogFilter? })` → vendor row
  - `linkMember({ vendorId, email })` → `{ userId }` (existing user only; NOT_FOUND with message "No account with that email — ask them to sign up first" if absent; BAD_REQUEST if user is an admin; sets role to `vendor` when currently `user`)
  - `unlinkMember({ vendorId, userId })` → `{ ok: true }` (removes membership; resets role to `user` if it was `vendor`)
  - `issueKey({ vendorId, label })` → `{ id, plaintext, prefix, last4 }` — the ONLY time plaintext leaves the server; BAD_REQUEST "Vendor already has 2 active keys — revoke one first" when 2 active
  - `revokeKey({ keyId })` → `{ ok: true }` (sets revoked_at; idempotent)
- Audit actions (extend `server/_core/audit.ts` unions additively — exact strings): `"vendor.create" | "vendor.update" | "vendor.linkMember" | "vendor.unlinkMember" | "vendor.issueKey" | "vendor.revokeKey"`, target type `"vendor"`. Every mutation records an audit row inside a `db.transaction` with the write (follow `server/routers/adminUsage.ts:120-128` usage pattern). NEVER put plaintext or hash in audit payload — only `{ keyId, prefix, last4 }`.

- [ ] **Step 1: Write the failing test** — use the drizzle-style fake-db from `server/songSelection.test.ts` where select-chains are needed; for mutations prefer testing the exported pure guard helpers. To keep this tractable, structure adminVendors.ts with two exported pure helpers and unit-test THOSE (the tRPC procedures are thin):

```typescript
// server/routers/adminVendors.test.ts
import { describe, expect, it } from "vitest";
import { activeKeyLimitReached, memberLinkDecision } from "./adminVendors";

describe("activeKeyLimitReached", () => {
  it("false below 2 active keys", () => {
    expect(activeKeyLimitReached([{ revokedAt: null }, { revokedAt: new Date() }])).toBe(false);
  });
  it("true at 2 active keys", () => {
    expect(activeKeyLimitReached([{ revokedAt: null }, { revokedAt: null }])).toBe(true);
  });
});

describe("memberLinkDecision", () => {
  it("rejects missing user", () => {
    expect(memberLinkDecision(null)).toEqual({ ok: false, code: "NOT_FOUND" });
  });
  it("rejects admins", () => {
    expect(memberLinkDecision({ id: 1, role: "admin" })).toEqual({ ok: false, code: "BAD_REQUEST" });
  });
  it("accepts users, notes role change", () => {
    expect(memberLinkDecision({ id: 1, role: "user" })).toEqual({ ok: true, setRole: true });
  });
  it("accepts existing vendors without role change", () => {
    expect(memberLinkDecision({ id: 1, role: "vendor" })).toEqual({ ok: true, setRole: false });
  });
});
```

- [ ] **Step 2: Run to verify failure** → module not found.

- [ ] **Step 3: Implement adminVendors.ts**

Full router per the Produces contract. Exported helpers:

```typescript
export function activeKeyLimitReached(keys: { revokedAt: Date | null }[]): boolean {
  return keys.filter((k) => k.revokedAt === null).length >= 2;
}

export function memberLinkDecision(
  user: { id: number; role: string } | null,
): { ok: false; code: "NOT_FOUND" | "BAD_REQUEST" } | { ok: true; setRole: boolean } {
  if (!user) return { ok: false, code: "NOT_FOUND" };
  if (user.role === "admin") return { ok: false, code: "BAD_REQUEST" };
  return { ok: true, setRole: user.role !== "vendor" };
}
```

Procedures use `getDb()` + drizzle (`db.select().from(vendors)…`, `db.insert(vendorApiKeys).values(…).returning()`, etc. — mirror `server/routers/adminGenres.ts` style), zod inputs mirroring the Interfaces block (`catalogFilter: z.object({ songIds: z.array(z.number().int()).max(500).optional(), artists: z.array(z.string().min(1).max(256)).max(100).optional() }).nullable().optional()`), `TRPCError` codes as specified, `recordAdminAction` on every mutation. Extend audit.ts unions additively (find the `AdminAction`/`AdminTargetType` type unions and append the six vendor strings + "vendor" target — additive only, per the curated-contests precedent).

- [ ] **Step 4: Register in app-router.ts**

```typescript
import { adminVendorsRouter } from "./routers/adminVendors";
// … inside appRouter:
  adminVendors: adminVendorsRouter,
```

- [ ] **Step 5: Run tests + typecheck, commit**

Run: `pnpm test:server server/routers/adminVendors.test.ts` → 6 passed. `pnpm check` → clean.

```bash
git add server/routers/adminVendors.ts server/routers/adminVendors.test.ts server/_core/audit.ts server/app-router.ts
git commit -m "feat(admin): vendors CRUD/members/keys router with audit"
```

---

### Task 8: Admin Vendors tab (UI)

**Files:**
- Create: `client/src/pages/admin/tabs/VendorsTab.tsx`
- Modify: `client/src/pages/AdminDashboard.tsx` (import + TabsTrigger `value="vendors"` labeled "Vendors" + TabsContent)

**Interfaces:**
- Consumes: `trpc.adminVendors.*` hooks (Task 7), `sonner` toast, lucide-react outline icons only (NO emoji — hard project rule), existing Tabs components in AdminDashboard.

- [ ] **Step 1: Implement VendorsTab.tsx**

Follow `client/src/pages/admin/tabs/GenresTab.tsx` structure (query + mutations + refetch pattern). Required UI behaviors (implement all; layout may follow GenresTab's tables/forms):

1. Vendor list: name, status, contact, 4 scope checkboxes (instant `update.mutate` on toggle), created date. "New vendor" inline form (name + contact email) → `create.mutate`.
2. Per-vendor expandable detail:
   - Members: list (email), "Add member by email" input → `linkMember.mutate`; on `NOT_FOUND` show `toast.error(err.message)`. Remove button → `unlinkMember.mutate`.
   - Keys: list prefix…last4, label, created, lastUsedAt, revoked badge; "Issue key" (label input) → on success open a modal showing `plaintext` ONCE with a copy button (lucide `Copy` icon) and the warning "This key is shown only once — store it now."; Revoke button with `window.confirm`.
   - Catalog filter: textarea accepting JSON `{"songIds":[…],"artists":[…]}`; validate with `JSON.parse` in a try/catch → `update.mutate({ catalogFilter })`; "Clear" sets null.
3. All mutations: `onSuccess: () => { refetch(); toast.success("Saved"); }`, `onError: (e) => toast.error(e.message)`.

State for the show-once modal: `const [freshKey, setFreshKey] = useState<{ plaintext: string; prefix: string } | null>(null)` — render a fixed overlay when set; clear on dismiss; NEVER store it elsewhere.

- [ ] **Step 2: Register the tab in AdminDashboard.tsx**

Add `import VendorsTab from "./admin/tabs/VendorsTab";` (match the existing tab import style/path), a `<TabsTrigger value="vendors">Vendors</TabsTrigger>` after the existing triggers, and `<TabsContent value="vendors"><VendorsTab /></TabsContent>` alongside the others.

- [ ] **Step 3: Verify**

Run: `pnpm check` → clean. Run: `pnpm exec vite build` → client builds clean.

- [ ] **Step 4: Commit**

```bash
git add client/src/pages/admin/tabs/VendorsTab.tsx client/src/pages/AdminDashboard.tsx
git commit -m "feat(admin-ui): Vendors tab — vendors, members, scopes, show-once keys"
```

---

### Task 9: Live E2E smoke + security pass + follow-ups

**Files:**
- Create: `scripts/smoke-vendor-api.mjs`
- Modify: `todo.md`

- [ ] **Step 1: Write the smoke script**

```javascript
// scripts/smoke-vendor-api.mjs
// E2E smoke for /api/vendor/v1 against a locally running dev server
// (pnpm dev) which talks to the shared DB. Seeds a throwaway vendor + key,
// exercises auth/scope/data paths, then deletes the seed rows.
// Usage: node scripts/smoke-vendor-api.mjs [--base http://localhost:3000]
import crypto from "node:crypto";
import postgres from "postgres";
import dotenv from "dotenv";

dotenv.config();
const BASE = (() => { const i = process.argv.indexOf("--base"); return i >= 0 ? process.argv[i + 1] : "http://localhost:3000"; })();
const DB_URL = process.env.SUPABASE_SESSION_POOLER_STRING ?? process.env.DATABASE_URL;
if (!DB_URL) { console.error("Set SUPABASE_SESSION_POOLER_STRING in .env"); process.exit(1); }

const ALPHABET = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789";
let secret = ""; for (let i = 0; i < 40; i++) secret += ALPHABET[crypto.randomInt(62)];
const KEY = `lp_live_${secret}`;
const HASH = crypto.createHash("sha256").update(KEY).digest("hex");

const sql = postgres(DB_URL, { max: 1, prepare: false });
let vendorId, keyId, failures = 0;
const check = (name, cond, extra = "") => { console.log(`${cond ? "PASS" : "FAIL"} ${name}${extra ? " — " + extra : ""}`); if (!cond) failures++; };

try {
  [{ id: vendorId }] = await sql`
    INSERT INTO vendors (name, status, scope_growth, scope_content)
    VALUES ('__smoke_test__', 'active', true, true) RETURNING id`;
  [{ id: keyId }] = await sql`
    INSERT INTO vendor_api_keys (vendor_id, label, key_prefix, last4, key_hash)
    VALUES (${vendorId}, 'smoke', ${KEY.slice(0, 12)}, ${KEY.slice(-4)}, ${HASH}) RETURNING id`;

  const get = (path, key = KEY) => fetch(`${BASE}${path}`, { headers: key ? { Authorization: `Bearer ${key}` } : {} });

  let r = await get("/api/vendor/v1/meta");
  check("meta 200", r.status === 200);
  const meta = await r.json();
  check("meta scopes", JSON.stringify((meta.data?.scopes ?? []).sort()) === '["content","growth"]', JSON.stringify(meta.data?.scopes));
  check("meta has definitions", Array.isArray(meta.meta?.definitions?.notes));

  r = await get("/api/vendor/v1/metrics/growth?from=2026-06-01&to=2026-07-01");
  check("growth 200", r.status === 200);
  const growth = await r.json();
  check("growth has data rows", Array.isArray(growth.data) && growth.data.length > 0, `rows=${growth.data?.length}`);

  r = await get("/api/vendor/v1/metrics/monetization?from=2026-06-01&to=2026-07-01");
  check("unscoped family 403", r.status === 403, `got ${r.status}`);

  r = await get("/api/vendor/v1/metrics/growth?from=2026-06-01&to=2026-07-01", "lp_live_" + "x".repeat(40));
  check("bad key 401", r.status === 401);
  check("bad key uniform body", (await r.json()).error === "invalid_api_key");

  r = await get("/api/vendor/v1/metrics/growth?from=2026-06-01&to=2026-07-01", null);
  check("no key 401", r.status === 401);

  r = await get("/api/vendor/v1/metrics/growth?from=2026-06-01&to=2026-07-01&format=csv");
  check("csv content-type", (r.headers.get("content-type") ?? "").includes("text/csv"));

  r = await fetch(`${BASE}/api/vendor/v1/reports`, {
    method: "POST",
    headers: { Authorization: `Bearer ${KEY}`, "Content-Type": "application/json" },
    body: JSON.stringify({ reports: ["growth", "content"], from: "2026-06-01", to: "2026-07-01" }),
  });
  check("reports 200", r.status === 200);
  const rep = await r.json();
  check("reports families", "growth" in (rep.data ?? {}) && "content" in (rep.data ?? {}));

  await sql`UPDATE vendor_api_keys SET revoked_at = now() WHERE id = ${keyId}`;
  r = await get("/api/vendor/v1/meta");
  check("revoked key 401", r.status === 401);
} finally {
  if (vendorId) await sql`DELETE FROM vendors WHERE id = ${vendorId}`; // cascades members/keys/usage
  await sql.end();
}
console.log(failures === 0 ? "SMOKE PASS" : `SMOKE FAIL (${failures})`);
process.exitCode = failures === 0 ? 0 : 1;
```

- [ ] **Step 2: Run the smoke**

Start the dev server in the background (`pnpm dev`, wait for it to listen — check the port it logs; pass `--base` accordingly). Run: `node scripts/smoke-vendor-api.mjs` → `SMOKE PASS`, exit 0. Stop the dev server. If any FAIL line appears, STOP and report BLOCKED with the output — do not tweak assertions to pass.

- [ ] **Step 3: Security checklist (record results in report)**

- Uniform 401 verified by smoke (bad/missing/revoked all identical body shape).
- `git log -p <task1-base>..HEAD | grep -icE "postgres(ql)?://|sk_live|whsec|lp_live_[A-Za-z0-9]{40}"` → 0 (no real keys/DSNs committed; the regex in test files uses `"a".repeat(40)` precisely to avoid this).
- Confirm admin router never returns `keyHash` or plaintext outside `issueKey` response: `grep -n "keyHash\|plaintext" server/routers/adminVendors.ts` and eyeball.
- Confirm vendor responses contain no PII fields (smoke's meta/growth bodies are aggregate-only).

- [ ] **Step 4: Update todo.md**

Append to the "Vendor KPI Phase 1 follow-ups" section (retitle the header to "Vendor KPI follow-ups"):

```markdown
- [ ] Swap vendor API rate limiting to Upstash Redis (@upstash/ratelimit) before any untrusted/high-volume partner — in-process buckets reset per serverless instance (decision 2026-07-05: ship in-process first)
- [ ] Raise VENDOR_KPI_MIN_COHORT from 10 toward 50 as traffic grows (disclosed in /v1/meta definitions)
- [ ] Vendor member invite flow for emails without accounts (v1 links existing users only)
- [ ] Phase 3: /vendor dashboard UI (vendorProcedure + tRPC vendorRouter over the same kpiQueries layer)
```

- [ ] **Step 5: Commit**

```bash
git add scripts/smoke-vendor-api.mjs todo.md
git commit -m "test(vendor): live E2E smoke for /api/vendor/v1 + follow-ups"
```
