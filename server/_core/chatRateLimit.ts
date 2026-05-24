// Per-user chat post rate limiter. Backed by Upstash Redis when env is
// configured; no-op otherwise (lets dev run without a Redis dependency).
// In prod, this should be promoted to Vercel Edge Middleware in Phase 2 so
// rate-limit denials don't even hit a Lambda invocation. For Phase 1 the
// wrapper exists and is unit-tested; the call site lands in Phase 2.
import { TRPCError } from "@trpc/server";
import { Ratelimit } from "@upstash/ratelimit";
import { Redis } from "@upstash/redis";

let _limiter: Ratelimit | null = null;
let _initialized = false;

function getLimiter(): Ratelimit | null {
  if (_initialized) return _limiter;
  _initialized = true;

  if (!process.env.UPSTASH_REDIS_REST_URL || !process.env.UPSTASH_REDIS_REST_TOKEN) {
    return null;
  }

  _limiter = new Ratelimit({
    redis: Redis.fromEnv(),
    limiter: Ratelimit.tokenBucket(5, "10 s", 10),
    prefix: "chat:post",
    analytics: false,
  });
  return _limiter;
}

export async function enforceChatRateLimit(userKey: string): Promise<void> {
  const limiter = getLimiter();
  if (!limiter) return; // no-op when not configured

  const { success, reset } = await limiter.limit(userKey);
  if (!success) {
    const retryAfter = Math.max(1, Math.ceil(reset - Date.now() / 1000));
    throw new TRPCError({
      code: "TOO_MANY_REQUESTS",
      message: `Slow down — try again in ${retryAfter}s.`,
    });
  }
}

// Test-only — resets cached limiter so env-var swaps in tests take effect.
export function __resetForTest(): void {
  _limiter = null;
  _initialized = false;
}
