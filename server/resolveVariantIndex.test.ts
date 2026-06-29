import { describe, expect, it } from "vitest";
import { resolveVariantIndex } from "./_core/customPack";

describe("resolveVariantIndex", () => {
  it("returns an in-range index as-is", () => {
    expect(resolveVariantIndex(2, 5)).toBe(2);
    expect(resolveVariantIndex(0, 1)).toBe(0);
  });

  it("returns 0 for out-of-range index", () => {
    expect(resolveVariantIndex(5, 3)).toBe(0);
    expect(resolveVariantIndex(-1, 3)).toBe(0);
    expect(resolveVariantIndex(1, 1)).toBe(0);
  });

  it("returns 0 for null", () => {
    expect(resolveVariantIndex(null, 3)).toBe(0);
  });

  it("returns 0 for undefined", () => {
    expect(resolveVariantIndex(undefined, 3)).toBe(0);
  });
});
