import { describe, it, expect, vi } from "vitest";
vi.mock("stripe", () => ({ default: vi.fn().mockImplementation(() => ({ checkout: { sessions: { create: vi.fn() } }, webhooks: { constructEvent: vi.fn() }, subscriptions: { retrieve: vi.fn() }, customers: { search: vi.fn().mockResolvedValue({ data: [] }) } })) }));
import { appRouter } from "./app-router";

const DB_URL = process.env.SUPABASE_SESSION_POOLER_STRING ?? process.env.SUPABASE_DIRECT_CONNECTION_STRING ?? process.env.DATABASE_URL;
const liveDescribe = DB_URL ? describe : describe.skip;

function caller(role: "admin" | "user") {
  return appRouter.createCaller({ user: { id: 1, role, email: "x@test" } as any, req: {} as any, res: {} as any, ip: undefined, userAgent: undefined, requestId: `vitest-aa-${Date.now()}-${Math.random()}`, countryCode: "US" });
}

describe("adminAnalytics gate", () => {
  it("rejects non-admins from payoutPipeline", async () => {
    await expect(caller("user").adminAnalytics.payoutPipeline()).rejects.toThrow();
  });
});

liveDescribe("adminAnalytics.payoutPipeline", () => {
  it("returns grouped payout rows", async () => {
    const res = await caller("admin").adminAnalytics.payoutPipeline();
    expect(Array.isArray(res.prizePayouts)).toBe(true);
    expect(Array.isArray(res.payoutRequests)).toBe(true);
  });
});
