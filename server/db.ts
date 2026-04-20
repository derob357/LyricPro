import { eq, sql } from "drizzle-orm";
import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import { InsertUser, users } from "../drizzle/schema";
import { ENV } from "./_core/env";

type DrizzleDb = ReturnType<typeof drizzle>;
let _db: DrizzleDb | null = null;
let _client: ReturnType<typeof postgres> | null = null;

// App runtime uses the pooled URL (port 6543, pgBouncer transaction mode) —
// required for serverless. Migrations use the direct URL instead.
// Connection is lazily created on first call.
export async function getDb(): Promise<DrizzleDb | null> {
  if (_db) return _db;
  const url =
    process.env.SUPABASE_TRANSACTION_POOLER_STRING ??
    process.env.DATABASE_URL;
  if (!url) return null;
  try {
    _client = postgres(url, {
      // Reasonable defaults for Vercel serverless + Supabase pooler. Short
      // idle timeout so idle connections are returned to the pool; the pool
      // handles re-opening on next use.
      max: 10,
      idle_timeout: 20,
      connect_timeout: 10,
      // Supabase's pgbouncer doesn't support prepared statements in
      // transaction mode. Drizzle's postgres-js driver respects this flag.
      prepare: false,
    });
    _db = drizzle(_client);
  } catch (error) {
    console.warn(
      "[Database] Failed to connect:",
      error instanceof Error ? error.message : "unknown"
    );
    _db = null;
  }
  return _db;
}

export async function upsertUser(user: InsertUser): Promise<void> {
  if (!user.openId) {
    throw new Error("User openId is required for upsert");
  }

  const db = await getDb();
  if (!db) {
    console.warn("[Database] Cannot upsert user: database not available");
    return;
  }

  try {
    const values: InsertUser = { openId: user.openId };
    const updateSet: Record<string, unknown> = {};

    const textFields = ["name", "email", "loginMethod"] as const;
    type TextField = (typeof textFields)[number];

    const assignNullable = (field: TextField) => {
      const value = user[field];
      if (value === undefined) return;
      const normalized = value ?? null;
      values[field] = normalized;
      updateSet[field] = normalized;
    };

    textFields.forEach(assignNullable);

    // Auto-split name into firstName/lastName if not already set
    if (user.name) {
      const parts = user.name.trim().split(/\s+/);
      const derivedFirst = parts[0] || null;
      const derivedLast = parts.length > 1 ? parts.slice(1).join(" ") : null;
      values.firstName = derivedFirst;
      values.lastName = derivedLast;
      // Don't add to updateSet — preserve user-edited names on subsequent logins
    }

    if (user.firstName !== undefined) {
      values.firstName = user.firstName ?? null;
      updateSet.firstName = user.firstName ?? null;
    }
    if (user.lastName !== undefined) {
      values.lastName = user.lastName ?? null;
      updateSet.lastName = user.lastName ?? null;
    }

    if (user.lastSignedIn !== undefined) {
      values.lastSignedIn = user.lastSignedIn;
      updateSet.lastSignedIn = user.lastSignedIn;
    }
    if (user.role !== undefined) {
      values.role = user.role;
      updateSet.role = user.role;
    } else if (user.openId === ENV.ownerOpenId) {
      values.role = "admin";
      updateSet.role = "admin";
    }

    if (!values.lastSignedIn) values.lastSignedIn = new Date();
    if (Object.keys(updateSet).length === 0) {
      updateSet.lastSignedIn = new Date();
    }

    // Postgres upsert: INSERT ... ON CONFLICT (openId) DO UPDATE SET ...
    await db
      .insert(users)
      .values(values)
      .onConflictDoUpdate({ target: users.openId, set: updateSet });
  } catch (error) {
    console.error(
      "[Database] Failed to upsert user:",
      error instanceof Error ? error.message : "unknown"
    );
    throw error;
  }
}

export async function getUserByOpenId(openId: string) {
  const db = await getDb();
  if (!db) {
    console.warn("[Database] Cannot get user: database not available");
    return undefined;
  }

  const result = await db
    .select()
    .from(users)
    .where(eq(users.openId, openId))
    .limit(1);

  return result.length > 0 ? result[0] : undefined;
}

// Expose a health-check-friendly query for ops.
export async function pingDb(): Promise<boolean> {
  const db = await getDb();
  if (!db) return false;
  try {
    await db.execute(sql`select 1`);
    return true;
  } catch {
    return false;
  }
}
