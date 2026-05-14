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

function makeAdminCaller(label: string) {
  return appRouter.createCaller({
    user: { id: 1, role: "admin", email: "admin@test" } as any,
    req: {} as any, res: {} as any,
    ip: "10.0.0.3", userAgent: "vitest",
    requestId: `vitest-${label}-${Date.now()}-${Math.random().toString(36).slice(2,8)}`,
    countryCode: "US",
  });
}

liveDescribe("admin.variants.update", () => {
  it("updates a single variant entry and the change persists; restores at end", async () => {
    const caller = makeAdminCaller("variant-update");
    // Find a song that has at least one variant
    const list = await caller.adminSongs.list({ limit: 50 });
    let target;
    for (const r of list.rows) {
      const full = await caller.adminSongs.get({ id: r.id });
      if (full.lyricVariants && full.lyricVariants.length > 0) {
        target = full;
        break;
      }
    }
    if (!target) return; // no songs with variants — skip vacuously
    const beforeAnswer = target.lyricVariants![0].answer;
    const newAnswer = `vitest-${Date.now()}`;

    await caller.adminVariants.update({
      songId: target.id,
      variantIndex: 0,
      patch: { answer: newAnswer },
    });
    const reloaded = await caller.adminSongs.get({ id: target.id });
    expect(reloaded.lyricVariants![0].answer).toBe(newAnswer);

    // Restore
    await caller.adminVariants.update({
      songId: target.id,
      variantIndex: 0,
      patch: { answer: beforeAnswer },
    });
    const restored = await caller.adminSongs.get({ id: target.id });
    expect(restored.lyricVariants![0].answer).toBe(beforeAnswer);
  });

  it("rejects variantIndex out of range", async () => {
    const caller = makeAdminCaller("variant-oor");
    const list = await caller.adminSongs.list({ limit: 1 });
    if (list.rows.length === 0) return;
    await expect(
      caller.adminVariants.update({
        songId: list.rows[0].id,
        variantIndex: 99999,
        patch: { answer: "should-fail" },
      })
    ).rejects.toThrow();
  });
});
