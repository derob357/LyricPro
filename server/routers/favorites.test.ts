import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";

vi.mock("stripe", () => {
  const Stripe = vi.fn().mockImplementation(() => ({
    checkout: { sessions: { create: vi.fn() } },
    webhooks: { constructEvent: vi.fn() },
    subscriptions: { retrieve: vi.fn() },
    customers: { search: vi.fn().mockResolvedValue({ data: [] }) },
  }));
  return { default: Stripe };
});

import { appRouter } from "../app-router";
import { getDb } from "../db";
import { userFavorites, users } from "../../drizzle/schema";
import { eq, or, inArray } from "drizzle-orm";

const DB_URL =
  process.env.SUPABASE_SESSION_POOLER_STRING ??
  process.env.SUPABASE_DIRECT_CONNECTION_STRING ??
  process.env.DATABASE_URL;
const liveDescribe = DB_URL ? describe : describe.skip;

const stamp = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

liveDescribe("favoritesRouter", () => {
  let aliceId: number;
  let bobId: number;
  let carolId: number;

  beforeAll(async () => {
    const db = await getDb();
    const inserted = await db!.insert(users).values([
      { openId: `fav-alice-${stamp}`, email: `fav-alice-${stamp}@example.com`, loginMethod: "vitest", role: "user" },
      { openId: `fav-bob-${stamp}`, email: `fav-bob-${stamp}@example.com`, loginMethod: "vitest", role: "user" },
      { openId: `fav-carol-${stamp}`, email: `fav-carol-${stamp}@example.com`, loginMethod: "vitest", role: "user" },
    ]).returning();
    aliceId = inserted[0].id;
    bobId = inserted[1].id;
    carolId = inserted[2].id;
  });

  afterAll(async () => {
    const db = await getDb();
    await db!.delete(userFavorites).where(
      or(
        inArray(userFavorites.followerId, [aliceId, bobId, carolId]),
        inArray(userFavorites.favoriteId, [aliceId, bobId, carolId]),
      ),
    );
    await db!.delete(users).where(inArray(users.id, [aliceId, bobId, carolId]));
  });

  const callerFor = (id: number) =>
    appRouter.createCaller({
      user: { id, role: "user", email: `${id}@example.com` },
      req: { ip: "127.0.0.1" } as never,
      ip: "127.0.0.1",
      userAgent: "vitest",
    } as never);

  it("add inserts a row", async () => {
    const result = await callerFor(aliceId).favorites.add({ userId: bobId });
    expect(result.added).toBe(true);
    expect(result.totalFavorites).toBeGreaterThanOrEqual(1);
  });

  it("add is idempotent (re-favoriting returns added=false)", async () => {
    const result = await callerFor(aliceId).favorites.add({ userId: bobId });
    expect(result.added).toBe(false);
  });

  it("remove deletes the row and returns removed=true", async () => {
    const result = await callerFor(aliceId).favorites.remove({ userId: bobId });
    expect(result.removed).toBe(true);
    // Re-add for later tests
    await callerFor(aliceId).favorites.add({ userId: bobId });
  });

  it("remove on a non-favorited user returns removed=false", async () => {
    const result = await callerFor(aliceId).favorites.remove({ userId: carolId });
    expect(result.removed).toBe(false);
  });

  it("self-favorite is rejected", async () => {
    await expect(callerFor(aliceId).favorites.add({ userId: aliceId })).rejects.toThrow(/cannot favorite/i);
  });

  it("list returns the viewer's own favorites only", async () => {
    await callerFor(aliceId).favorites.add({ userId: carolId });
    const aliceList = await callerFor(aliceId).favorites.list();
    expect(aliceList.map((f) => f.favoriteId).sort()).toEqual([bobId, carolId].sort());

    const bobList = await callerFor(bobId).favorites.list();
    expect(bobList.length).toBe(0); // bob hasn't favorited anyone
  });

  it("countForUser is publicly readable", async () => {
    const aliceCount = await callerFor(bobId).favorites.countForUser({ userId: aliceId });
    expect(aliceCount.count).toBe(2); // alice favorited bob + carol
  });

  it("followerCountForMe returns who-favorited-me count", async () => {
    // bob has been favorited by alice
    const result = await callerFor(bobId).favorites.followerCountForMe();
    expect(result.count).toBeGreaterThanOrEqual(1);
  });

  it("100-favorite cap is enforced server-side", async () => {
    // 100-user + 98-favorite seed over the remote pooler is slow; extend
    // beyond the default 5s test timeout.
    // Seed 100 dummy users alice has favorited
    const db = await getDb();
    const placeholders = [];
    for (let i = 0; i < 100; i++) {
      placeholders.push({
        openId: `fav-bulk-${stamp}-${i}`,
        email: `fav-bulk-${stamp}-${i}@example.com`,
        loginMethod: "vitest",
        role: "user" as const,
      });
    }
    const bulk = await db!.insert(users).values(placeholders).returning();
    // Bring alice up to 100 by favoriting each of the bulk users + already favorited 2 (bob, carol)
    // She's at 2; need 98 more to reach 100
    for (let i = 0; i < 98; i++) {
      await db!.insert(userFavorites).values({ followerId: aliceId, favoriteId: bulk[i].id });
    }
    // The 101st must fail
    await expect(
      callerFor(aliceId).favorites.add({ userId: bulk[98].id }),
    ).rejects.toThrow(/limit|cap|maximum/i);

    // Cleanup the bulk users + their favorites
    await db!.delete(userFavorites).where(eq(userFavorites.followerId, aliceId));
    await db!.delete(users).where(inArray(users.id, bulk.map((u) => u.id)));
    // Restore the baseline (alice favorites bob + carol)
    await callerFor(aliceId).favorites.add({ userId: bobId });
    await callerFor(aliceId).favorites.add({ userId: carolId });
  }, 60000);
});
