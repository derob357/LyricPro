import { TRPCError } from "@trpc/server";

// Per-key token-bucket rate limiter. Process-local (good enough for a
// single-node deployment; swap for Redis-backed bucket before horizontal
// scaling). Keys are typically user id, guest token, or client IP.

type Bucket = { count: number; windowStart: number };
const BUCKETS = new Map<string, Map<string | number, Bucket>>();

type Config = { max: number; windowMs: number };

export function rateLimit(name: string, key: string | number, cfg: Config) {
  if (!BUCKETS.has(name)) BUCKETS.set(name, new Map());
  const ns = BUCKETS.get(name)!;
  const now = Date.now();
  const b = ns.get(key);
  if (!b || now - b.windowStart > cfg.windowMs) {
    ns.set(key, { count: 1, windowStart: now });
    return;
  }
  b.count++;
  if (b.count > cfg.max) {
    throw new TRPCError({
      code: "TOO_MANY_REQUESTS",
      message: "Too many requests. Please slow down and try again shortly.",
    });
  }
}

// Prune stale buckets every 5 minutes so the Map doesn't grow unbounded
// under heavy load. Runs in-process; cheap.
const PRUNE_INTERVAL_MS = 5 * 60 * 1000;
setInterval(() => {
  const now = Date.now();
  BUCKETS.forEach(ns => {
    ns.forEach((b, key) => {
      // drop buckets older than 30 minutes
      if (now - b.windowStart > 30 * 60 * 1000) ns.delete(key);
    });
  });
}, PRUNE_INTERVAL_MS).unref?.();
