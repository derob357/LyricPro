import { describe, expect, it, vi } from "vitest";
import { runKpiReconcile } from "./kpiReconcile";

function makeFakeDb(resultQueue: unknown[][]) {
  let call = 0;
  return {
    execute: vi.fn().mockImplementation(() => Promise.resolve(resultQueue[call++] ?? [])),
  };
}

describe("runKpiReconcile", () => {
  it("returns processed days and missing-day gaps", async () => {
    const db = makeFakeDb([
      [{ day: "2026-07-01", status: "success" }],
      [{ day: "2026-06-28" }],
    ]);

    const summary = await runKpiReconcile(db as never);

    expect(db.execute).toHaveBeenCalledTimes(2);
    expect(summary.processed).toEqual([{ day: "2026-07-01", status: "success" }]);
    expect(summary.missingLast7).toEqual(["2026-06-28"]);
  });

  it("returns empty arrays when nothing to do", async () => {
    const db = makeFakeDb([[], []]);

    const summary = await runKpiReconcile(db as never);

    expect(summary.processed).toEqual([]);
    expect(summary.missingLast7).toEqual([]);
  });
});
