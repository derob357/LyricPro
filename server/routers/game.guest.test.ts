import { describe, it, expect } from "vitest";
import { deriveGuestNickname } from "./guestNickname";

describe("deriveGuestNickname", () => {
  it("uses the email local-part when nickname is absent", () => {
    expect(deriveGuestNickname(undefined, "Jamie.Lee@example.com")).toBe("Jamie.Lee");
  });
  it("prefers an explicit nickname", () => {
    expect(deriveGuestNickname("DJ Spin", "x@y.com")).toBe("DJ Spin");
  });
  it("falls back to 'Guest' when neither is usable", () => {
    expect(deriveGuestNickname(undefined, undefined)).toBe("Guest");
    expect(deriveGuestNickname("", "")).toBe("Guest");
  });
  it("truncates to 64 chars", () => {
    const long = "a".repeat(100) + "@example.com";
    expect(deriveGuestNickname(undefined, long).length).toBeLessThanOrEqual(64);
  });
  it("falls back to 'Guest' for an email with an empty local-part", () => {
    expect(deriveGuestNickname(undefined, "@example.com")).toBe("Guest");
  });
  it("does not split a surrogate pair when truncating", () => {
    // 64 emoji = 128 UTF-16 code units; code-point-safe slice keeps 64 whole emoji.
    const emoji = "😀".repeat(70);
    const out = deriveGuestNickname(emoji, undefined);
    expect([...out].length).toBe(64);
    // No lone surrogate left dangling at the end.
    expect(out.endsWith("😀")).toBe(true);
  });
});
