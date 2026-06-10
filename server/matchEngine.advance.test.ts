import { describe, it, expect } from "vitest";
import { nextRoundDecision } from "./routers/matchEngine";
describe("nextRoundDecision", () => {
  const base = { nowMs: 10000, deadlineMs: 9999 };
  it("wait in wrong phase", () => expect(nextRoundDecision({ ...base, phase: "in_question", currentRound: 1, roundsTotal: 5 })).toBe("wait"));
  it("wait before deadline", () => expect(nextRoundDecision({ phase: "intermission", nowMs: 0, deadlineMs: 9999, currentRound: 1, roundsTotal: 5 })).toBe("wait"));
  it("next mid-match", () => expect(nextRoundDecision({ ...base, phase: "intermission", currentRound: 2, roundsTotal: 5 })).toBe("next"));
  it("complete on last round", () => expect(nextRoundDecision({ ...base, phase: "intermission", currentRound: 5, roundsTotal: 5 })).toBe("complete"));
});
