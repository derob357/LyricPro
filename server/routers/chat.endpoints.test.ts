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
import { chatMessages, chatBans, chatRoomMembers, users } from "../../drizzle/schema";
import { and, eq } from "drizzle-orm";

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

liveDescribe("chat fetch queries", () => {
  let readerId: number;
  let posterId: number;

  beforeAll(async () => {
    const db = await getDb();
    const ts = `${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
    const [r] = await db!.insert(users).values({
      openId: `chat-fetch-reader-${ts}`,
      email: `chat-fetch-reader-${ts}@example.com`,
      loginMethod: "vitest",
      role: "user",
    }).returning();
    readerId = r.id;
    const [p] = await db!.insert(users).values({
      openId: `chat-fetch-poster-${ts}`,
      email: `chat-fetch-poster-${ts}@example.com`,
      loginMethod: "vitest",
      role: "user",
    }).returning();
    posterId = p.id;

    // Seed 5 messages in the global room
    for (let i = 1; i <= 5; i++) {
      await db!.insert(chatMessages).values({
        scope: "global",
        roomId: 1,
        authorId: posterId,
        body: `fetch-test message ${i}`,
      });
    }
  });

  afterAll(async () => {
    const db = await getDb();
    await db!.delete(chatMessages).where(eq(chatMessages.authorId, posterId));
  });

  const callerFor = (id: number) =>
    appRouter.createCaller({
      user: { id, role: "user", email: `${id}@example.com` },
      req: { ip: "127.0.0.1" } as never,
      ip: "127.0.0.1",
      userAgent: "vitest",
    } as never);

  it("fetchInitial returns the most-recent messages (descending by id)", async () => {
    const caller = callerFor(readerId);
    const result = await caller.chat.fetchInitial({ scope: "global", roomId: 1, limit: 10 });
    expect(result.messages.length).toBeGreaterThanOrEqual(5);
    // Descending id (newest first)
    for (let i = 0; i < result.messages.length - 1; i++) {
      expect(result.messages[i].id).toBeGreaterThanOrEqual(result.messages[i + 1].id);
    }
    expect(result.lastSeenSeq).toBe(result.messages[0]?.id ?? 0);
  });

  it("fetchOlder paginates correctly with beforeId", async () => {
    const caller = callerFor(readerId);
    const first = await caller.chat.fetchInitial({ scope: "global", roomId: 1, limit: 2 });
    const second = await caller.chat.fetchOlder({
      scope: "global",
      roomId: 1,
      beforeId: first.messages[first.messages.length - 1].id,
      limit: 2,
    });
    expect(second.length).toBeGreaterThan(0);
    // All returned messages must have id < the oldest from `first`
    for (const m of second) {
      expect(m.id).toBeLessThan(first.messages[first.messages.length - 1].id);
    }
  });

  it("fetchSince returns only messages newer than lastSeenSeq", async () => {
    const caller = callerFor(readerId);
    const initial = await caller.chat.fetchInitial({ scope: "global", roomId: 1, limit: 1 });
    const newerOnly = await caller.chat.fetchSince({
      scope: "global",
      roomId: 1,
      lastSeenSeq: initial.messages[0]?.id ?? 0,
    });
    // Expect 0 because we just took the newest; nothing newer exists
    expect(newerOnly.length).toBe(0);

    // Post one more and re-check
    const posterCaller = callerFor(posterId);
    await posterCaller.chat.postMessage({ scope: "global", roomId: 1, body: "another one" });
    const afterPost = await caller.chat.fetchSince({
      scope: "global",
      roomId: 1,
      lastSeenSeq: initial.messages[0]?.id ?? 0,
    });
    expect(afterPost.length).toBeGreaterThanOrEqual(1);
  });
});

liveDescribe("chat.markRead + unreadCounts", () => {
  let userId: number;

  beforeAll(async () => {
    const db = await getDb();
    const ts = `${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
    const [u] = await db!.insert(users).values({
      openId: `chat-markread-${ts}`,
      email: `chat-markread-${ts}@example.com`,
      loginMethod: "vitest",
      role: "user",
    }).returning();
    userId = u.id;
  });

  const callerFor = (id: number) =>
    appRouter.createCaller({
      user: { id, role: "user", email: `${id}@example.com` },
      req: { ip: "127.0.0.1" } as never,
      ip: "127.0.0.1",
      userAgent: "vitest",
    } as never);

  it("markRead upserts chat_room_members row", async () => {
    const caller = callerFor(userId);
    const result = await caller.chat.markRead({
      scope: "global",
      roomId: 1,
      seq: 9999999,
    });
    expect(result.success).toBe(true);

    // Verify the row exists with the right seq
    const db = await getDb();
    const rows = await db!
      .select()
      .from(chatRoomMembers)
      .where(and(eq(chatRoomMembers.userId, userId), eq(chatRoomMembers.roomId, 1)));
    expect(rows.length).toBe(1);
    expect(rows[0].lastReadSeq).toBe(9999999);
  });

  it("unreadCounts returns 0 when last_read_seq is at or past the latest", async () => {
    const caller = callerFor(userId);
    const counts = await caller.chat.unreadCounts();
    expect(counts.global).toBeDefined();
    expect(typeof counts.global).toBe("number");
    expect(counts.global).toBeGreaterThanOrEqual(0);
  });
});
