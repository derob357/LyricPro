import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { getDb } from "../db";
import { chatBans, users } from "../../drizzle/schema";
import { eq } from "drizzle-orm";
import { getActiveBan, type BanCheckScope } from "./chatBans";

const DB_URL =
  process.env.SUPABASE_SESSION_POOLER_STRING ??
  process.env.SUPABASE_DIRECT_CONNECTION_STRING ??
  process.env.DATABASE_URL;
const liveDescribe = DB_URL ? describe : describe.skip;

liveDescribe("getActiveBan", () => {
  let testUserId: number;
  let adminId: number;

  beforeAll(async () => {
    const db = await getDb();
    if (!db) throw new Error("DB not available");
    // Seed: create one regular user + one admin.
    const [u] = await db.insert(users).values({
      email: "chatbans-test@example.com",
      role: "user",
    }).returning();
    testUserId = u.id;
    const [a] = await db.insert(users).values({
      email: "chatbans-admin@example.com",
      role: "admin",
    }).returning();
    adminId = a.id;
  });

  afterAll(async () => {
    const db = await getDb();
    if (!db) return;
    await db.delete(users).where(eq(users.id, testUserId));
    await db.delete(users).where(eq(users.id, adminId));
  });

  it("returns null when no bans exist", async () => {
    const result = await getActiveBan(testUserId, { kind: "global" });
    expect(result).toBeNull();
  });

  it("returns the active global ban", async () => {
    const db = await getDb();
    const [ban] = await db!.insert(chatBans).values({
      userId: testUserId,
      scope: "global",
      action: "ban",
      reason: "test",
      createdBy: adminId,
    }).returning();
    try {
      const result = await getActiveBan(testUserId, { kind: "global" });
      expect(result?.id).toBe(ban.id);
      expect(result?.action).toBe("ban");
    } finally {
      await db!.delete(chatBans).where(eq(chatBans.id, ban.id));
    }
  });

  it("ignores expired bans", async () => {
    const db = await getDb();
    const yesterday = new Date(Date.now() - 24 * 60 * 60 * 1000);
    const [ban] = await db!.insert(chatBans).values({
      userId: testUserId,
      scope: "global",
      action: "ban",
      reason: "expired",
      createdBy: adminId,
      expiresAt: yesterday,
    }).returning();
    try {
      const result = await getActiveBan(testUserId, { kind: "global" });
      expect(result).toBeNull();
    } finally {
      await db!.delete(chatBans).where(eq(chatBans.id, ban.id));
    }
  });

  it("ignores revoked bans", async () => {
    const db = await getDb();
    const [ban] = await db!.insert(chatBans).values({
      userId: testUserId,
      scope: "global",
      action: "ban",
      reason: "revoked",
      createdBy: adminId,
      revokedAt: new Date(),
      revokedBy: adminId,
    }).returning();
    try {
      const result = await getActiveBan(testUserId, { kind: "global" });
      expect(result).toBeNull();
    } finally {
      await db!.delete(chatBans).where(eq(chatBans.id, ban.id));
    }
  });

  it("scopes per-room ban to the correct room", async () => {
    const db = await getDb();
    const [ban] = await db!.insert(chatBans).values({
      userId: testUserId,
      scope: "room",
      roomId: 1,        // assumes global room id=1 from seed
      action: "ban",
      reason: "room ban",
      createdBy: adminId,
    }).returning();
    try {
      const inRoom = await getActiveBan(testUserId, { kind: "room", roomId: 1 });
      expect(inRoom?.id).toBe(ban.id);
      const otherRoom = await getActiveBan(testUserId, { kind: "room", roomId: 999 });
      expect(otherRoom).toBeNull();
      const globalCheck = await getActiveBan(testUserId, { kind: "global" });
      expect(globalCheck).toBeNull();
    } finally {
      await db!.delete(chatBans).where(eq(chatBans.id, ban.id));
    }
  });

  it("returns visible mute as a separate flavor", async () => {
    const db = await getDb();
    const [ban] = await db!.insert(chatBans).values({
      userId: testUserId,
      scope: "global",
      action: "mute_visible",
      reason: "muted",
      createdBy: adminId,
    }).returning();
    try {
      const result = await getActiveBan(testUserId, { kind: "global" });
      expect(result?.action).toBe("mute_visible");
    } finally {
      await db!.delete(chatBans).where(eq(chatBans.id, ban.id));
    }
  });
});
