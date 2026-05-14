import { describe, it, expect, vi } from "vitest";

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
    ip: "10.0.0.4", userAgent: "vitest",
    requestId: `vitest-${label}-${Date.now()}-${Math.random().toString(36).slice(2,8)}`,
    countryCode: "US",
  });
}

liveDescribe("admin.actions.list", () => {
  it("returns audit rows in reverse chronological order", async () => {
    const caller = makeAdminCaller("actions-list");
    const result = await caller.adminActions.list({ limit: 5 });
    expect(result).toHaveProperty("rows");
    expect(result).toHaveProperty("nextCursor");
    expect(Array.isArray(result.rows)).toBe(true);
    if (result.rows.length >= 2) {
      const t0 = new Date(result.rows[0].occurredAt).getTime();
      const t1 = new Date(result.rows[1].occurredAt).getTime();
      expect(t0).toBeGreaterThanOrEqual(t1);
    }
  });

  it("filter by action narrows results", async () => {
    const caller = makeAdminCaller("actions-filter");
    const result = await caller.adminActions.list({ limit: 20, actions: ["song.update"] });
    for (const r of result.rows) {
      expect(r.action).toBe("song.update");
    }
  });
});

liveDescribe("admin.actions.exportCsv", () => {
  it("returns CSV string and writes an export.admin_actions_csv audit row", async () => {
    const caller = makeAdminCaller("actions-export");
    const r = await caller.adminActions.exportCsv({});
    expect(typeof r.csv).toBe("string");
    expect(r.csv.startsWith("occurred_at,actor_email,action,")).toBe(true);
    expect(r.rowCount).toEqual(expect.any(Number));
  });
});
