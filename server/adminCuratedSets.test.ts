import { describe, it, expect, vi } from "vitest";

// Stripe initialises at module load with STRIPE_SECRET_KEY. Mock it so tests
// that import router modules don't require a real key in the environment.
vi.mock("stripe", () => {
  const Stripe = vi.fn().mockImplementation(() => ({
    checkout: { sessions: { create: vi.fn() } },
    webhooks: { constructEvent: vi.fn() },
    subscriptions: { retrieve: vi.fn() },
    customers: { search: vi.fn().mockResolvedValue({ data: [] }) },
  }));
  return { default: Stripe };
});

// NOTE: The adminCuratedSetsRouter is NOT yet registered in app-router (that's Task 7).
// We build a minimal test router here so the gate test can prove adminProcedure
// actually rejects non-admins without requiring premature registration in app-router.
import { router } from "./_core/trpc";
import { adminCuratedSetsRouter } from "./routers/adminCuratedSets";

const testRouter = router({ adminCuratedSets: adminCuratedSetsRouter });

const DB_URL =
  process.env.SUPABASE_SESSION_POOLER_STRING ??
  process.env.SUPABASE_DIRECT_CONNECTION_STRING ??
  process.env.DATABASE_URL;
const liveDescribe = DB_URL ? describe : describe.skip;

function caller(role: "admin" | "user") {
  return testRouter.createCaller({
    user: { id: 1, role, email: "x@test" } as any,
    req: {} as any,
    res: {} as any,
    ip: undefined,
    userAgent: undefined,
    requestId: `vitest-cs-${Date.now()}-${Math.random()}`,
    countryCode: "US",
  });
}

describe("adminCuratedSets gate", () => {
  it("rejects non-admins", async () => {
    await expect(caller("user").adminCuratedSets.list({})).rejects.toThrow();
  });
});

liveDescribe("adminCuratedSets CRUD", () => {
  it("create -> get -> update -> delete round-trips", async () => {
    const c = caller("admin");
    const created = await c.adminCuratedSets.create({ name: `Vitest Set ${Date.now()}`, items: [{ songId: 1, variantIndex: null }] });
    expect(created.id).toEqual(expect.any(Number));
    const got = await c.adminCuratedSets.get({ id: created.id });
    expect(got.items.length).toBe(1);
    const upd = await c.adminCuratedSets.update({ id: created.id, patch: { status: "draft" } });
    expect(upd.status).toBe("draft");
    const del = await c.adminCuratedSets.delete({ id: created.id });
    expect(del.ok).toBe(true);
  });
});

liveDescribe("adminCuratedSets.launch", () => {
  it("creates a multiplayer room with the set's songs as the custom pack", async () => {
    const c = caller("admin");
    const db = (await import("./db")).getDb && (await (await import("./db")).getDb())!;
    const { songs } = await import("../drizzle/schema");
    const { eq } = await import("drizzle-orm");
    const seed = await db.select().from(songs).where(eq(songs.isActive, true)).limit(2);
    if (seed.length < 2) return;
    const set = await c.adminCuratedSets.create({ name: `Launch ${Date.now()}`, items: seed.map((s: any) => ({ songId: s.id, variantIndex: null })) });
    const launched = await c.adminCuratedSets.launch({ setId: set.id, mode: "multiplayer" });
    expect(launched.roomCode).toMatch(/^[A-Z2-9]{6}$/);
    const { gameRooms } = await import("../drizzle/schema");
    const [room] = await db.select().from(gameRooms).where(eq(gameRooms.roomCode, launched.roomCode)).limit(1);
    expect(room.customPackSongIds).toEqual(seed.map((s: any) => s.id));
    expect(room.roundsTotal).toBe(2);
    // cleanup
    const { roomPlayers } = await import("../drizzle/schema");
    await db.delete(roomPlayers).where(eq(roomPlayers.roomId, room.id));
    await db.delete(gameRooms).where(eq(gameRooms.id, room.id));
    await c.adminCuratedSets.delete({ id: set.id });
  });
});
