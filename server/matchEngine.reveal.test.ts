import { describe, it, expect } from "vitest";
import { canReveal } from "./routers/matchEngine";
describe("canReveal", () => {
  it("true when all answered", () => expect(canReveal({ phase:"in_question", answeredCount:3, activeCount:3, nowMs:0, deadlineMs:9999 })).toBe(true));
  it("true when deadline passed", () => expect(canReveal({ phase:"in_question", answeredCount:1, activeCount:3, nowMs:10000, deadlineMs:9999 })).toBe(true));
  it("false when waiting + before deadline", () => expect(canReveal({ phase:"in_question", answeredCount:1, activeCount:3, nowMs:0, deadlineMs:9999 })).toBe(false));
  it("false in wrong phase", () => expect(canReveal({ phase:"intermission", answeredCount:3, activeCount:3, nowMs:0, deadlineMs:9999 })).toBe(false));
});
