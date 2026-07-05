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
  it("falls back to 10 on empty string", () => {
    process.env.VENDOR_KPI_MIN_COHORT = "";
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
    const out = applyBreakdownSuppression([cell(100, 50), cell(5, 5), cell(3, 3)], 10);
    expect(out[0]!.suppressed).toBe(false);
    expect(out[1]!).toMatchObject({ value: null, suppressed: true });
    expect(out[2]!).toMatchObject({ value: null, suppressed: true });
  });
  it("when exactly one cell is suppressed, also suppresses the next-smallest (anti-differencing)", () => {
    const out = applyBreakdownSuppression([cell(100, 50), cell(30, 20), cell(5, 5)], 10);
    expect(out.filter((c) => c.suppressed)).toHaveLength(2);
    expect(out[1]!).toMatchObject({ value: null, suppressed: true }); // next-smallest by userCount
    expect(out[0]!.suppressed).toBe(false);
  });
  it("2-cell: also suppresses the remaining visible cell (anti-differencing)", () => {
    const out = applyBreakdownSuppression([cell(100, 50), cell(5, 5)], 10);
    expect(out.every((c) => c.suppressed)).toBe(true);
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
