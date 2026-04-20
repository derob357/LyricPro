import { eq } from "drizzle-orm";
import { drizzle } from "drizzle-orm/mysql2";
import mysql from "mysql2";
import { InsertUser, users } from "../drizzle/schema";
import { ENV } from './_core/env';
let _db: ReturnType<typeof drizzle> | null = null;
// Use a connection pool so stale connections after sandbox hibernation are
// automatically replaced instead of causing a one-time failure.
export async function getDb() {
  if (!_db && process.env.DATABASE_URL) {
    try {
      const pool = mysql.createPool({
        uri: process.env.DATABASE_URL,
        waitForConnections: true,
        connectionLimit: 10,
        enableKeepAlive: true,
        keepAliveInitialDelay: 10000,
      });
      _db = drizzle(pool);
    } catch (error) {
      console.warn("[Database] Failed to connect:", error);
      _db = null;
    }
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
    const values: InsertUser = {
      openId: user.openId,
    };
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
      // Only set on insert (don't overwrite user-edited names)
      values.firstName = derivedFirst;
      values.lastName = derivedLast;
      // Don't add to updateSet — preserve user-edited names on subsequent logins
    }

    // Allow explicit firstName/lastName updates (e.g. from profile update mutation)
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
      values.role = 'admin';
      updateSet.role = 'admin';
    }

    if (!values.lastSignedIn) {
      values.lastSignedIn = new Date();
    }

    if (Object.keys(updateSet).length === 0) {
      updateSet.lastSignedIn = new Date();
    }

    await db.insert(users).values(values).onDuplicateKeyUpdate({
      set: updateSet,
    });
  } catch (error) {
    // Avoid logging the raw error — MySQL errors can echo parameter values
    // including email addresses and OAuth identifiers.
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

  const result = await db.select().from(users).where(eq(users.openId, openId)).limit(1);

  return result.length > 0 ? result[0] : undefined;
}

// TODO: add feature queries here as your schema grows.
