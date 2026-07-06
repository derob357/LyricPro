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
