// server/routers/adminVendors.test.ts
import { describe, expect, it } from "vitest";
import { activeKeyLimitReached, memberLinkDecision } from "./adminVendors";

describe("activeKeyLimitReached", () => {
  it("false below 2 active keys", () => {
    expect(activeKeyLimitReached([{ revokedAt: null }, { revokedAt: new Date() }])).toBe(false);
  });
  it("true at 2 active keys", () => {
    expect(activeKeyLimitReached([{ revokedAt: null }, { revokedAt: null }])).toBe(true);
  });
});

describe("memberLinkDecision", () => {
  it("rejects missing user", () => {
    expect(memberLinkDecision(null)).toEqual({ ok: false, code: "NOT_FOUND" });
  });
  it("rejects admins", () => {
    expect(memberLinkDecision({ id: 1, role: "admin" })).toEqual({ ok: false, code: "BAD_REQUEST" });
  });
  it("accepts users, notes role change", () => {
    expect(memberLinkDecision({ id: 1, role: "user" })).toEqual({ ok: true, setRole: true });
  });
  it("accepts existing vendors without role change", () => {
    expect(memberLinkDecision({ id: 1, role: "vendor" })).toEqual({ ok: true, setRole: false });
  });
});
