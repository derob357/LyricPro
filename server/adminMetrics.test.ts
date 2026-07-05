import { describe, it, expect, vi } from "vitest";
vi.mock("stripe", () => ({ default: vi.fn().mockImplementation(() => ({ checkout: { sessions: { create: vi.fn() } }, webhooks: { constructEvent: vi.fn() }, subscriptions: { retrieve: vi.fn() }, customers: { search: vi.fn().mockResolvedValue({ data: [] }) } })) }));
import { getAdminMetrics } from "./db-monetization";

const DB_URL = process.env.SUPABASE_SESSION_POOLER_STRING ?? process.env.SUPABASE_DIRECT_CONNECTION_STRING ?? process.env.DATABASE_URL;
const liveDescribe = DB_URL ? describe : describe.skip;

liveDescribe("getAdminMetrics", () => {
  it("counts all paid tiers as active and returns a per-tier breakdown", async () => {
    const m = await getAdminMetrics();
    expect(m).toHaveProperty("activeByTier");
    expect(m.activeByTier).toEqual(expect.objectContaining({ player: expect.any(Number), pro: expect.any(Number), elite: expect.any(Number) }));
    // activeSubscriptions must equal the sum of the three paid tiers.
    expect(m.activeSubscriptions).toBe(m.activeByTier.player + m.activeByTier.pro + m.activeByTier.elite);
    expect(typeof m.totalUsers).toBe("number");
  });
});
