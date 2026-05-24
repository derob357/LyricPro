import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { getDb } from "../db";
import { chatAuditLog, users } from "../../drizzle/schema";
import { eq, sql } from "drizzle-orm";
import { recordChatAction } from "./chatAudit";

const DB_URL =
  process.env.SUPABASE_SESSION_POOLER_STRING ??
  process.env.SUPABASE_DIRECT_CONNECTION_STRING ??
  process.env.DATABASE_URL;
const liveDescribe = DB_URL ? describe : describe.skip;

// Tagged actor_role for this test run so leaked rows are identifiable.
// chat_audit_log is append-only (deny-change trigger from migration 0013),
// so the test row inserted below cannot be deleted in afterAll.
const ACTOR_ROLE_TAG = "vitest-chataudit-admin";

liveDescribe("recordChatAction", () => {
  let adminId: number;
  let targetId: number;

  beforeAll(async () => {
    const db = await getDb();
    if (!db) throw new Error("DB not available");
    const stamp = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    const [a] = await db.insert(users).values({
      openId: `chataudit-admin-${stamp}`,
      email: `audit-admin-${stamp}@example.com`,
      loginMethod: "vitest",
      role: "admin",
    }).returning();
    adminId = a.id;
    const [t] = await db.insert(users).values({
      openId: `chataudit-target-${stamp}`,
      email: `audit-target-${stamp}@example.com`,
      loginMethod: "vitest",
      role: "user",
    }).returning();
    targetId = t.id;
  });

  afterAll(async () => {
    // The first test inserts an audit row that cannot be deleted (chat_audit_log
    // is append-only by design — see migration 0013's deny-change trigger). The
    // audit row also FK-references both seeded users, so we cannot delete them
    // either without first deleting the audit row. This test is intentionally
    // leaky: each run adds one audit row + two users, all stamped with a unique
    // openId/email and tagged with actor_role = "vitest-chataudit-admin" so the
    // leaked artifacts are identifiable and re-runs do not collide.
  });

  it("writes a row with all required fields", async () => {
    const db = await getDb();
    await db!.transaction(async (tx) => {
      await recordChatAction({
        tx,
        actorId: adminId,
        actorRole: ACTOR_ROLE_TAG,
        action: "ban",
        targetUserId: targetId,
        scope: "global",
        reason: "test ban",
        metadata: { test: true },
        ip: "127.0.0.1",
        userAgent: "vitest",
      });
    });

    const rows = await db!
      .select()
      .from(chatAuditLog)
      .where(eq(chatAuditLog.actorId, adminId));

    expect(rows.length).toBe(1);
    expect(rows[0].action).toBe("ban");
    expect(rows[0].targetUserId).toBe(targetId);
    expect(rows[0].reason).toBe("test ban");
    expect(rows[0].metadata).toEqual({ test: true });
  });

  // Drizzle wraps the underlying PG error as `Failed query: ...` in .message;
  // the trigger's RAISE EXCEPTION text lives on .cause.message. We walk the
  // cause chain (and fall back to a JSON dump) to assert on the trigger text.
  function errorChainText(err: unknown): string {
    const parts: string[] = [];
    let cur: unknown = err;
    let depth = 0;
    while (cur && depth < 10) {
      const e = cur as { message?: unknown; cause?: unknown };
      if (typeof e.message === "string") parts.push(e.message);
      cur = e.cause;
      depth += 1;
    }
    try {
      parts.push(JSON.stringify(err, Object.getOwnPropertyNames(err as object)));
    } catch {
      // ignore
    }
    return parts.join(" | ");
  }

  it("UPDATE on chat_audit_log is rejected at the DB level (immutability)", async () => {
    const db = await getDb();
    let caught: unknown;
    try {
      await db!.execute(
        sql`UPDATE chat_audit_log SET reason = 'tampered' WHERE actor_id = ${adminId}`,
      );
    } catch (e) {
      caught = e;
    }
    expect(caught).toBeDefined();
    expect(errorChainText(caught)).toMatch(/immutable|append-only/i);
  });

  it("DELETE on chat_audit_log is rejected at the DB level", async () => {
    const db = await getDb();
    let caught: unknown;
    try {
      await db!.execute(
        sql`DELETE FROM chat_audit_log WHERE actor_id = ${adminId}`,
      );
    } catch (e) {
      caught = e;
    }
    expect(caught).toBeDefined();
    expect(errorChainText(caught)).toMatch(/immutable|append-only/i);
  });
});
