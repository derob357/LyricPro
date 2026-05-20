import { describe, it, expect, beforeEach } from "vitest";
import { mintLiveKitToken, generateRoomName, MAX_TOKEN_TTL_SECONDS } from "./livekit";

describe("livekit token minting", () => {
  beforeEach(() => {
    process.env.LIVEKIT_API_KEY = "test_key_at_least_20_chars_long";
    process.env.LIVEKIT_API_SECRET = "test_secret_at_least_20_chars_long";
    process.env.LIVEKIT_URL = "wss://example.livekit.cloud";
  });

  it("mints a JWT with required claims", async () => {
    const token = await mintLiveKitToken({
      roomName: "lp_" + "a".repeat(32),
      identity: "user_42",
      name: "Alice",
      ttlSeconds: 900,
    });
    expect(token).toMatch(/^eyJ/);
    expect(token.split(".")).toHaveLength(3);
    const payload = JSON.parse(
      Buffer.from(token.split(".")[1], "base64url").toString("utf8"),
    );
    expect(payload.video.room).toBe("lp_" + "a".repeat(32));
    expect(payload.video.roomJoin).toBe(true);
    expect(payload.sub).toBe("user_42");
    expect(payload.name).toBe("Alice");
  });

  it("rejects ttlSeconds above MAX_TOKEN_TTL_SECONDS", async () => {
    await expect(
      mintLiveKitToken({
        roomName: "lp_" + "a".repeat(32),
        identity: "user_42",
        name: "Alice",
        ttlSeconds: MAX_TOKEN_TTL_SECONDS + 1,
      }),
    ).rejects.toThrow(/ttl/i);
  });

  it("rejects empty identity (would let unknown clients join)", async () => {
    await expect(
      mintLiveKitToken({
        roomName: "lp_" + "a".repeat(32),
        identity: "",
        name: "Alice",
        ttlSeconds: 900,
      }),
    ).rejects.toThrow(/identity/i);
  });

  it("rejects room name with illegal characters", async () => {
    await expect(
      mintLiveKitToken({
        roomName: "room with spaces",
        identity: "user_42",
        name: "Alice",
        ttlSeconds: 900,
      }),
    ).rejects.toThrow(/room name/i);
  });

  it("rejects ttlSeconds=NaN (Number.isFinite guard)", async () => {
    await expect(
      mintLiveKitToken({
        roomName: "lp_" + "a".repeat(32),
        identity: "user_42",
        name: "Alice",
        ttlSeconds: NaN,
      }),
    ).rejects.toThrow(/ttl/i);
  });

  it("rejects whitespace-only identity", async () => {
    await expect(
      mintLiveKitToken({
        roomName: "lp_" + "a".repeat(32),
        identity: "   ",
        name: "Alice",
        ttlSeconds: 900,
      }),
    ).rejects.toThrow(/identity/i);
  });
});

describe("generateRoomName", () => {
  it("returns a 32-char hex string prefixed with 'lp_'", () => {
    const name = generateRoomName();
    expect(name).toMatch(/^lp_[a-f0-9]{32}$/);
  });

  it("returns unique values across calls", () => {
    const names = new Set(Array.from({ length: 100 }, generateRoomName));
    expect(names.size).toBe(100);
  });
});
