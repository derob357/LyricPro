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
  it("rejects non-admins from retention", async () => {
    await expect(caller("user").adminAnalytics.retention({})).rejects.toThrow();
  });
  it("rejects non-admins from songAccuracy", async () => {
    await expect(caller("user").adminAnalytics.songAccuracy({})).rejects.toThrow();
  });
  it("rejects non-admins from gnEconomy", async () => {
    await expect(caller("user").adminAnalytics.gnEconomy()).rejects.toThrow();
  });
  it("rejects non-admins from tournamentFinancials", async () => {
    await expect(caller("user").adminAnalytics.tournamentFinancials()).rejects.toThrow();
  });
  it("rejects non-admins from guestFunnel", async () => {
    await expect(caller("user").adminAnalytics.guestFunnel({})).rejects.toThrow();
  });
  it("rejects non-admins from exportUsers", async () => {
    await expect(caller("user").adminAnalytics.exportUsers()).rejects.toThrow();
  });
  it("rejects non-admins from exportPayoutHistory", async () => {
    await expect(caller("user").adminAnalytics.exportPayoutHistory()).rejects.toThrow();
  });
});

liveDescribe("adminAnalytics.payoutPipeline", () => {
  it("returns grouped payout rows", async () => {
    const res = await caller("admin").adminAnalytics.payoutPipeline();
    expect(Array.isArray(res.prizePayouts)).toBe(true);
    expect(Array.isArray(res.payoutRequests)).toBe(true);
  });
});

liveDescribe("adminAnalytics.songAccuracy", () => {
  it("returns hardest/easiest with rate fields", async () => {
    const res = await caller("admin").adminAnalytics.songAccuracy({ limit: 5 });
    expect(Array.isArray(res.hardest)).toBe(true);
    for (const s of [...res.hardest, ...res.easiest]) {
      expect(s.overallRate).toBeGreaterThanOrEqual(0);
      expect(s.overallRate).toBeLessThanOrEqual(1);
      expect(s.rounds).toBeGreaterThanOrEqual(5);
    }
    if (res.hardest.length && res.easiest.length) expect(res.hardest[0].overallRate).toBeLessThanOrEqual(res.easiest[0].overallRate);
  });
});

liveDescribe("adminAnalytics.gnEconomy", () => {
  it("returns numeric fields and byReason array", async () => {
    const res = await caller("admin").adminAnalytics.gnEconomy();
    expect(typeof res.circulation).toBe("number");
    expect(typeof res.totalCredited).toBe("number");
    expect(typeof res.totalDebited).toBe("number");
    expect(typeof res.purchasedCount).toBe("number");
    expect(typeof res.purchasedAmount).toBe("number");
    expect(Array.isArray(res.byReason)).toBe(true);
    for (const r of res.byReason) {
      expect(typeof r.reason).toBe("string");
      expect(typeof r.credited).toBe("number");
      expect(typeof r.debited).toBe("number");
      expect(typeof r.net).toBe("number");
      expect(typeof r.count).toBe("number");
    }
  });
});

liveDescribe("adminAnalytics.tournamentFinancials", () => {
  it("returns tournaments array, rollup.byStatus array, and valid fillRates", async () => {
    const res = await caller("admin").adminAnalytics.tournamentFinancials();
    expect(Array.isArray(res.tournaments)).toBe(true);
    expect(Array.isArray(res.rollup.byStatus)).toBe(true);
    for (const t of res.tournaments) {
      if (t.fillRate !== null) {
        expect(t.fillRate).toBeGreaterThanOrEqual(0);
        expect(t.fillRate).toBeLessThanOrEqual(1);
      }
    }
  });
});

liveDescribe("adminAnalytics.guestFunnel", () => {
  it("returns numeric fields and newGuestsSeries array", async () => {
    const res = await caller("admin").adminAnalytics.guestFunnel({ days: 30 });
    expect(typeof res.totalGuests).toBe("number");
    expect(typeof res.leads).toBe("number");
    expect(typeof res.optIns).toBe("number");
    expect(typeof res.converted).toBe("number");
    expect(typeof res.conversionRate).toBe("number");
    expect(Array.isArray(res.newGuestsSeries)).toBe(true);
    for (const p of res.newGuestsSeries) {
      expect(typeof p.day).toBe("string");
      expect(typeof p.guests).toBe("number");
    }
  });
});

liveDescribe("adminAnalytics.retention", () => {
  it("returns both series with DayPoint shape", async () => {
    const res = await caller("admin").adminAnalytics.retention({ days: 30 });
    expect(Array.isArray(res.roundsSeries)).toBe(true);
    expect(Array.isArray(res.gamesSeries)).toBe(true);
    for (const p of [...res.roundsSeries, ...res.gamesSeries]) {
      expect(p).toEqual(expect.objectContaining({ day: expect.any(String), dau: expect.any(Number), wau: expect.any(Number), mau: expect.any(Number) }));
      expect(p.wau).toBeGreaterThanOrEqual(p.dau);
      expect(p.mau).toBeGreaterThanOrEqual(p.wau);
    }
  });
});

liveDescribe("adminAnalytics.exportUsers", () => {
  it("returns csv starting with header and numeric rowCount", async () => {
    const res = await caller("admin").adminAnalytics.exportUsers();
    expect(res.csv.startsWith("id,email,firstName,role,lifetimeScore,gamesPlayed,totalWins")).toBe(true);
    expect(typeof res.rowCount).toBe("number");
  });
});

liveDescribe("adminAnalytics.exportPayoutHistory", () => {
  it("returns csv starting with header and numeric rowCount", async () => {
    const res = await caller("admin").adminAnalytics.exportPayoutHistory();
    expect(res.csv.startsWith("id,status,amount,createdAt")).toBe(true);
    expect(typeof res.rowCount).toBe("number");
  });
});
