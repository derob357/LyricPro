// server/routers/adminAnalytics.test.ts
import { describe, expect, it } from "vitest";
import { shapeActivity, type ActivityEventRow } from "./adminAnalytics";

const TODAY = new Date("2026-07-08T12:00:00Z");
const OPTS = { days: 7, type: "all", tier: "all", newInWindowOnly: false, sort: "first-seen" } as const;

function ev(partial: Partial<ActivityEventRow>): ActivityEventRow {
  return {
    actor: "u:1", day: "2026-07-05", kind: "round",
    user_name: null, rank_tier: null, premium_status: null, favorite_genre: null,
    games_played: null, login_method: null, signup_at: null, sub_tier: null,
    guest_nickname: null, guest_created_at: null, marketing_opt_in: null, has_email: null,
    ...partial,
  };
}

describe("shapeActivity", () => {
  it("builds a continuous windowDays of exactly `days` columns ending today (UTC)", () => {
    const out = shapeActivity([], OPTS, TODAY);
    expect(out.windowDays).toHaveLength(7);
    expect(out.windowDays[0]).toBe("2026-07-02");
    expect(out.windowDays[6]).toBe("2026-07-08");
    expect(out.rows).toEqual([]);
    expect(out.truncated).toBe(false);
  });

  it("groups events per actor into roundDays/gameDays and firstActivityDay = min", () => {
    const out = shapeActivity([
      ev({ actor: "u:1", day: "2026-07-05", kind: "round", user_name: "Dave" }),
      ev({ actor: "u:1", day: "2026-07-06", kind: "game", user_name: "Dave" }),
      ev({ actor: "u:1", day: "2026-07-06", kind: "round", user_name: "Dave" }),
    ], OPTS, TODAY);
    expect(out.rows).toHaveLength(1);
    const r = out.rows[0]!;
    expect(r.roundDays).toEqual(["2026-07-05", "2026-07-06"]);
    expect(r.gameDays).toEqual(["2026-07-06"]);
    expect(r.firstActivityDay).toBe("2026-07-05");
    expect(r.label).toBe("Dave");
    expect(r.type).toBe("registered");
  });

  it("labels fall back: registered → 'user #<id>', guest → nickname else 'guest <tok4>'", () => {
    const out = shapeActivity([
      ev({ actor: "u:214" }),
      ev({ actor: "g:a1f9bc22", guest_nickname: null }),
      ev({ actor: "g:zz88xx", guest_nickname: "Sam" }),
    ], OPTS, TODAY);
    const labels = Object.fromEntries(out.rows.map((r) => [r.actor, r.label]));
    expect(labels["u:214"]).toBe("user #214");
    expect(labels["g:a1f9bc22"]).toBe("guest a1f9");
    expect(labels["g:zz88xx"]).toBe("Sam");
  });

  it("tier: subscription tier for registered (default free), null for guests", () => {
    const out = shapeActivity([
      ev({ actor: "u:1", sub_tier: "pro" }),
      ev({ actor: "u:2" }),
      ev({ actor: "g:tok" }),
    ], OPTS, TODAY);
    const tiers = Object.fromEntries(out.rows.map((r) => [r.actor, r.tier]));
    expect(tiers["u:1"]).toBe("pro");
    expect(tiers["u:2"]).toBe("free");
    expect(tiers["g:tok"]).toBeNull();
  });

  it("type filter keeps only the requested kind; tier filter excludes guests", () => {
    const rows = [ev({ actor: "u:1", sub_tier: "pro" }), ev({ actor: "g:tok" })];
    expect(shapeActivity(rows, { ...OPTS, type: "guest" }, TODAY).rows.map((r) => r.actor)).toEqual(["g:tok"]);
    expect(shapeActivity(rows, { ...OPTS, tier: "pro" }, TODAY).rows.map((r) => r.actor)).toEqual(["u:1"]);
    expect(shapeActivity(rows, { ...OPTS, tier: "free" }, TODAY).rows).toEqual([]);
  });

  it("newInWindowOnly filters by CREATION date in-window (not first activity)", () => {
    const rows = [
      ev({ actor: "u:1", signup_at: "2026-07-04T10:00:00Z" }),   // created in window
      ev({ actor: "u:2", signup_at: "2026-05-01T10:00:00Z" }),   // old account, active now
      ev({ actor: "g:new", guest_created_at: "2026-07-06T09:00:00Z" }),
      ev({ actor: "g:old", guest_created_at: "2026-01-01T09:00:00Z" }),
    ];
    const out = shapeActivity(rows, { ...OPTS, newInWindowOnly: true }, TODAY);
    expect(out.rows.map((r) => r.actor).sort()).toEqual(["g:new", "u:1"]);
  });

  it("sorts: first-seen asc (default), recent desc, active-days desc; actor tiebreak", () => {
    const rows = [
      ev({ actor: "u:1", day: "2026-07-03" }), ev({ actor: "u:1", day: "2026-07-07" }),
      ev({ actor: "u:2", day: "2026-07-02" }),
      ev({ actor: "u:3", day: "2026-07-05" }), ev({ actor: "u:3", day: "2026-07-06" }), ev({ actor: "u:3", day: "2026-07-08" }),
    ];
    expect(shapeActivity(rows, OPTS, TODAY).rows.map((r) => r.actor)).toEqual(["u:2", "u:1", "u:3"]);
    expect(shapeActivity(rows, { ...OPTS, sort: "recent" }, TODAY).rows.map((r) => r.actor)).toEqual(["u:3", "u:1", "u:2"]);
    expect(shapeActivity(rows, { ...OPTS, sort: "active-days" }, TODAY).rows.map((r) => r.actor)).toEqual(["u:3", "u:1", "u:2"]);
  });

  it("excludes event days before the window start (rolling-SQL seam)", () => {
    const out = shapeActivity([
      ev({ actor: "u:1", day: "2026-07-01" }),                    // only out-of-window → no row at all
      ev({ actor: "u:2", day: "2026-07-01" }),                    // out-of-window portion dropped…
      ev({ actor: "u:2", day: "2026-07-04" }),                    // …in-window portion kept
    ], OPTS, TODAY);
    expect(out.rows.map((r) => r.actor)).toEqual(["u:2"]);
    const r = out.rows[0]!;
    expect(r.roundDays).toEqual(["2026-07-04"]);
    expect(r.firstActivityDay).toBe("2026-07-04");
  });

  it("truncates guest actor keys so full session tokens never leave the server", () => {
    const token = "aB3dE5fG7hJ9kL1mN2pQ4rS6tU8vW0xY";
    const out = shapeActivity([ev({ actor: `g:${token}` })], OPTS, TODAY);
    expect(out.rows[0]!.actor).toBe(`g:${token.slice(0, 8)}`);
    expect(JSON.stringify(out)).not.toContain(token);
  });

  it("caps rows at 500 and sets truncated", () => {
    const rows: ActivityEventRow[] = [];
    for (let i = 0; i < 501; i++) rows.push(ev({ actor: `u:${i}`, day: "2026-07-05" }));
    const out = shapeActivity(rows, OPTS, TODAY);
    expect(out.rows).toHaveLength(500);
    expect(out.truncated).toBe(true);
  });
});
