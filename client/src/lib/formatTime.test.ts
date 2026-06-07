import { describe, it, expect } from "vitest";
import { formatMMSS } from "./formatTime";

describe("formatMMSS", () => {
  it("formats sub-minute as 0:SS with zero-pad", () => {
    expect(formatMMSS(30)).toBe("0:30");
    expect(formatMMSS(5)).toBe("0:05");
  });
  it("formats 90s as 1:30 (the new quick-play default)", () => {
    expect(formatMMSS(90)).toBe("1:30");
  });
  it("formats 60s as 1:00", () => {
    expect(formatMMSS(60)).toBe("1:00");
  });
  it("clamps negatives to 0:00", () => {
    expect(formatMMSS(-3)).toBe("0:00");
  });
});
