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

function isNestedRecord(
  v: unknown,
): v is Record<string, { value: number | null; suppressed: boolean }> {
  if (typeof v !== "object" || v === null || Array.isArray(v)) return false;
  const vals = Object.values(v as Record<string, unknown>);
  return vals.length > 0 && vals.every(isCell);
}

/**
 * Convert an array of row objects to a CSV string.
 * Cell objects ({ value, suppressed }) are expanded into two columns:
 *   <key>  and  <key>_suppressed.
 * Nested Record<string, Cell> objects (e.g. gnSpentByKind) are flattened to
 *   <key>_<kind>  and  <key>_<kind>_suppressed  for every kind found across
 *   ALL rows (pre-scan). Rows missing a kind emit two empty columns.
 * Kinds within a nested field are sorted alphabetically; field order follows
 * the first row's key order. Suppressed or null values emit an empty string.
 * All values pass through csvEscape.
 * Classification of nested vs plain is row-order-independent: a field is nested
 * if EVERY row's value is either undefined, {}, or Record<string,Cell>, AND
 * at least one row has a non-empty Record<string,Cell>.
 *
 * empty range → empty artifact; consumers should treat header-less empty CSV as no data
 */
export function toCsv(rows: Record<string, unknown>[]): string {
  if (rows.length === 0) return "";
  const firstRow = rows[0]!;

  type ColKind = "plain" | "cell" | "nested";
  type ColDef = { key: string; kind: ColKind; kinds?: string[] };

  // Helper: check if a value is an empty plain object (not a Cell, not nested record)
  function isEmptyPlainObject(v: unknown): boolean {
    return (
      typeof v === "object" &&
      v !== null &&
      !Array.isArray(v) &&
      !isCell(v) &&
      Object.keys(v).length === 0
    );
  }

  // Pre-scan ALL rows to classify fields as nested vs plain and collect kinds.
  // A field is nested if: (1) ALL rows' values are undefined, {}, or Record<string,Cell>,
  // AND (2) at least one row has a non-empty Record<string,Cell>.
  type FieldAnalysis = {
    canBeNested: boolean; // all values are undefined, {}, or Record<string,Cell>
    hasNestedRecord: boolean; // at least one non-empty Record<string,Cell>
  };
  const fieldAnalysis: Record<string, FieldAnalysis> = {};
  const kindSets: Record<string, Set<string>> = {};

  // Initialize analysis for all fields in the first row
  for (const key of Object.keys(firstRow)) {
    fieldAnalysis[key] = { canBeNested: true, hasNestedRecord: false };
  }

  // Scan all rows
  for (const row of rows) {
    for (const key of Object.keys(fieldAnalysis)) {
      const v = row[key];

      // Check what type of value this is
      if (v === undefined || isEmptyPlainObject(v)) {
        // undefined or {} — compatible with nested
        continue;
      } else if (isNestedRecord(v)) {
        // non-empty Record<string,Cell> — this field can be nested
        fieldAnalysis[key]!.hasNestedRecord = true;
        if (!kindSets[key]) kindSets[key] = new Set();
        for (const k of Object.keys(v)) kindSets[key]!.add(k);
      } else if (isCell(v)) {
        // A cell — this field is a plain cell, not nested
        fieldAnalysis[key]!.canBeNested = false;
      } else {
        // Some other type — field cannot be nested
        fieldAnalysis[key]!.canBeNested = false;
      }
    }
  }

  // Classify each field based on the analysis
  const cols: ColDef[] = Object.keys(firstRow).map((key) => {
    const v = firstRow[key];
    if (isCell(v)) return { key, kind: "cell" };

    const analysis = fieldAnalysis[key]!;
    if (analysis.canBeNested && analysis.hasNestedRecord) {
      return {
        key,
        kind: "nested",
        kinds: Array.from(kindSets[key] ?? new Set()).sort(),
      };
    }
    return { key, kind: "plain" };
  });

  // Build header: original field order, kinds sorted alphabetically within nested fields
  const header = cols
    .flatMap((col) => {
      if (col.kind === "cell") return [col.key, `${col.key}_suppressed`];
      if (col.kind === "nested")
        return col.kinds!.flatMap((k) => [`${col.key}_${k}`, `${col.key}_${k}_suppressed`]);
      return [col.key];
    })
    .join(",");

  const lines = rows.map((row) =>
    cols
      .flatMap((col) => {
        const v = row[col.key];
        if (col.kind === "cell") {
          const c = v as { value: number | null; suppressed: boolean };
          return [csvEscape(c.value === null ? "" : String(c.value)), csvEscape(String(c.suppressed))];
        }
        if (col.kind === "nested") {
          const record = isNestedRecord(v) ? v : {};
          return col.kinds!.flatMap((k) => {
            const cell = record[k];
            if (cell === undefined) return ["", ""];
            return [csvEscape(cell.value === null ? "" : String(cell.value)), csvEscape(String(cell.suppressed))];
          });
        }
        // Plain field: emit empty string for empty plain objects; otherwise convert to string
        if (isEmptyPlainObject(v)) {
          return [csvEscape("")];
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

export const SCOPE_MAP = {
  growth: "scopeGrowth",
  engagement: "scopeEngagement",
  content: "scopeContent",
  monetization: "scopeMonetization",
} as const satisfies Record<string, keyof VendorAuth["vendor"]>;

function hasScope(auth: VendorAuth, family: string): boolean {
  const key = SCOPE_MAP[family as keyof typeof SCOPE_MAP];
  if (key === undefined) return false;
  return auth.vendor[key] === true;
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

// DATE_RE only checks shape (\d{4}-\d{2}-\d{2}); it happily accepts calendar-
// invalid strings like "2026-13-45". Those pass regex + spanMs arithmetic but
// blow up as invalid dates once they hit Postgres. Round-trip through Date to
// reject them here instead.
export function isValidCalendarDate(s: string): boolean {
  const d = new Date(`${s}T00:00:00Z`);
  if (Number.isNaN(d.getTime())) return false;
  return d.toISOString().slice(0, 10) === s;
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
  .refine((d) => isValidCalendarDate(d.from) && isValidCalendarDate(d.to), { message: "invalid_range" })
  .refine((d) => d.from <= d.to, { message: "invalid_range" })
  .refine((d) => spanMs(d.from, d.to) <= MAX_SPAN_MS, { message: "invalid_range" });

const reportsBodySchema = z
  .object({
    from: z.string().regex(DATE_RE),
    to: z.string().regex(DATE_RE),
    granularity: z.enum(["day", "week", "month"]).default("day"),
    reports: z.array(z.string()).min(1).max(4),
  })
  .refine((d) => isValidCalendarDate(d.from) && isValidCalendarDate(d.to), { message: "invalid_range" })
  .refine((d) => d.from <= d.to, { message: "invalid_range" })
  .refine((d) => spanMs(d.from, d.to) <= MAX_SPAN_MS, { message: "invalid_range" });

// Validates only the date trio so handleMetrics / handleReports can return
// invalid_range for date errors before checking other params.
const dateOnlySchema = z
  .object({
    from: z.string().regex(DATE_RE),
    to: z.string().regex(DATE_RE),
  })
  .refine((d) => isValidCalendarDate(d.from) && isValidCalendarDate(d.to), { message: "invalid_range" })
  .refine((d) => d.from <= d.to, { message: "invalid_range" })
  .refine((d) => spanMs(d.from, d.to) <= MAX_SPAN_MS, { message: "invalid_range" });

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

function err(status: number, code: string): ApiResult {
  return { status, body: { error: code, correlationId: crypto.randomUUID() } };
}

export function buildDefinitions(
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

  // Validate dates first so date errors yield invalid_range; all other param
  // failures (bad granularity/dimension/limit) yield the distinct invalid_params.
  const dateParsed = dateOnlySchema.safeParse(query);
  if (!dateParsed.success) return err(400, "invalid_range");

  const parsed = querySchema.safeParse(query);
  if (!parsed.success) return err(400, "invalid_params");

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
  // Date errors get their own code; body-shape failures keep invalid_request.
  const dateParsed = dateOnlySchema.safeParse(rawBody);
  if (!dateParsed.success) return err(400, "invalid_range");

  const parsed = reportsBodySchema.safeParse(rawBody);
  if (!parsed.success) return err(400, "invalid_request");

  const { from, to, granularity } = parsed.data;
  const reports = Array.from(new Set(parsed.data.reports));
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
