import { describe, it, expect } from "vitest";
import { matchEngineRouter } from "./routers/matchEngine";

describe("matchEngine router", () => {
  it("exposes getMatchState", () => {
    expect(matchEngineRouter._def.procedures.getMatchState).toBeTruthy();
  });
});
