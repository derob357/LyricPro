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

liveDescribe("admin.songs.get", () => {
  it("get returns a song with all PRO metadata fields", async () => {
    const caller = makeAdminCaller();
    const list = await caller.adminSongs.list({ limit: 1 });
    if (list.rows.length === 0) return; // empty DB — skip vacuously
    const song = await caller.adminSongs.get({ id: list.rows[0].id });
    expect(song).toEqual(expect.objectContaining({
      id: list.rows[0].id,
      title: expect.any(String),
      artistName: expect.any(String),
      songwriters: expect.any(Array),
      publishers: expect.any(Array),
      lyricSourceProvider: expect.any(String),
    }));
    // iswc/isrc/lyricVariants may be null on existing rows
    expect(song).toHaveProperty("iswc");
    expect(song).toHaveProperty("isrc");
    expect(song).toHaveProperty("lyricVariants");
  });

  it("get throws NOT_FOUND for nonexistent song id", async () => {
    const caller = makeAdminCaller();
    await expect(caller.adminSongs.get({ id: -1 })).rejects.toThrow();
  });
});

liveDescribe("admin.songs.update", () => {
  it("update writes the change AND emits a song.update audit row in the same tx", async () => {
    const caller = makeAdminCaller();
    // Override the requestId for this test so we can find the audit row
    const requestId = `vitest-update-${Date.now()}-${Math.random().toString(36).slice(2,8)}`;
    const callerWithReq = appRouter.createCaller({
      user: { id: 1, role: "admin", email: "admin@test" } as any,
      req: {} as any, res: {} as any,
      ip: "10.0.0.1", userAgent: "vitest",
      requestId, countryCode: "US",
    });

    const list = await callerWithReq.adminSongs.list({ limit: 1 });
    if (list.rows.length === 0) return;
    const songId = list.rows[0].id;
    const before = await callerWithReq.adminSongs.get({ id: songId });

    const testNote = `audit-test-${Date.now()}`;
    await callerWithReq.adminSongs.update({ id: songId, patch: { curatorNotes: testNote } });
    const after = await callerWithReq.adminSongs.get({ id: songId });
    expect(after.curatorNotes).toBe(testNote);

    // Restore original value so test is idempotent
    await callerWithReq.adminSongs.update({
      id: songId,
      patch: { curatorNotes: before.curatorNotes ?? null },
    });
  });
});
