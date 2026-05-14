import { describe, it, expect } from "vitest";
import { recordAdminAction } from "./_core/audit";
import { adminActions, type User } from "../drizzle/schema";
import { getDb } from "./db";
import { eq } from "drizzle-orm";

const adminUser = {
  id: 1,
  email: "admin@test",
  role: "admin" as const,
} as unknown as User;

function ctx(overrides: Record<string, unknown> = {}) {
  return {
    user: adminUser,
    ip: "192.168.1.42",
    userAgent: "vitest",
    requestId: `vitest-audit-${Date.now()}-${Math.random().toString(36).slice(2,8)}`,
    countryCode: "US",
    req: {} as any,
    res: {} as any,
    ...overrides,
  };
}

// Non-admin rejection is a pure guard — no DB needed.
describe("recordAdminAction (unit)", () => {
  it("rejects a non-admin actor before touching the DB", async () => {
    const nonAdminUser = { ...adminUser, role: "user" } as User;
    const c = ctx({ user: nonAdminUser });
    // Provide a fake tx that should never be called.
    const fakeTx = {
      insert: () => { throw new Error("should not reach insert"); },
    };
    await expect(
      recordAdminAction({
        ctx: c as any,
        tx: fakeTx,
        action: "song.update",
        targetType: "song",
        targetId: "should-not-insert",
      })
    ).rejects.toThrow(/non-admin/);
  });
});

// Live-DB integration — skipped when no DB connection string is present.
const DB_URL =
  process.env.SUPABASE_TRANSACTION_POOLER_STRING ??
  process.env.DATABASE_URL;
const liveDescribe = DB_URL ? describe : describe.skip;

liveDescribe("recordAdminAction (live DB)", () => {
  it("inserts a row with snapshotted actor email and truncated IP", async () => {
    const db = await getDb();
    if (!db) throw new Error("getDb returned null");
    const c = ctx();
    await db.transaction(async (tx) => {
      await recordAdminAction({
        ctx: c as any,
        tx,
        action: "song.update",
        targetType: "song",
        targetId: "audit-test-target",
        payload: { params: { id: 42 } },
      });
    });
    const rows = await db.select().from(adminActions).where(eq(adminActions.requestId, c.requestId));
    expect(rows).toHaveLength(1);
    expect(rows[0].actorEmail).toBe("admin@test");
    expect(rows[0].ipTruncated).toBe("192.168.1.0/24");
    expect(rows[0].action).toBe("song.update");
    expect(rows[0].targetType).toBe("song");
    expect(rows[0].targetId).toBe("audit-test-target");
    expect(rows[0].targetVariantIndex).toBeNull();
  });

  it("snapshots targetVariantIndex when provided", async () => {
    const db = await getDb();
    if (!db) throw new Error("getDb returned null");
    const c = ctx();
    await db.transaction(async (tx) => {
      await recordAdminAction({
        ctx: c as any,
        tx,
        action: "lyric_variant.update",
        targetType: "lyric_variant",
        targetId: "audit-test-variant-song",
        targetVariantIndex: 3,
      });
    });
    const rows = await db.select().from(adminActions).where(eq(adminActions.requestId, c.requestId));
    expect(rows).toHaveLength(1);
    expect(rows[0].targetVariantIndex).toBe(3);
  });
});
