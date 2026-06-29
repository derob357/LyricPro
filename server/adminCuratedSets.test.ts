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
