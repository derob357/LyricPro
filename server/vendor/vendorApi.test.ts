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
  it("400 invalid_params for bad granularity (distinct from invalid_range)", async () => {
    const r = await handleMetrics(makeFakeDb([]) as never, AUTH, "growth", { ...Q, granularity: "hourly" });
    expect(r.status).toBe(400);
    expect((r.body as { error: string }).error).toBe("invalid_params");
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
  it("flattens nested Record<string, Cell> breakdowns", () => {
    const csv = toCsv([
      { bucket: "2026-07-01", gnSpentByKind: { spend_hint: { value: 500, suppressed: false }, spend_tournament: { value: null, suppressed: true } } },
      { bucket: "2026-07-02", gnSpentByKind: { spend_hint: { value: 200, suppressed: false } } },
    ]);
    const lines = csv.split("\n");
    expect(lines[0]).toBe("bucket,gnSpentByKind_spend_hint,gnSpentByKind_spend_hint_suppressed,gnSpentByKind_spend_tournament,gnSpentByKind_spend_tournament_suppressed");
    expect(lines[1]).toBe("2026-07-01,500,false,,true");
    expect(lines[2]).toBe("2026-07-02,200,false,,");
  });
});
