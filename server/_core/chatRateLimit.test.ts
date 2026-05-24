import { describe, it, expect, vi, beforeEach } from "vitest";
import { TRPCError } from "@trpc/server";

// Mock Upstash BEFORE importing the module under test
vi.mock("@upstash/redis", () => ({
  Redis: { fromEnv: vi.fn(() => ({ /* stub */ })) },
}));

const limitMock = vi.fn();
vi.mock("@upstash/ratelimit", () => ({
  Ratelimit: Object.assign(
    vi.fn().mockImplementation(() => ({ limit: limitMock })),
    { tokenBucket: vi.fn(() => ({ /* stub limiter config */ })) },
  ),
}));

import { enforceChatRateLimit, __resetForTest } from "./chatRateLimit";

beforeEach(() => {
  limitMock.mockReset();
  __resetForTest();
});

describe("enforceChatRateLimit", () => {
  it("is a no-op when UPSTASH env vars are unset", async () => {
    const prev = process.env.UPSTASH_REDIS_REST_URL;
    delete process.env.UPSTASH_REDIS_REST_URL;
    try {
      await expect(enforceChatRateLimit("user-123")).resolves.toBeUndefined();
      expect(limitMock).not.toHaveBeenCalled();
    } finally {
      if (prev) process.env.UPSTASH_REDIS_REST_URL = prev;
    }
  });

  it("calls the limiter with the userId as key when env is set", async () => {
    process.env.UPSTASH_REDIS_REST_URL = "https://example.upstash.io";
    process.env.UPSTASH_REDIS_REST_TOKEN = "dummy";
    limitMock.mockResolvedValueOnce({ success: true, reset: 0 });
    await enforceChatRateLimit("user-42");
    expect(limitMock).toHaveBeenCalledWith("user-42");
  });

  it("throws TOO_MANY_REQUESTS when limit exceeded", async () => {
    process.env.UPSTASH_REDIS_REST_URL = "https://example.upstash.io";
    process.env.UPSTASH_REDIS_REST_TOKEN = "dummy";
    limitMock.mockResolvedValueOnce({
      success: false,
      reset: Math.floor(Date.now() / 1000) + 4,
    });
    await expect(enforceChatRateLimit("user-99")).rejects.toThrowError(TRPCError);
  });
});
