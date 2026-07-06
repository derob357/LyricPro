// server/vendor/kpiQueries.test.ts
import { describe, expect, it, vi } from "vitest";
import { getContent, getEngagement, getGrowth, getMonetization } from "./kpiQueries";

function makeFakeDb(queue: unknown[][]) {
  let call = 0;
  return { execute: vi.fn().mockImplementation(() => Promise.resolve(queue[call++] ?? [])) };
}
const R = { from: "2026-07-01", to: "2026-07-02", granularity: "day" as const };
const m = (date: string, metric: string, value: number, user_count: number, dimension = "all", dimension_value = "all") =>
  ({ date, metric, dimension, dimension_value, value, user_count });

describe("getGrowth", () => {
  it("maps daily metric rows into per-bucket cells with suppression (k=10 default)", async () => {
    const db = makeFakeDb([[
      m("2026-07-01", "dau", 25, 25), m("2026-07-01", "mau", 60, 60), m("2026-07-01", "wau", 40, 40),
      m("2026-07-01", "new_users", 3, 3),
      m("2026-07-02", "dau", 5, 5), m("2026-07-02", "mau", 61, 61), m("2026-07-02", "wau", 41, 41),
    ]]);
    const rows = await getGrowth(db as never, R);
    expect(rows).toHaveLength(2);
    expect(rows[0]!.dau).toEqual({ value: 25, suppressed: false });
    expect(rows[0]!.newUsers).toEqual({ value: null, suppressed: true }); // 3 < 10
    expect(rows[1]!.dau).toEqual({ value: null, suppressed: true });      // 5 < 10
    expect(rows[1]!.mau).toEqual({ value: 61, suppressed: false });
  });
  it("weekly granularity averages dau and takes last-day mau", async () => {
    const db = makeFakeDb([[
      m("2026-06-29", "dau", 20, 20), m("2026-06-30", "dau", 30, 30),
      m("2026-06-29", "mau", 100, 100), m("2026-06-30", "mau", 110, 110),
    ]]);
    const rows = await getGrowth(db as never, { from: "2026-06-29", to: "2026-06-30", granularity: "week" });
    expect(rows).toHaveLength(1);
    expect(rows[0]!.bucket).toBe("2026-06-29");
    expect(rows[0]!.dau.value).toBe(25);   // avg(20,30)
    expect(rows[0]!.mau.value).toBe(110);  // last day
  });
});

describe("getContent (song dimension)", () => {
  it("computes correct_rate after summing and suppresses small rows", async () => {
    const db = makeFakeDb([[
      { key: "Song A — Artist A", displays: 100, rounds_played: 50, correct_rounds: 30, response_seconds_sum: 250, response_count: 50, user_count: 40 },
      { key: "Song B — Artist B", displays: 4, rounds_played: 2, correct_rounds: 1, response_seconds_sum: 9, response_count: 2, user_count: 2 },
    ]]);
    const rows = await getContent(db as never, { ...R, dimension: "song", limit: 50, catalogFilter: null });
    expect(rows[0]!.correctRate).toEqual({ value: 0.6, suppressed: false });
    expect(rows[0]!.avgResponseSeconds).toEqual({ value: 5, suppressed: false });
    expect(rows[1]!.displays).toEqual({ value: null, suppressed: true });
  });
  it("returns [] for genre dimension when a catalogFilter is set", async () => {
    const db = makeFakeDb([]);
    const rows = await getContent(db as never, { ...R, dimension: "genre", limit: 50, catalogFilter: { songIds: [1] } });
    expect(rows).toEqual([]);
    expect(db.execute).not.toHaveBeenCalled();
  });
});

describe("getEngagement", () => {
  it("computes avg session seconds from component metrics and retention rates", async () => {
    const db = makeFakeDb([
      [
        m("2026-07-01", "sessions", 30, 25),
        m("2026-07-01", "sessions_with_end", 20, 20),
        m("2026-07-01", "session_seconds_sum", 2400, 20),
        m("2026-07-01", "rounds", 90, 25),
      ],
      [{ cohort_date: "2026-06-30", day_offset: 1, cohort_size: 40, retained_count: 10 }],
    ]);
    const { series, retention } = await getEngagement(db as never, { ...R, to: "2026-07-01" });
    expect(series[0]!.avgSessionSeconds).toEqual({ value: 120, suppressed: false }); // 2400/20
    expect(series[0]!.sessions).toEqual({ value: 30, suppressed: false });
    expect(series[0]!.roundsPerSession).toEqual({ value: 3, suppressed: false });
    expect(retention[0]!.retainedRate).toEqual({ value: 0.25, suppressed: false });
    expect(retention[0]!.cohortSize).toEqual({ value: 40, suppressed: false });
  });
});

describe("getMonetization", () => {
  it("builds kind/tier breakdowns with complementary suppression and arpdau", async () => {
    const db = makeFakeDb([[
      m("2026-07-01", "dau", 20, 20),
      m("2026-07-01", "addon_revenue_usd", 100, 15),
      m("2026-07-01", "entry_fee_revenue_usd", 60, 12),
      m("2026-07-01", "gn_spent", 500, 30, "kind", "spend_hint"),
      m("2026-07-01", "gn_spent", 40, 4, "kind", "spend_tournament"),
      m("2026-07-01", "gn_spent", 200, 12, "kind", "spend_extra_game"),
    ]]);
    const rows = await getMonetization(db as never, { ...R, to: "2026-07-01" });
    expect(rows[0]!.arpdau).toEqual({ value: 8, suppressed: false }); // (100+60)/20
    const kinds = rows[0]!.gnSpentByKind;
    expect(kinds.spend_tournament).toEqual({ value: null, suppressed: true }); // 4 < 10
    // complementary: exactly one suppressed → next-smallest (spend_extra_game, uc 12) also suppressed
    expect(kinds.spend_extra_game).toEqual({ value: null, suppressed: true });
    expect(kinds.spend_hint!.suppressed).toBe(false);
  });

  it("suppresses arpdau when a revenue component feeding it is itself suppressed (anti-differencing)", async () => {
    const db = makeFakeDb([[
      m("2026-07-01", "dau", 200, 20),
      m("2026-07-01", "entry_fee_revenue_usd", 60, 12),
      m("2026-07-01", "addon_revenue_usd", 8, 4), // uc 4 < k=10 default → suppressed
    ]]);
    const rows = await getMonetization(db as never, { ...R, to: "2026-07-01" });
    // dau is visible; addon's own userCount (4) is below k, so arpdau must not
    // leak it via arpdau*dau - entryFee. Only asserting on addon + arpdau since
    // complementary suppression may also knock out entryFee.
    expect(rows[0]!.addonRevenueUsd).toEqual({ value: null, suppressed: true });
    expect(rows[0]!.arpdau).toEqual({ value: null, suppressed: true });
  });
});
