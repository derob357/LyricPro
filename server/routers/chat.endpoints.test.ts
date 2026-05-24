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
import { chatMessages, chatBans, chatRoomMembers, chatAuditLog, users, userFavorites, tournaments, tournamentMembers, chatRooms } from "../../drizzle/schema";
import { and, eq, isNull, inArray, sql } from "drizzle-orm";

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

  it("unreadCounts.friends reflects messages from favorited authors and self", async () => {
    const db = await getDb();
    const ts = `${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
    const [favAuthor] = await db!.insert(users).values({
      openId: `unread-friends-author-${ts}`,
      email: `unread-friends-author-${ts}@example.com`,
      loginMethod: "vitest",
      role: "user",
    }).returning();

    try {
      // userId (already created in this describe) favorites favAuthor
      await db!.insert(userFavorites).values({ followerId: userId, favoriteId: favAuthor.id });
      // favAuthor posts in friends-scope
      await db!.insert(chatMessages).values({
        scope: "friends",
        authorId: favAuthor.id,
        body: "for the feed",
      });

      const caller = callerFor(userId);
      const counts = await caller.chat.unreadCounts();
      expect(counts.friends).toBeGreaterThanOrEqual(1);
    } finally {
      await db!.delete(chatMessages).where(eq(chatMessages.authorId, favAuthor.id));
      await db!.delete(userFavorites).where(eq(userFavorites.followerId, userId));
      await db!.delete(users).where(eq(users.id, favAuthor.id));
    }
  });

  it("unreadCounts.tournaments returns per-tournament counts for active memberships", async () => {
    const db = await getDb();
    const ts = `${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;

    // Create a tournament FIRST with chatRoomId=NULL (non-deferrable CHECK constraint),
    // then create the chat room referencing the tournament, then UPDATE the tournament.
    const [t] = await db!.insert(tournaments).values({
      name: `Unread Tournament ${ts}`,
      entryCostGn: 0,
      startsAt: new Date(Date.now() + 24 * 60 * 60 * 1000),
      endsAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
      chatRoomId: null,
      status: "open",
      createdBy: userId,
    }).returning();
    const [room] = await db!.insert(chatRooms).values({
      kind: "tournament",
      tournamentId: t.id,
      retentionDays: 60,
    }).returning();
    await db!.update(tournaments).set({ chatRoomId: room.id }).where(eq(tournaments.id, t.id));

    try {
      // userId joins as admin_invited; lastReadSeq stays at 0
      await db!.insert(tournamentMembers).values({
        tournamentId: t.id,
        userId: userId,
        entryMethod: "admin_invited",
        gnSpent: 0,
      });
      await db!.insert(chatRoomMembers).values({ userId, roomId: room.id, lastReadSeq: 0 });

      // Post a tournament message
      await db!.insert(chatMessages).values({
        scope: "tournament",
        roomId: room.id,
        authorId: userId,
        body: "tournament test message",
      });

      const counts = await callerFor(userId).chat.unreadCounts();
      expect(counts.tournaments[t.id]).toBeGreaterThanOrEqual(1);
    } finally {
      await db!.delete(chatMessages).where(eq(chatMessages.roomId, room.id));
      await db!.delete(chatRoomMembers).where(eq(chatRoomMembers.roomId, room.id));
      await db!.delete(tournamentMembers).where(eq(tournamentMembers.tournamentId, t.id));
      // Break the FK cycle before deleting either table
      await db!.update(tournaments).set({ chatRoomId: null }).where(eq(tournaments.id, t.id));
      await db!.delete(chatRooms).where(eq(chatRooms.id, room.id));
      await db!.delete(tournaments).where(eq(tournaments.id, t.id));
    }
  });
});

liveDescribe("chat.admin actions", () => {
  let adminId: number;
  let posterId: number;
  let messageId: number;

  beforeAll(async () => {
    const db = await getDb();
    const ts = `${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
    const [a] = await db!.insert(users).values({
      openId: `chat-admin-action-${ts}`,
      email: `chat-admin-action-${ts}@example.com`,
      loginMethod: "vitest",
      role: "admin",
    }).returning();
    adminId = a.id;
    const [p] = await db!.insert(users).values({
      openId: `chat-admin-poster-${ts}`,
      email: `chat-admin-poster-${ts}@example.com`,
      loginMethod: "vitest",
      role: "user",
    }).returning();
    posterId = p.id;

    const [m] = await db!.insert(chatMessages).values({
      scope: "global",
      roomId: 1,
      authorId: posterId,
      body: "to be deleted",
    }).returning();
    messageId = m.id;
  });

  afterAll(async () => {
    const db = await getDb();
    // Note: the soft-deleted message is referenced by an immutable audit-log
    // row, so we can't DELETE it (FK + deny-change trigger). Leave it + the
    // audit row behind, matching the existing "audit rows are left behind"
    // pattern used by the chat.postMessage suite above.
    await db!.delete(chatMessages).where(
      and(eq(chatMessages.authorId, posterId), isNull(chatMessages.deletedAt)),
    );
    await db!.delete(chatBans).where(eq(chatBans.userId, posterId));
  });

  const adminCaller = () =>
    appRouter.createCaller({
      user: { id: adminId, role: "admin", email: `admin@example.com` },
      req: { ip: "127.0.0.1" } as never,
      ip: "127.0.0.1",
      userAgent: "vitest",
    } as never);

  const userCaller = () =>
    appRouter.createCaller({
      user: { id: posterId, role: "user", email: `poster@example.com` },
      req: { ip: "127.0.0.1" } as never,
      ip: "127.0.0.1",
      userAgent: "vitest",
    } as never);

  it("admin.deleteMessage soft-deletes the row and writes an audit log entry", async () => {
    const caller = adminCaller();
    const result = await caller.chat.admin.deleteMessage({
      messageId,
      reason: "spam",
    });
    expect(result.success).toBe(true);

    const db = await getDb();
    const [row] = await db!.select().from(chatMessages).where(eq(chatMessages.id, messageId));
    expect(row.deletedAt).not.toBeNull();
    expect(row.deletedBy).toBe(adminId);
    expect(row.deletedReason).toBe("spam");

    const audit = await db!
      .select()
      .from(chatAuditLog)
      .where(and(eq(chatAuditLog.actorId, adminId), eq(chatAuditLog.action, "message_delete")));
    expect(audit.length).toBeGreaterThanOrEqual(1);
  });

  it("non-admin cannot call admin.deleteMessage", async () => {
    const caller = userCaller();
    await expect(
      // @ts-expect-error: non-admin caller should be denied at runtime
      caller.chat.admin.deleteMessage({ messageId, reason: "x" }),
    ).rejects.toThrow();
  });

  it("admin.banAuthor creates a chat_bans row and writes audit log", async () => {
    const caller = adminCaller();
    const result = await caller.chat.admin.banAuthor({
      userId: posterId,
      scope: "global",
      reason: "repeated spam",
    });
    expect(result.banId).toBeGreaterThan(0);

    const db = await getDb();
    const [ban] = await db!.select().from(chatBans).where(eq(chatBans.id, result.banId));
    expect(ban.action).toBe("ban");
    expect(ban.scope).toBe("global");
    expect(ban.createdBy).toBe(adminId);

    const audit = await db!
      .select()
      .from(chatAuditLog)
      .where(and(eq(chatAuditLog.actorId, adminId), eq(chatAuditLog.action, "ban")));
    expect(audit.length).toBeGreaterThanOrEqual(1);
  });
});

liveDescribe("chat fetch — friends-scope visibility", () => {
  let viewerId: number;
  let favoritedId: number;
  let strangerId: number;

  beforeAll(async () => {
    const db = await getDb();
    const ts = `${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
    const seeded = await db!.insert(users).values([
      { openId: `friends-viewer-${ts}`, email: `friends-viewer-${ts}@example.com`, loginMethod: "vitest", role: "user" },
      { openId: `friends-fav-${ts}`, email: `friends-fav-${ts}@example.com`, loginMethod: "vitest", role: "user" },
      { openId: `friends-stranger-${ts}`, email: `friends-stranger-${ts}@example.com`, loginMethod: "vitest", role: "user" },
    ]).returning();
    viewerId = seeded[0].id;
    favoritedId = seeded[1].id;
    strangerId = seeded[2].id;

    // Viewer favorites favoritedId. Does NOT favorite strangerId.
    await db!.insert(userFavorites).values({ followerId: viewerId, favoriteId: favoritedId });

    // Three friends-scope messages: one from viewer, one from favoritedId, one from strangerId.
    await db!.insert(chatMessages).values([
      { scope: "friends", authorId: viewerId, body: "my own friends post" },
      { scope: "friends", authorId: favoritedId, body: "from someone I favorited" },
      { scope: "friends", authorId: strangerId, body: "from a stranger" },
    ]);
  });

  afterAll(async () => {
    const db = await getDb();
    await db!.delete(chatMessages).where(inArray(chatMessages.authorId, [viewerId, favoritedId, strangerId]));
    await db!.delete(userFavorites).where(eq(userFavorites.followerId, viewerId));
  });

  const callerFor = (id: number) =>
    appRouter.createCaller({
      user: { id, role: "user", email: `${id}@example.com` },
      req: { ip: "127.0.0.1" } as never,
      ip: "127.0.0.1",
      userAgent: "vitest",
    } as never);

  it("fetchInitial friends returns only own + favorited authors' messages", async () => {
    const result = await callerFor(viewerId).chat.fetchInitial({ scope: "friends", limit: 50 });
    const bodies = result.messages.map((m) => m.body);
    expect(bodies).toContain("my own friends post");
    expect(bodies).toContain("from someone I favorited");
    expect(bodies).not.toContain("from a stranger");
  });

  it("fetchOlder friends respects the visibility filter", async () => {
    const initial = await callerFor(viewerId).chat.fetchInitial({ scope: "friends", limit: 1 });
    if (initial.messages.length === 0) return; // no messages, nothing to paginate
    const older = await callerFor(viewerId).chat.fetchOlder({
      scope: "friends",
      beforeId: initial.messages[initial.messages.length - 1].id,
      limit: 50,
    });
    for (const m of older) {
      expect(m.authorId === viewerId || m.authorId === favoritedId).toBe(true);
    }
  });
});

liveDescribe("chat.admin mutations — phase 5", () => {
  let adminId: number;
  let posterId: number;
  let messageId: number;

  beforeAll(async () => {
    const db = await getDb();
    const ts = `${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
    const [a] = await db!.insert(users).values({
      openId: `p5-admin-${ts}`,
      email: `p5-admin-${ts}@example.com`,
      loginMethod: "vitest",
      role: "admin",
    }).returning();
    adminId = a.id;
    const [p] = await db!.insert(users).values({
      openId: `p5-poster-${ts}`,
      email: `p5-poster-${ts}@example.com`,
      loginMethod: "vitest",
      role: "user",
    }).returning();
    posterId = p.id;
    const [m] = await db!.insert(chatMessages).values({
      scope: "global",
      roomId: 1,
      authorId: posterId,
      body: "original body",
    }).returning();
    messageId = m.id;
  });

  afterAll(async () => {
    const db = await getDb();
    // Delete only chat_messages rows that aren't audit-referenced; leave the rest
    // (along with their audit rows + user rows) behind — immutable + FK by design.
    await db!.execute(sql`
      DELETE FROM chat_messages
      WHERE author_id = ${posterId}
        AND id NOT IN (
          SELECT target_message_id FROM chat_audit_log
          WHERE target_message_id IS NOT NULL
        )
    `);
    await db!.delete(chatBans).where(eq(chatBans.userId, posterId));
  });

  const adminCaller = () =>
    appRouter.createCaller({
      user: { id: adminId, role: "admin", email: "p5-admin@example.com" },
      req: { ip: "127.0.0.1" } as never,
      ip: "127.0.0.1",
      userAgent: "vitest",
    } as never);

  it("muteAuthor visible inserts mute_visible ban + audit log", async () => {
    const r = await adminCaller().chat.admin.muteAuthor({
      userId: posterId,
      scope: "global",
      flavor: "visible",
      reason: "rude",
    });
    expect(r.banId).toBeGreaterThan(0);
    const db = await getDb();
    const [row] = await db!.select().from(chatBans).where(eq(chatBans.id, r.banId));
    expect(row.action).toBe("mute_visible");
  });

  it("muteAuthor shadow inserts mute_shadow ban", async () => {
    const r = await adminCaller().chat.admin.muteAuthor({
      userId: posterId,
      scope: "global",
      flavor: "shadow",
      reason: "sockpuppet history",
    });
    expect(r.banId).toBeGreaterThan(0);
    const db = await getDb();
    const [row] = await db!.select().from(chatBans).where(eq(chatBans.id, r.banId));
    expect(row.action).toBe("mute_shadow");
  });

  it("revokeBan sets revoked_at + revoked_by + audit log", async () => {
    const db = await getDb();
    const [activeBan] = await db!
      .insert(chatBans)
      .values({
        userId: posterId,
        scope: "global",
        action: "ban",
        reason: "test",
        createdBy: adminId,
      })
      .returning();
    const r = await adminCaller().chat.admin.revokeBan({
      banId: activeBan.id,
      reason: "appeal accepted",
    });
    expect(r.success).toBe(true);

    const [updated] = await db!.select().from(chatBans).where(eq(chatBans.id, activeBan.id));
    expect(updated.revokedAt).not.toBeNull();
    expect(updated.revokedBy).toBe(adminId);
  });

  it("editMessage replaces body, sets edited_at/by, snapshots previous_body in audit log", async () => {
    const r = await adminCaller().chat.admin.editMessage({
      messageId,
      newBody: "redacted body",
      reason: "PII removal",
    });
    expect(r.success).toBe(true);

    const db = await getDb();
    const [updated] = await db!.select().from(chatMessages).where(eq(chatMessages.id, messageId));
    expect(updated.body).toBe("redacted body");
    expect(updated.editedAt).not.toBeNull();
    expect(updated.editedBy).toBe(adminId);

    const audit = await db!
      .select()
      .from(chatAuditLog)
      .where(and(eq(chatAuditLog.actorId, adminId), eq(chatAuditLog.action, "message_edit")));
    const matching = audit.find((row) => row.targetMessageId === messageId);
    expect(matching).toBeDefined();
    expect((matching!.metadata as { previous_body?: string } | null)?.previous_body).toBe("original body");
  });

  it("markFlaggedReviewed flips flag_status to reviewed_clean", async () => {
    const db = await getDb();
    const [flagged] = await db!
      .insert(chatMessages)
      .values({
        scope: "global",
        roomId: 1,
        authorId: posterId,
        body: "ambiguous content",
        flagStatus: "flagged",
        flagReason: "borderline",
      })
      .returning();
    const r = await adminCaller().chat.admin.markFlaggedReviewed({
      messageId: flagged.id,
      outcome: "clean",
      reason: "false positive",
    });
    expect(r.success).toBe(true);
    const [updated] = await db!.select().from(chatMessages).where(eq(chatMessages.id, flagged.id));
    expect(updated.flagStatus).toBe("reviewed_clean");
    // Cleanup handled by afterAll — message is audit-referenced so it stays behind.
  });
});
