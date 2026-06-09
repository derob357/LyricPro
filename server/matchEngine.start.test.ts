import { describe, it, expect } from "vitest";
import { assertCanStart } from "./routers/matchEngine";
describe("assertCanStart", () => {
  it("passes for host, waiting, all ready, >=2", () => {
    expect(() => assertCanStart({ isHost: true, status: "waiting", readyCount: 3, playerCount: 3 })).not.toThrow();
  });
  it("rejects non-host", () => { expect(() => assertCanStart({ isHost: false, status: "waiting", readyCount: 3, playerCount: 3 })).toThrow(/host/i); });
  it("rejects <2 players", () => { expect(() => assertCanStart({ isHost: true, status: "waiting", readyCount: 1, playerCount: 1 })).toThrow(/2 players/i); });
  it("rejects not-all-ready", () => { expect(() => assertCanStart({ isHost: true, status: "waiting", readyCount: 2, playerCount: 3 })).toThrow(/ready/i); });
  it("rejects already started", () => { expect(() => assertCanStart({ isHost: true, status: "active", readyCount: 3, playerCount: 3 })).toThrow(/already/i); });
});
