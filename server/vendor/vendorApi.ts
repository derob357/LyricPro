// server/vendor/vendorApi.ts
// Pure REST handlers for the vendor KPI API.  Each function is framework-agnostic:
// it receives typed arguments and returns an ApiResult, allowing the actual HTTP
// router to stay thin.  Validation is via zod; no DB types leak into the public
// interface (the Db alias is kept module-private to match the pattern used in
// vendorAuth / kpiQueries).
import crypto from "node:crypto";
import { z } from "zod";
import type { VendorAuth } from "./vendorAuth";
import {
  getDateRange,
  getGrowth,
  getEngagement,
  getContent,
  getMonetization,
  type Range,
} from "./kpiQueries";
import { KPI_DEFINITIONS, definitionNotes } from "./kpiDefinitions";
import type { getDb } from "../db";

type Db = NonNullable<Awaited<ReturnType<typeof getDb>>>;

// ---------------------------------------------------------------------------
// Public contract
// ---------------------------------------------------------------------------

export type ApiResult = {
  status: number;
  body: unknown;
  csv?: { filename: string; content: string };
};

// ---------------------------------------------------------------------------
// CSV helpers (csvEscape mirrors server/routers/adminActions.ts:119-124)
// ---------------------------------------------------------------------------

function csvEscape(s: string): string {
  if (s.includes(",") || s.includes('"') || s.includes("\n")) {
    return `"${s.replace(/"/g, '""')}"`;
  }
  return s;
}

function isCell(v: unknown): v is { value: number | null; suppressed: boolean } {
  return (
    typeof v === "object" &&
    v !== null &&
    "value" in v &&
    "suppressed" in v &&
    typeof (v as Record<string, unknown>).suppressed === "boolean"
  );
}

/**
 * Convert an array of row objects to a CSV string.
 * Cell objects ({ value, suppressed }) are expanded into two columns:
 *   <key>  and  <key>_suppressed.
 * Suppressed or null values emit an empty string for the value column.
 * All values go through csvEscape.
 */
export function toCsv(rows: Record<string, unknown>[]): string {
  if (rows.length === 0) return "";
  const firstRow = rows[0]!;

  // Determine columns from the first row
  const columns: Array<{ key: string; cell: boolean }> = Object.keys(firstRow).map((key) => ({
    key,
    cell: isCell(firstRow[key]),
  }));

  const header = columns
    .flatMap((col) => (col.cell ? [col.key, `${col.key}_suppressed`] : [col.key]))
    .join(",");

  const lines = rows.map((row) =>
    columns
      .flatMap((col) => {
        const v = row[col.key];
        if (col.cell) {
          const c = v as { value: number | null; suppressed: boolean };
          const valStr = c.value === null ? "" : String(c.value);
          return [csvEscape(valStr), csvEscape(String(c.suppressed))];
        }
        return [csvEscape(String(v ?? ""))];
      })
      .join(","),
  );

  return [header, ...lines].join("\n");
}

// ---------------------------------------------------------------------------
// Family / scope constants
// ---------------------------------------------------------------------------

const VALID_FAMILIES = new Set(["growth", "engagement", "content", "monetization"]);

const FAMILY_METRICS: Record<string, string[]> = {
  growth: ["dau", "wau", "mau", "stickiness", "new_users", "new_guests", "guest_conversions"],
  engagement: ["sessions", "avg_session_seconds", "rounds", "rounds_per_session", "retention"],
  content: ["displays", "correct_rate", "avg_response_seconds"],
  monetization: [
    "gn_purchased",
    "gn_spent",
    "addon_revenue_usd",
    "entry_fee_revenue_usd",
    "prizes_paid_usd",
    "active_subscriptions",
    "arpdau",
  ],
};

const ALL_FAMILIES = ["growth", "engagement", "content", "monetization"] as const;

function hasScope(auth: VendorAuth, family: string): boolean {
  const scopeMap: Record<string, boolean> = {
    growth: auth.vendor.scopeGrowth,
    engagement: auth.vendor.scopeEngagement,
    content: auth.vendor.scopeContent,
    monetization: auth.vendor.scopeMonetization,
  };
  return scopeMap[family] === true;
}

// ---------------------------------------------------------------------------
// Validation schemas
// ---------------------------------------------------------------------------

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const MAX_SPAN_MS = 400 * 24 * 60 * 60 * 1000;

function spanMs(from: string, to: string): number {
  const parts = (s: string) => s.split("-").map(Number) as [number, number, number];
  const [fy, fm, fd] = parts(from);
  const [ty, tm, td] = parts(to);
  return Date.UTC(ty, tm - 1, td) - Date.UTC(fy, fm - 1, fd);
}

const querySchema = z
  .object({
    from: z.string().regex(DATE_RE),
    to: z.string().regex(DATE_RE),
    granularity: z.enum(["day", "week", "month"]).default("day"),
    format: z.string().optional(),
    dimension: z.enum(["song", "genre", "decade"]).default("song"),
    limit: z.coerce.number().int().min(1).max(200).default(50),
  })
  .refine((d) => d.from <= d.to, { message: "invalid_range" })
  .refine((d) => spanMs(d.from, d.to) <= MAX_SPAN_MS, { message: "invalid_range" });

const reportsBodySchema = z
  .object({
    from: z.string().regex(DATE_RE),
    to: z.string().regex(DATE_RE),
    granularity: z.enum(["day", "week", "month"]).default("day"),
    reports: z.array(z.string()),
  })
  .refine((d) => d.from <= d.to, { message: "invalid_range" })
  .refine((d) => spanMs(d.from, d.to) <= MAX_SPAN_MS, { message: "invalid_range" });

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

function err(status: number, code: string): ApiResult {
  return { status, body: { error: code, correlationId: crypto.randomUUID() } };
}

function buildDefinitions(
  families: readonly string[],
): { metrics: Record<string, string>; notes: string[] } {
  const metricKeys = families.flatMap((f) => FAMILY_METRICS[f] ?? []);
  const metrics: Record<string, string> = {};
  for (const key of metricKeys) {
    const def = KPI_DEFINITIONS[key];
    if (def !== undefined) metrics[key] = def;
  }
  return { metrics, notes: definitionNotes() };
}

function makeEnvelope(
  auth: VendorAuth,
  range: { from: string; to: string; granularity: string },
  families: readonly string[],
  data: unknown,
): unknown {
  return {
    meta: {
      vendor: auth.vendor.name,
      range,
      generatedAt: new Date().toISOString(),
      definitions: buildDefinitions(families),
    },
    data,
  };
}

async function dispatchFamily(
  db: Db,
  family: string,
  range: Range,
  auth: VendorAuth,
): Promise<unknown> {
  if (family === "growth") return getGrowth(db, range);
  if (family === "engagement") return getEngagement(db, range);
  if (family === "content")
    return getContent(db, {
      ...range,
      dimension: "song",
      limit: 50,
      catalogFilter: auth.vendor.catalogFilter,
    });
  // monetization
  return getMonetization(db, range);
}

// ---------------------------------------------------------------------------
// Public handlers
// ---------------------------------------------------------------------------

export async function handleMeta(db: Db, auth: VendorAuth): Promise<ApiResult> {
  const dateRange = await getDateRange(db);
  const scopes = ALL_FAMILIES.filter((f) => hasScope(auth, f));
  return {
    status: 200,
    body: {
      meta: {
        vendor: auth.vendor.name,
        generatedAt: new Date().toISOString(),
        definitions: buildDefinitions(scopes),
      },
      data: { scopes, dateRange },
    },
  };
}

export async function handleMetrics(
  db: Db,
  auth: VendorAuth,
  family: string,
  query: Record<string, unknown>,
): Promise<ApiResult> {
  if (!VALID_FAMILIES.has(family)) return err(404, "not_found");
  if (!hasScope(auth, family)) return err(403, "scope_not_granted");

  const parsed = querySchema.safeParse(query);
  if (!parsed.success) return err(400, "invalid_range");

  const { from, to, granularity, format, dimension, limit } = parsed.data;
  const range: Range = { from, to, granularity };

  let data: unknown;
  if (family === "growth") {
    data = await getGrowth(db, range);
  } else if (family === "engagement") {
    data = await getEngagement(db, range);
  } else if (family === "content") {
    data = await getContent(db, { ...range, dimension, limit, catalogFilter: auth.vendor.catalogFilter });
  } else {
    data = await getMonetization(db, range);
  }

  const body = makeEnvelope(auth, range, [family], data);

  if (format === "csv") {
    const csvRows =
      family === "engagement"
        ? (data as { series: Record<string, unknown>[] }).series
        : (data as unknown as Record<string, unknown>[]);
    return {
      status: 200,
      body,
      csv: {
        filename: `lyricpro-${family}-${from}-${to}.csv`,
        content: toCsv(csvRows),
      },
    };
  }

  return { status: 200, body };
}

export async function handleReports(
  db: Db,
  auth: VendorAuth,
  rawBody: unknown,
): Promise<ApiResult> {
  const parsed = reportsBodySchema.safeParse(rawBody);
  if (!parsed.success) return err(400, "invalid_request");

  const { reports, from, to, granularity } = parsed.data;
  const range: Range = { from, to, granularity };

  // Per-family scope enforcement — unscoped requested family → 403, not silent omission
  for (const family of reports) {
    if (!VALID_FAMILIES.has(family)) return err(404, "not_found");
    if (!hasScope(auth, family)) return err(403, "scope_not_granted");
  }

  const data: Record<string, unknown> = {};
  for (const family of reports) {
    data[family] = await dispatchFamily(db, family, range, auth);
  }

  return {
    status: 200,
    body: makeEnvelope(auth, range, reports, data),
  };
}
