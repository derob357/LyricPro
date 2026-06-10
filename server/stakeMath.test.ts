import { describe, it, expect } from "vitest";
import {
  computePoolDebit, resolveStakeOutcome, clampAnte,
  DEFAULT_ANTE, ANTE_STEP, ROUND_WIN_REWARD, ROUND_LOSS_BURN,
  WIN_THRESHOLD_CORRECT, SIGNUP_GRANT, STAKED_GAMES_PER_HOUR_CAP, ABANDON_HOURS,
} from "./_core/stakeMath";

describe("computePoolDebit", () => {
  it("purchased-first: drains purchased before touching earned", () => {
    expect(computePoolDebit(30, 100, 50, "purchased-first")).toEqual({ fromPurchased: 30, fromEarned: 20 });
  });
  it("purchased covers everything when sufficient", () => {
    expect(computePoolDebit(80, 100, 50, "purchased-first")).toEqual({ fromPurchased: 50, fromEarned: 0 });
  });
  it("earned-only never touches purchased", () => {
    expect(computePoolDebit(500, 60, 50, "earned-only")).toEqual({ fromPurchased: 0, fromEarned: 50 });
  });
  it("throws on insufficient total (purchased-first)", () => {
    expect(() => computePoolDebit(10, 10, 50, "purchased-first")).toThrow(/insufficient/i);
  });
  it("throws on insufficient earned (earned-only) even when purchased is plentiful", () => {
    expect(() => computePoolDebit(500, 20, 50, "earned-only")).toThrow(/insufficient/i);
  });
});

describe("resolveStakeOutcome", () => {
  const stake = { staked: 50, burned: 0 };
  it("won round (3 of 4 correct): +25 win, no burn", () => {
    expect(resolveStakeOutcome(stake, 3)).toEqual({ win: ROUND_WIN_REWARD, burn: 0 });
  });
  it("perfect round (4): also a win", () => {
    expect(resolveStakeOutcome(stake, 4)).toEqual({ win: 25, burn: 0 });
  });
  it("lost round (2 correct): burns 25 from remaining stake", () => {
    expect(resolveStakeOutcome(stake, 2)).toEqual({ win: 0, burn: ROUND_LOSS_BURN });
  });
  it("0 correct never pays and burns (anti-abuse D6)", () => {
    expect(resolveStakeOutcome(stake, 0)).toEqual({ win: 0, burn: 25 });
  });
  it("burn is capped by remaining stake", () => {
    expect(resolveStakeOutcome({ staked: 50, burned: 40 }, 1)).toEqual({ win: 0, burn: 10 });
  });
  it("exhausted stake burns nothing further", () => {
    expect(resolveStakeOutcome({ staked: 50, burned: 50 }, 0)).toEqual({ win: 0, burn: 0 });
  });
});

describe("clampAnte", () => {
  it("defaults to 50 when earned allows", () => expect(clampAnte(undefined, 200)).toBe(DEFAULT_ANTE));
  it("steps down to the largest multiple of 25 within earned", () => expect(clampAnte(undefined, 40)).toBe(25));
  it("zero earned → zero ante", () => expect(clampAnte(undefined, 0)).toBe(0));
  it("explicit ante is validated: multiple of step, ≤ earned, ≥ 0", () => {
    expect(clampAnte(75, 200)).toBe(75);
    expect(clampAnte(75, 60)).toBe(50);
    expect(clampAnte(-25, 200)).toBe(0);
    expect(clampAnte(30, 200)).toBe(25); // snaps down to step
  });
});
