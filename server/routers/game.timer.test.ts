import { describe, it, expect } from "vitest";
import { z } from "zod";

// Mirrors the createRoom timerSeconds rule. Keep in sync with game.ts.
const timerSecondsSchema = z.number().int().min(15).max(90).default(30);

describe("createRoom timerSeconds bounds", () => {
  it("accepts 90s (new quick-play default)", () => {
    expect(timerSecondsSchema.parse(90)).toBe(90);
  });
  it("still accepts 15s lower bound", () => {
    expect(timerSecondsSchema.parse(15)).toBe(15);
  });
  it("rejects above 90", () => {
    expect(() => timerSecondsSchema.parse(91)).toThrow();
  });
});
