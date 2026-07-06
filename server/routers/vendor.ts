// server/routers/vendor.ts
// Vendor-facing tRPC router for the /vendor dashboard. Reads the SAME
// kpiQueries layer as the REST API (and exportCsv literally reuses the REST
// handler) so dashboard and API numbers cannot drift.
import { TRPCError } from "@trpc/server";
import { z } from "zod";
import { sql, eq, desc } from "drizzle-orm";
import { router, vendorProcedure } from "../_core/trpc";
import { getContent, getDateRange, getEngagement, getGrowth, getMonetization } from "../vendor/kpiQueries";
import { handleMetrics, isValidCalendarDate, SCOPE_MAP, buildDefinitions } from "../vendor/vendorApi";
import { vendorApiKeys } from "../../drizzle/schema";
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

// Duplicated base fields (from/to/granularity) rather than deriving from
// rangeInput.sourceType() — zod v4's refine() return type does not expose a
// convenient shape-extension API for a already-refined ZodObject. Behavior
// (the two refines) is identical to rangeInput; only the construction differs.
const contentInput = z
  .object({
    from: dateStr,
    to: dateStr,
    granularity: z.enum(["day", "week", "month"]).default("day"),
    dimension: z.enum(["song", "genre", "decade"]).default("song"),
    limit: z.number().int().min(1).max(200).default(50),
  })
  .refine((r) => r.from <= r.to, "from must be <= to")
  .refine((r) => spanDays(r.from, r.to) <= 400, "range exceeds 400 days");

export const vendorRouter = router({
  me: vendorProcedure.query(async ({ ctx }) => ({
    vendorName: ctx.vendor.name,
    scopes: grantedScopes(ctx.vendor),
    dateRange: await getDateRange(ctx.db),
    definitions: buildDefinitions(grantedScopes(ctx.vendor)),
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
    .input(contentInput)
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
    const rows = await ctx.db
      .select({
        id: vendorApiKeys.id,
        label: vendorApiKeys.label,
        keyPrefix: vendorApiKeys.keyPrefix,
        last4: vendorApiKeys.last4,
        createdAt: vendorApiKeys.createdAt,
        lastUsedAt: vendorApiKeys.lastUsedAt,
        revokedAt: vendorApiKeys.revokedAt,
      })
      .from(vendorApiKeys)
      .where(eq(vendorApiKeys.vendorId, ctx.vendor.id))
      .orderBy(desc(vendorApiKeys.createdAt));
    return {
      vendorName: ctx.vendor.name,
      scopes: grantedScopes(ctx.vendor),
      baseUrl: "/api/vendor/v1" as const,
      keys: rows.map((k) => ({
        id: k.id,
        label: k.label,
        keyPrefix: k.keyPrefix,
        last4: k.last4,
        createdAt: k.createdAt.toISOString(),
        lastUsedAt: k.lastUsedAt?.toISOString() ?? null,
        revokedAt: k.revokedAt?.toISOString() ?? null,
      })),
    };
  }),
});
