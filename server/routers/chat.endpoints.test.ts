import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";

// Mock Stripe so importing appRouter doesn't require STRIPE_SECRET_KEY.
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
import { chatMessages, chatBans, users } from "../../drizzle/schema";
import { eq } from "drizzle-orm";

const DB_URL =
  process.env.SUPABASE_SESSION_POOLER_STRING ??
  process.env.SUPABASE_DIRECT_CONNECTION_STRING ??
  process.env.DATABASE_URL;
const liveDescribe = DB_URL ? describe : describe.skip;

const stamp = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

liveDescribe("chat.postMessage", () => {
  let userId: number;
  let adminId: number;

  beforeAll(async () => {
    const db = await getDb();
    const [u] = await db!.insert(users).values({
      openId: `chat-endpoints-user-${stamp}`,
      email: `chat-endpoints-user-${stamp}@example.com`,
      loginMethod: "vitest",
      role: "user",
    }).returning();
    userId = u.id;
    const [a] = await db!.insert(users).values({
      openId: `chat-endpoints-admin-${stamp}`,
      email: `chat-endpoints-admin-${stamp}@example.com`,
      loginMethod: "vitest",
      role: "admin",
    }).returning();
    adminId = a.id;
  });

  afterAll(async () => {
    const db = await getDb();
    await db!.delete(chatMessages).where(eq(chatMessages.authorId, userId));
    await db!.delete(chatMessages).where(eq(chatMessages.authorId, adminId));
    await db!.delete(chatBans).where(eq(chatBans.userId, userId));
    // users + their audit-log rows are left behind (immutable + FK).
  });

  const callerFor = (id: number, role: "user" | "admin") =>
    appRouter.createCaller({
      user: { id, role, email: `${id}@example.com` },
      req: { ip: "127.0.0.1" } as never,
      requestId: stamp,
      ip: "127.0.0.1",
      userAgent: "vitest",
    } as never);

  it("inserts a clean message and returns the row", async () => {
    const caller = callerFor(userId, "user");
    const result = await caller.chat.postMessage({
      scope: "global",
      roomId: 1,
      body: "hello phase 2",
    });
    expect(result.id).toBeGreaterThan(0);
    expect(result.scope).toBe("global");
    expect(result.body).toBe("hello phase 2");
    expect(result.flag_status ?? result.flagStatus).toBe("clean");
  });

  it("rejects when user is globally banned", async () => {
    const db = await getDb();
    await db!.insert(chatBans).values({
      userId: userId,
      scope: "global",
      action: "ban",
      reason: "test",
      createdBy: adminId,
    });
    const caller = callerFor(userId, "user");
    await expect(
      caller.chat.postMessage({ scope: "global", roomId: 1, body: "should fail" }),
    ).rejects.toThrow(/banned/i);
  });

  it("rejects profanity at the publish layer", async () => {
    // Clear the ban from the previous test
    const db = await getDb();
    await db!.delete(chatBans).where(eq(chatBans.userId, userId));

    const caller = callerFor(userId, "user");
    await expect(
      caller.chat.postMessage({ scope: "global", roomId: 1, body: "fucking trash" }),
    ).rejects.toThrow(/blocked|profanity|revise/i);
  });

  it("treats visible mute as a hard rejection", async () => {
    const db = await getDb();
    await db!.delete(chatBans).where(eq(chatBans.userId, userId));
    await db!.insert(chatBans).values({
      userId: userId,
      scope: "global",
      action: "mute_visible",
      reason: "test",
      createdBy: adminId,
    });
    const caller = callerFor(userId, "user");
    await expect(
      caller.chat.postMessage({ scope: "global", roomId: 1, body: "muted post" }),
    ).rejects.toThrow(/can't post|muted/i);
  });

  it("treats shadow mute as an apparent success but flags the row", async () => {
    const db = await getDb();
    await db!.delete(chatBans).where(eq(chatBans.userId, userId));
    await db!.insert(chatBans).values({
      userId: userId,
      scope: "global",
      action: "mute_shadow",
      reason: "test",
      createdBy: adminId,
    });
    const caller = callerFor(userId, "user");
    const result = await caller.chat.postMessage({
      scope: "global",
      roomId: 1,
      body: "shadow-muted message",
    });
    expect(result.id).toBeGreaterThan(0);
    expect((result as { postedWhileShadowBanned?: boolean; posted_while_shadow_banned?: boolean }).postedWhileShadowBanned
        ?? (result as Record<string, unknown>).posted_while_shadow_banned).toBe(true);
  });
});
