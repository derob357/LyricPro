import { describe, it, expect, vi } from "vitest";

// Stripe initialises at module load with STRIPE_SECRET_KEY. Mock it so tests
// that import appRouter don't require a real key in the environment.
vi.mock("stripe", () => {
  const Stripe = vi.fn().mockImplementation(() => ({
    checkout: { sessions: { create: vi.fn() } },
    webhooks: { constructEvent: vi.fn() },
    subscriptions: { retrieve: vi.fn() },
    customers: { search: vi.fn().mockResolvedValue({ data: [] }) },
  }));
  return { default: Stripe };
});

import { appRouter } from "../app-router";
import { getDb } from "../db";
import { gameRooms, roomPlayers, users } from "../../drizzle/schema";
import { eq } from "drizzle-orm";

const DB_URL =
  process.env.SUPABASE_SESSION_POOLER_STRING ??
  process.env.SUPABASE_DIRECT_CONNECTION_STRING ??
  process.env.DATABASE_URL;
const liveDescribe = DB_URL ? describe : describe.skip;

// Ensure LiveKit env vars are present so mintLiveKitToken doesn't throw.
process.env.LIVEKIT_API_KEY ??= "test_key_at_least_20_chars_long";
process.env.LIVEKIT_API_SECRET ??= "test_secret_at_least_20_chars_long";
process.env.LIVEKIT_URL ??= "wss://example.livekit.cloud";

async function makeUser(label: string) {
  const db = await getDb();
  const openId = `vitest-liveroom-${label}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const [u] = await db
    .insert(users)
    .values({
      openId,
      name: `Test ${label}`,
      firstName: `Test${label}`,
      lastName: "User",
      email: `${openId}@test.local`,
      loginMethod: "vitest",
      role: "user",
    })
    .returning();
  return u;
}

function makeCaller(user: { id: number; role: string; email: string | null }) {
  return appRouter.createCaller({
    user: user as any,
    req: {} as any,
    res: {} as any,
    ip: "10.0.0.5",
    userAgent: "vitest",
    requestId: `vitest-liveroom-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    countryCode: "US",
  });
}

async function cleanupRoomByInviteCode(inviteCode: string) {
  const db = await getDb();
  if (!db) return;
  const rows = await db
    .select()
    .from(gameRooms)
    .where(eq(gameRooms.inviteCode, inviteCode))
    .limit(1);
  const room = rows[0];
  if (room) {
    await db.delete(roomPlayers).where(eq(roomPlayers.roomId, room.id));
    await db.delete(gameRooms).where(eq(gameRooms.id, room.id));
  }
}

liveDescribe("liveRoom.createLiveRoom", () => {
  it("creates a video room and returns token + livekitUrl + inviteCode", async () => {
    const host = await makeUser("host1");
    const caller = makeCaller({ id: host.id, role: host.role, email: host.email });
    const result = await caller.liveRoom.createLiveRoom({
      selectedGenres: ["R&B"],
      selectedDecades: ["2000s"],
      difficulty: "medium",
      maxPlayers: 6,
      timerSeconds: 30,
      roundsTotal: 10,
    });
    try {
      expect(result.inviteCode).toMatch(/^[A-Z0-9]{6}$/);
      expect(result.livekitUrl).toMatch(/^wss:\/\//);
      expect(result.token).toMatch(/^eyJ/);
      expect(result.videoRoomName).toMatch(/^lp_[a-f0-9]{32}$/);
      // DB row exists with isVideoRoom=true.
      const db = await getDb();
      if (!db) throw new Error("Database not available");
      const dbRows = await db
        .select()
        .from(gameRooms)
        .where(eq(gameRooms.id, result.roomId))
        .limit(1);
      const row = dbRows[0];
      expect(row?.isVideoRoom).toBe(true);
      expect(row?.mode).toBe("remote_live");
      expect(row?.maxPlayers).toBe(6);
    } finally {
      await cleanupRoomByInviteCode(result.inviteCode);
    }
  });

  it("rejects unauthenticated callers", async () => {
    const caller = appRouter.createCaller({
      user: null,
      req: {} as any,
      res: {} as any,
      ip: "10.0.0.5",
      userAgent: "vitest",
      requestId: "vitest-unauth",
      countryCode: "US",
    });
    await expect(
      caller.liveRoom.createLiveRoom({
        selectedGenres: ["R&B"],
        selectedDecades: ["2000s"],
        difficulty: "medium",
        maxPlayers: 6,
        timerSeconds: 30,
        roundsTotal: 10,
      }),
    ).rejects.toThrow(/login|UNAUTHORIZED/i);
  });

  it("rejects maxPlayers out of range (>8)", async () => {
    const host = await makeUser("host2");
    const caller = makeCaller({ id: host.id, role: host.role, email: host.email });
    await expect(
      caller.liveRoom.createLiveRoom({
        selectedGenres: ["R&B"],
        selectedDecades: ["2000s"],
        difficulty: "medium",
        maxPlayers: 99,
        timerSeconds: 30,
        roundsTotal: 10,
      }),
    ).rejects.toThrow();
  });
});

liveDescribe("liveRoom.joinLiveRoom", () => {
  it("mints a token for a new joiner and adds them to roomPlayers", async () => {
    const host = await makeUser("hostJ");
    const joiner = await makeUser("joinerJ");
    const hostCaller = makeCaller({ id: host.id, role: host.role, email: host.email });
    const created = await hostCaller.liveRoom.createLiveRoom({
      selectedGenres: ["Pop"],
      selectedDecades: ["1990s"],
      difficulty: "medium",
      maxPlayers: 4,
      timerSeconds: 30,
      roundsTotal: 10,
    });
    try {
      const joinerCaller = makeCaller({ id: joiner.id, role: joiner.role, email: joiner.email });
      const result = await joinerCaller.liveRoom.joinLiveRoom({ inviteCode: created.inviteCode });
      expect(result.token).toMatch(/^eyJ/);
      expect(result.videoRoomName).toBe(created.videoRoomName);
      // Joiner appears in roomPlayers as active.
      const db = await getDb();
      if (!db) throw new Error("Database not available");
      const players = await db
        .select()
        .from(roomPlayers)
        .where(eq(roomPlayers.roomId, created.roomId));
      const joinerRow = players.find((p) => p.userId === joiner.id);
      expect(joinerRow?.isActive).toBe(true);
    } finally {
      await cleanupRoomByInviteCode(created.inviteCode);
    }
  });

  it("rejects join on a non-existent invite", async () => {
    const u = await makeUser("ghost");
    const caller = makeCaller({ id: u.id, role: u.role, email: u.email });
    await expect(
      caller.liveRoom.joinLiveRoom({ inviteCode: "ZZZZZZ" }),
    ).rejects.toThrow(/NOT_FOUND|not found/i);
  });
});

liveDescribe("liveRoom.refreshToken", () => {
  it("returns a fresh token for an existing room member", async () => {
    const host = await makeUser("hostR");
    const caller = makeCaller({ id: host.id, role: host.role, email: host.email });
    const created = await caller.liveRoom.createLiveRoom({
      selectedGenres: ["Rock"],
      selectedDecades: ["1980s"],
      difficulty: "medium",
      maxPlayers: 4,
      timerSeconds: 30,
      roundsTotal: 10,
    });
    try {
      const result = await caller.liveRoom.refreshToken({ roomId: created.roomId });
      expect(result.token).toMatch(/^eyJ/);
      expect(result.livekitUrl).toMatch(/^wss:\/\//);
    } finally {
      await cleanupRoomByInviteCode(created.inviteCode);
    }
  });

  it("rejects refreshToken for a non-member", async () => {
    const host = await makeUser("hostX");
    const outsider = await makeUser("outsiderX");
    const hostCaller = makeCaller({ id: host.id, role: host.role, email: host.email });
    const created = await hostCaller.liveRoom.createLiveRoom({
      selectedGenres: ["R&B"],
      selectedDecades: ["2000s"],
      difficulty: "medium",
      maxPlayers: 4,
      timerSeconds: 30,
      roundsTotal: 10,
    });
    try {
      const outsiderCaller = makeCaller({ id: outsider.id, role: outsider.role, email: outsider.email });
      await expect(
        outsiderCaller.liveRoom.refreshToken({ roomId: created.roomId }),
      ).rejects.toThrow(/FORBIDDEN|forbidden|Not a room member/i);
    } finally {
      await cleanupRoomByInviteCode(created.inviteCode);
    }
  });
});
