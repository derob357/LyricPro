import { describe, it, expect } from "vitest";
import { roundPhaseEnum } from "../drizzle/schema";

describe("round phase enum", () => {
  it("has the three engine phases", () => {
    expect(roundPhaseEnum.enumValues).toEqual(["in_question", "intermission", "complete"]);
  });
});
