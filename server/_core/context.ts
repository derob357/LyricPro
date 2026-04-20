import type { CreateExpressContextOptions } from "@trpc/server/adapters/express";
import type { User } from "../../drizzle/schema";
import { authenticateRequest } from "./supabase-auth";
import { upsertUser, getUserByOpenId } from "../db";

export type TrpcContext = {
  req: CreateExpressContextOptions["req"];
  res: CreateExpressContextOptions["res"];
  user: User | null;
};

// Synthesize a deterministic dev user when DEV_AUTH_BYPASS is enabled and
// no real Supabase session is present. Gated to non-production so this
// code path is physically inoperable in prod.
const DEV_USER_OPEN_ID = "dev-bypass-user";
let devUserCache: User | null = null;
async function getOrCreateDevUser(): Promise<User | null> {
  if (devUserCache) return devUserCache;
  try {
    const existing = await getUserByOpenId(DEV_USER_OPEN_ID);
    if (existing) {
      devUserCache = existing;
      return existing;
    }
    await upsertUser({
      openId: DEV_USER_OPEN_ID,
      name: "Dev User",
      firstName: "Dev",
      lastName: "User",
      email: "dev@local",
      loginMethod: "dev-bypass",
      role: "admin",
    });
    const fetched = await getUserByOpenId(DEV_USER_OPEN_ID);
    devUserCache = fetched ?? null;
    return devUserCache;
  } catch (err) {
    console.warn(
      "[DevBypass] Failed to create dev user:",
      err instanceof Error ? err.message : "unknown"
    );
    return null;
  }
}

export async function createContext(
  opts: CreateExpressContextOptions
): Promise<TrpcContext> {
  let user: User | null = null;

  try {
    user = await authenticateRequest(opts.req);
  } catch {
    user = null;
  }

  if (
    !user &&
    process.env.DEV_AUTH_BYPASS === "1" &&
    process.env.NODE_ENV !== "production"
  ) {
    user = await getOrCreateDevUser();
  }

  return {
    req: opts.req,
    res: opts.res,
    user,
  };
}
