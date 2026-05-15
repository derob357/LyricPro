import { describe, it, expect, vi } from "vitest";

vi.mock("stripe", () => {
  const Stripe = vi.fn().mockImplementation(() => ({
    checkout: { sessions: { create: vi.fn() } },
    webhooks: { constructEvent: vi.fn() },
    subscriptions: { retrieve: vi.fn() },
    customers: { search: vi.fn().mockResolvedValue({ data: [] }) },
  }));
  return { default: Stripe };
});

import { appRouter } from "./app-router";

const DB_URL =
  process.env.SUPABASE_SESSION_POOLER_STRING ??
  process.env.SUPABASE_DIRECT_CONNECTION_STRING ??
  process.env.DATABASE_URL;
const liveDescribe = DB_URL ? describe : describe.skip;

function makeAdminCaller(label: string) {
  return appRouter.createCaller({
    user: { id: 1, role: "admin", email: "admin@test" } as any,
    req: {} as any, res: {} as any,
    ip: "10.0.0.5", userAgent: "vitest",
    requestId: `vitest-${label}-${Date.now()}-${Math.random().toString(36).slice(2,8)}`,
    countryCode: "US",
  });
}

liveDescribe("admin.usage.availablePeriods", () => {
  it("returns periods in 'YYYY-MM' format", async () => {
    const caller = makeAdminCaller("usage-periods");
    const result = await caller.adminUsage.availablePeriods();
    expect(Array.isArray(result)).toBe(true);
    for (const r of result) {
      expect(r.period).toMatch(/^\d{4}-\d{2}$/);
    }
  });
});

liveDescribe("admin.usage.byLyric", () => {
  it("returns aggregated rows for a known period (variant aggregation)", async () => {
    const caller = makeAdminCaller("usage-byLyric");
    const periods = await caller.adminUsage.availablePeriods();
    if (periods.length === 0) return; // no data — skip
    const result = await caller.adminUsage.byLyric({
      period: periods[0].period,
      aggregation: "variant",
    });
    expect(Array.isArray(result.rows)).toBe(true);
    if (result.rows.length > 0) {
      const r = result.rows[0];
      expect(r).toEqual(expect.objectContaining({
        songId: expect.any(Number),
        variantIndex: expect.any(Number),
        title: expect.any(String),
        artist: expect.any(String),
        playCount: expect.any(Number),
      }));
    }
  });

  it("aggregation=song collapses across variants", async () => {
    const caller = makeAdminCaller("usage-byLyric-song");
    const periods = await caller.adminUsage.availablePeriods();
    if (periods.length === 0) return;
    const result = await caller.adminUsage.byLyric({
      period: periods[0].period,
      aggregation: "song",
    });
    expect(Array.isArray(result.rows)).toBe(true);
    for (const r of result.rows) {
      expect(r.variantIndex).toBeUndefined();
    }
  });
});

liveDescribe("admin.usage.exportCsv", () => {
  it("returns CSV with the expected header", async () => {
    const caller = makeAdminCaller("usage-export");
    const periods = await caller.adminUsage.availablePeriods();
    if (periods.length === 0) return;
    const r = await caller.adminUsage.exportCsv({
      period: periods[0].period,
      aggregation: "variant",
    });
    expect(typeof r.csv).toBe("string");
    expect(r.csv.startsWith("title,artist,variantIndex,plays,")).toBe(true);
    expect(r.rowCount).toEqual(expect.any(Number));
  });
});

liveDescribe("admin.usage.exportDdex", () => {
  it("returns a DDEX file with mainFile, filename, and lintIssues", async () => {
    const caller = makeAdminCaller("usage-ddex");
    const periods = await caller.adminUsage.availablePeriods();
    if (periods.length === 0) return; // no data — skip
    const r = await caller.adminUsage.exportDdex({
      period: periods[0].period,
      recipient: "TEST-PUBLISHER",
    });
    expect(typeof r.mainFile).toBe("string");
    expect(r.mainFile.startsWith("HEAD")).toBe(true);
    expect(r.filename).toMatch(/\.tsv$/);
    expect(Array.isArray(r.lintIssues)).toBe(true);
  });
});
