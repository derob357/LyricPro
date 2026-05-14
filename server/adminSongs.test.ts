import { describe, it, expect, vi } from "vitest";

// Stripe initialises at module load with STRIPE_SECRET_KEY. Mock it so tests
// that import appRouter don't require a real key in the environment.
vi.mock("stripe", () => {
  const Stripe = vi.fn().mockImplementation(() => ({
    checkout: { sessions: { create: vi.fn() } },
    webhooks: { constructEvent: vi.fn() },
    subscriptions: { retrieve: vi.fn() },
    customers: { search: vi.fn().mockResolvedValue({ data: [] }) },
  }));
  return { default: Stripe };
});

import { appRouter } from "./app-router";

const DB_URL =
  process.env.SUPABASE_SESSION_POOLER_STRING ??
  process.env.SUPABASE_DIRECT_CONNECTION_STRING ??
  process.env.DATABASE_URL;
const liveDescribe = DB_URL ? describe : describe.skip;

function makeAdminCaller() {
  return appRouter.createCaller({
    user: { id: 1, role: "admin", email: "admin@test" } as any,
    req: {} as any, res: {} as any,
    ip: undefined, userAgent: undefined, requestId: undefined, countryCode: undefined,
  });
}

liveDescribe("admin.songs.list", () => {
  it("returns paginated songs with variant count and play count", async () => {
    const caller = makeAdminCaller();
    const result = await caller.adminSongs.list({ limit: 5 });
    expect(result).toHaveProperty("rows");
    expect(result).toHaveProperty("nextCursor");
    expect(Array.isArray(result.rows)).toBe(true);
    if (result.rows.length > 0) {
      const r = result.rows[0];
      expect(r).toEqual(expect.objectContaining({
        id: expect.any(Number),
        title: expect.any(String),
        artistName: expect.any(String),
        variantCount: expect.any(Number),
        displayCount: expect.any(Number),
      }));
    }
  });

  it("respects the limit parameter", async () => {
    const caller = makeAdminCaller();
    const result = await caller.adminSongs.list({ limit: 3 });
    expect(result.rows.length).toBeLessThanOrEqual(3);
  });

  it("cursor pagination returns disjoint pages", async () => {
    const caller = makeAdminCaller();
    const page1 = await caller.adminSongs.list({ limit: 2 });
    if (page1.nextCursor === null || page1.rows.length < 2) return; // not enough data to test
    const page2 = await caller.adminSongs.list({ limit: 2, cursor: page1.nextCursor });
    const page1Ids = new Set(page1.rows.map((r: any) => r.id));
    const page2Ids = new Set(page2.rows.map((r: any) => r.id));
    expect([...page1Ids].some((id) => page2Ids.has(id))).toBe(false);
  });
});
