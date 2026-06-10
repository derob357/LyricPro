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

import { getDb } from "../db";
import {
  users,
  goldenNoteBalances,
  goldenNoteTransactions,
} from "../../drizzle/schema";
import { eq } from "drizzle-orm";
import { spendGoldenNotes, creditGoldenNotes } from "./goldenNotesLedger";

const DB_URL =
  process.env.SUPABASE_SESSION_POOLER_STRING ??
  process.env.SUPABASE_DIRECT_CONNECTION_STRING ??
  process.env.DATABASE_URL;
const liveDescribe = DB_URL ? describe : describe.skip;

const stamp = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

liveDescribe("goldenNotesLedger", () => {
  let userId: number;

  beforeAll(async () => {
    const db = await getDb();
    const [u] = await db!.insert(users).values({
      openId: `gn-ledger-${stamp}`,
      email: `gn-ledger-${stamp}@example.com`,
      loginMethod: "vitest",
      role: "user",
    }).returning();
    userId = u.id;
    // Seed balance to 100 GN — pools must sum to balance (migration 0020 invariant).
    await db!.insert(goldenNoteBalances).values({ userId, balance: 100, purchasedBalance: 100, earnedBalance: 0 });
  });

  afterAll(async () => {
    const db = await getDb();
    await db!.delete(goldenNoteTransactions).where(eq(goldenNoteTransactions.userId, userId));
    await db!.delete(goldenNoteBalances).where(eq(goldenNoteBalances.userId, userId));
    await db!.delete(users).where(eq(users.id, userId));
  });

  it("spendGoldenNotes debits, writes a transaction row, and returns new balance", async () => {
    const db = await getDb();
    const result = await db!.transaction(async (tx) => {
      return spendGoldenNotes(tx, userId, 30, "spend_tournament", "test spend");
    });
    expect(result.newBalance).toBe(70);

    const txRows = await db!
      .select()
      .from(goldenNoteTransactions)
      .where(eq(goldenNoteTransactions.userId, userId));
    expect(txRows.some((r) => r.amount === -30 && r.kind === "spend_tournament")).toBe(true);
  });

  it("spendGoldenNotes throws when balance is insufficient", async () => {
    const db = await getDb();
    await expect(
      db!.transaction(async (tx) => {
        return spendGoldenNotes(tx, userId, 9999, "spend_tournament", "too much");
      }),
    ).rejects.toThrow(/not enough golden notes|insufficient golden notes/i);
  });

  it("creditGoldenNotes adds funds and writes a refund transaction", async () => {
    const db = await getDb();
    const result = await db!.transaction(async (tx) => {
      return creditGoldenNotes(tx, userId, 30, "refund", "test refund");
    });
    expect(result.newBalance).toBe(100); // 70 + 30 = 100 again

    const txRows = await db!
      .select()
      .from(goldenNoteTransactions)
      .where(eq(goldenNoteTransactions.userId, userId));
    expect(txRows.some((r) => r.amount === 30 && r.kind === "refund")).toBe(true);
  });

  it("creditGoldenNotes auto-creates a balance row if missing", async () => {
    const db = await getDb();
    const ts2 = `${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
    const [u2] = await db!.insert(users).values({
      openId: `gn-credit-fresh-${ts2}`,
      email: `gn-credit-fresh-${ts2}@example.com`,
      loginMethod: "vitest",
      role: "user",
    }).returning();
    try {
      const result = await db!.transaction(async (tx) => {
        return creditGoldenNotes(tx, u2.id, 50, "admin_adjustment", "comp");
      });
      expect(result.newBalance).toBe(50);
    } finally {
      await db!.delete(goldenNoteTransactions).where(eq(goldenNoteTransactions.userId, u2.id));
      await db!.delete(goldenNoteBalances).where(eq(goldenNoteBalances.userId, u2.id));
      await db!.delete(users).where(eq(users.id, u2.id));
    }
  });
});
