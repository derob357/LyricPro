import { describe, it, expect } from "vitest";
import { assessProfanity } from "./profanityFilter";

describe("assessProfanity", () => {
  it("returns clean for benign text", () => {
    const result = assessProfanity("hello world");
    expect(result.status).toBe("clean");
    expect(result.block).toBe(false);
  });

  it("flags explicit profanity and blocks", () => {
    const result = assessProfanity("you fucking suck");
    expect(result.status).toBe("flagged");
    expect(result.block).toBe(true);
    expect(result.reason).toBeTruthy();
  });

  it("flags leetspeak variants", () => {
    const result = assessProfanity("f*ck this");
    expect(result.status).toBe("flagged");
    expect(result.block).toBe(true);
  });

  it("does not over-flag normal music vocabulary (allowlist sanity)", () => {
    // Words that overlap with music topics — should NOT be flagged
    for (const phrase of ["hell yeah this song slaps", "damn fine track", "killer beat"]) {
      const result = assessProfanity(phrase);
      expect(result.status).toBe("clean");
    }
  });

  it("handles empty / whitespace input gracefully", () => {
    expect(assessProfanity("").status).toBe("clean");
    expect(assessProfanity("   ").status).toBe("clean");
  });
});
