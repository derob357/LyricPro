import { describe, it, expect } from "vitest";
import { isSubmitAccepted } from "./routers/matchEngine";
describe("isSubmitAccepted", () => {
  const base = { phase: "in_question", deadlineMs: 1000, graceMs: 500 };
  it("accepts before deadline", () => expect(isSubmitAccepted({ ...base, nowMs: 900 })).toBe(true));
  it("accepts within grace", () => expect(isSubmitAccepted({ ...base, nowMs: 1400 })).toBe(true));
  it("rejects past grace", () => expect(isSubmitAccepted({ ...base, nowMs: 1600 })).toBe(false));
  it("rejects wrong phase", () => expect(isSubmitAccepted({ ...base, phase: "intermission", nowMs: 900 })).toBe(false));
});
