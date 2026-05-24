// Smoke test for the broadcast-from-DB trigger pipeline. Verifies that
// inserting a row into chat_messages causes the trigger to run without
// erroring and the row lands. Doesn't verify the broadcast actually
// reaches a websocket client — that's Phase 2's job once a real channel
// subscription exists.
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { getDb } from "../db";
import { chatMessages, chatRooms, users } from "../../drizzle/schema";
import { eq, sql } from "drizzle-orm";

const DB_URL =
  process.env.SUPABASE_SESSION_POOLER_STRING ??
  process.env.SUPABASE_DIRECT_CONNECTION_STRING ??
  process.env.DATABASE_URL;
const liveDescribe = DB_URL ? describe : describe.skip;

liveDescribe("chat realtime trigger pipeline", () => {
  let testUserId: number;
  let globalRoomId: number;

  beforeAll(async () => {
    const db = await getDb();
    if (!db) throw new Error("DB not available");
    const stamp = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    const [u] = await db.insert(users).values({
      openId: `realtime-smoke-${stamp}`,
      email: `realtime-smoke-${stamp}@example.com`,
      loginMethod: "vitest",
      role: "user",
    }).returning();
    testUserId = u.id;

    const [room] = await db
      .select()
      .from(chatRooms)
      .where(eq(chatRooms.kind, "global"))
      .limit(1);
    if (!room) throw new Error("Global chat_rooms row missing — migration 0013 not seeded.");
    globalRoomId = room.id;
  });

  afterAll(async () => {
    const db = await getDb();
    if (!db) return;
    await db.delete(chatMessages).where(eq(chatMessages.authorId, testUserId));
    await db.delete(users).where(eq(users.id, testUserId));
  });

  it("INSERT into chat_messages succeeds without trigger error", async () => {
    const db = await getDb();
    const [msg] = await db!
      .insert(chatMessages)
      .values({
        scope: "global",
        roomId: globalRoomId,
        authorId: testUserId,
        body: "smoke test message",
      })
      .returning();

    expect(msg).toBeDefined();
    expect(msg.id).toBeGreaterThan(0);
    expect(msg.scope).toBe("global");
  });

  it("UPDATE that doesn't change tracked columns does not error", async () => {
    const db = await getDb();
    // The update-trigger checks specific columns; a no-op-ish update
    // should still RETURN NEW without crashing.
    await db!.execute(sql`UPDATE chat_messages SET "createdAt" = "createdAt" WHERE author_id = ${testUserId}`);
  });

  it("UPDATE that soft-deletes broadcasts (no client check; trigger must not raise)", async () => {
    const db = await getDb();
    await db!
      .update(chatMessages)
      .set({ deletedAt: new Date(), deletedReason: "smoke" })
      .where(eq(chatMessages.authorId, testUserId));
  });
});
