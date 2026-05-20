/**
 * LiveKit Cloud SDK wrapper for the LyricPro server.
 *
 * Responsibilities:
 *   - Mint short-lived access tokens for clients (server-side only — the API
 *     secret never leaves this process).
 *   - Generate unique room names for new game rooms.
 *   - Provide a thin RoomServiceClient for admin operations (delete room,
 *     list participants) — used by later phases.
 *
 * Security:
 *   - Token TTL is hard-capped at MAX_TOKEN_TTL_SECONDS (15 min).
 *   - Room names must match ALLOWED_ROOM_NAME_PATTERN (prevents accidental
 *     injection into LiveKit's URL routing).
 *   - Identity must be non-empty (LiveKit allows empty, but that lets two
 *     clients accidentally share a presence slot).
 */
import { AccessToken, RoomServiceClient } from "livekit-server-sdk";
import { randomBytes } from "node:crypto";

export const MAX_TOKEN_TTL_SECONDS = 15 * 60; // 15 minutes
const ALLOWED_ROOM_NAME_PATTERN = /^lp_[a-f0-9]{32}$/;

export interface MintTokenInput {
  roomName: string;
  identity: string;
  name: string;
  ttlSeconds: number;
}

function requireEnv(name: string): string {
  const value = process.env[name];
  if (!value) {
    throw new Error(`Missing required env var: ${name}`);
  }
  return value;
}

/**
 * Mints a JWT access token granting the holder permission to join a specific
 * LiveKit room as a specific identity. Token expires after ttlSeconds.
 */
export async function mintLiveKitToken(input: MintTokenInput): Promise<string> {
  const { roomName, identity, name, ttlSeconds } = input;

  if (!identity || identity.trim().length === 0) {
    throw new Error("identity must be a non-empty string");
  }
  if (!Number.isFinite(ttlSeconds) || ttlSeconds <= 0 || ttlSeconds > MAX_TOKEN_TTL_SECONDS) {
    throw new Error(
      `ttlSeconds must be between 1 and ${MAX_TOKEN_TTL_SECONDS} (got ${ttlSeconds})`,
    );
  }
  if (!ALLOWED_ROOM_NAME_PATTERN.test(roomName)) {
    throw new Error(
      `Invalid room name: ${roomName} (must match ${ALLOWED_ROOM_NAME_PATTERN})`,
    );
  }

  const apiKey = requireEnv("LIVEKIT_API_KEY");
  const apiSecret = requireEnv("LIVEKIT_API_SECRET");

  const at = new AccessToken(apiKey, apiSecret, {
    identity,
    name,
    ttl: ttlSeconds,
  });
  at.addGrant({
    roomJoin: true,
    room: roomName,
    canPublish: true,
    canSubscribe: true,
    canPublishData: true,
  });
  return at.toJwt();
}

/**
 * Generates a cryptographically random room name suitable for LiveKit.
 * Format: lp_<32 hex chars>, e.g. lp_8f3a1c... (135 bits of entropy).
 */
export function generateRoomName(): string {
  return `lp_${randomBytes(16).toString("hex")}`;
}

/**
 * Returns a server-side admin client. Use sparingly; most flows should mint a
 * client-side token instead. Only callable from server code.
 */
export function getRoomService(): RoomServiceClient {
  const apiKey = requireEnv("LIVEKIT_API_KEY");
  const apiSecret = requireEnv("LIVEKIT_API_SECRET");
  // RoomServiceClient takes the HTTPS host, not the wss:// URL.
  const host = requireEnv("LIVEKIT_URL").replace(/^wss:\/\//, "https://");
  return new RoomServiceClient(host, apiKey, apiSecret);
}
