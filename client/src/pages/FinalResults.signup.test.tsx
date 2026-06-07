import { describe, it, expect } from "vitest";
import { buildGuestSignupHref } from "./finalResultsSignup";

describe("buildGuestSignupHref", () => {
  it("pre-fills the captured email on the signup URL", () => {
    expect(buildGuestSignupHref("jamie@example.com"))
      .toBe("/signin?mode=signup&email=jamie%40example.com");
  });
  it("falls back to plain signup when no email", () => {
    expect(buildGuestSignupHref(null)).toBe("/signin?mode=signup");
    expect(buildGuestSignupHref("")).toBe("/signin?mode=signup");
  });
});
