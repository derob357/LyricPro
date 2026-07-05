import { describe, it, expect, vi } from "vitest";
vi.mock("stripe", () => ({ default: vi.fn().mockImplementation(() => ({ checkout: { sessions: { create: vi.fn() } }, webhooks: { constructEvent: vi.fn() }, subscriptions: { retrieve: vi.fn() }, customers: { search: vi.fn().mockResolvedValue({ data: [] }) } })) }));
import { appRouter } from "./app-router";

const DB_URL = process.env.SUPABASE_SESSION_POOLER_STRING ?? process.env.SUPABASE_DIRECT_CONNECTION_STRING ?? process.env.DATABASE_URL;
const liveDescribe = DB_URL ? describe : describe.skip;

function caller(role: "admin" | "user") {
  return appRouter.createCaller({ user: { id: 1, role, email: "x@test" } as any, req: {} as any, res: {} as any, ip: undefined, userAgent: undefined, requestId: `vitest-gh-${Date.now()}-${Math.random()}`, countryCode: "US" });
}

describe("game.getGameHistory gate", () => {
  it("rejects unauthenticated callers", async () => {
    const unauthCaller = appRouter.createCaller({ user: undefined as any, req: {} as any, res: {} as any, ip: undefined, userAgent: undefined, requestId: "vitest-gh-unauth", countryCode: "US" });
    await expect(unauthCaller.game.getGameHistory({})).rejects.toThrow();
  });
});

liveDescribe("game.getGameHistory live", () => {
  it("returns an array for authenticated caller", async () => {
    const res = await caller("user").game.getGameHistory({});
    expect(Array.isArray(res)).toBe(true);
  });
});
