import type { CreateExpressContextOptions } from "@trpc/server/adapters/express";
import type { User } from "../../drizzle/schema";
import { authenticateRequest } from "./supabase-auth";
import { upsertUser, getUserByOpenId } from "../db";

export type TrpcContext = {
  req: CreateExpressContextOptions["req"];
  res: CreateExpressContextOptions["res"];
  user: User | null;
  ip: string | undefined;
  userAgent: string | undefined;
  requestId: string | undefined;
  countryCode: string | undefined;
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

  // Client IP for audit logging. Use Express's req.ip: with `trust proxy = 1`
  // (see index.ts) it resolves to the client address Vercel appended to
  // X-Forwarded-For, NOT the attacker-controllable leftmost XFF value a client
  // can set by sending its own X-Forwarded-For header. This matches the
  // ctx.req.ip that rate limiting and consent stamps already key on.
  const ip = opts.req.ip ?? undefined;
  const userAgent = opts.req.headers["user-agent"] as string | undefined;
  const requestId =
    (opts.req.headers["x-request-id"] as string | undefined) ??
    (opts.req.headers["x-vercel-id"] as string | undefined) ??
    undefined;
  const countryCode =
    (opts.req.headers["x-vercel-ip-country"] as string | undefined) ??
    undefined;

  return {
    req: opts.req,
    res: opts.res,
    user,
    ip,
    userAgent,
    requestId,
    countryCode,
  };
}
