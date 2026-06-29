// server/matchEngine.customPack.test.ts
import { describe, it, expect, vi } from "vitest";
vi.mock("stripe", () => ({ default: vi.fn().mockImplementation(() => ({ checkout: { sessions: { create: vi.fn() } }, webhooks: { constructEvent: vi.fn() }, subscriptions: { retrieve: vi.fn() }, customers: { search: vi.fn().mockResolvedValue({ data: [] }) } })) }));

import { appRouter } from "./app-router";
import { getDb } from "./db";
import { gameRooms, roomPlayers, roundResults, songs } from "../drizzle/schema";
import { and, eq } from "drizzle-orm";

const DB_URL = process.env.SUPABASE_SESSION_POOLER_STRING ?? process.env.SUPABASE_DIRECT_CONNECTION_STRING ?? process.env.DATABASE_URL;
const liveDescribe = DB_URL ? describe : describe.skip;

function adminCaller() {
  return appRouter.createCaller({
    user: { id: 1, role: "admin", email: "admin@test" } as any,
    req: {} as any, res: {} as any, ip: undefined, userAgent: undefined,
    requestId: `vitest-cp-${Date.now()}`, countryCode: "US",
  });
}

liveDescribe("matchEngine custom pack", () => {
  it("startMatch serves the first pack song and uses a catalog distractor pool", async () => {
    const db = (await getDb())!;
    // Pick two real active songs of DIFFERENT artists to seed the pack.
    const seed = await db.select().from(songs).where(eq(songs.isActive, true)).limit(5);
    if (seed.length < 2) return; // empty DB — skip
    const packIds = [seed[0].id, seed[1].id];

    const code = `CP${Date.now().toString().slice(-6)}`;
    const [room] = await db.insert(gameRooms).values({
      roomCode: code, hostUserId: 1, mode: "multiplayer",
      selectedGenres: "[]", selectedDecades: "[]", difficulty: "medium",
      roundsTotal: packIds.length, status: "waiting", usedSongIds: "[]",
      customPackSongIds: packIds, customPackVariants: null,
    }).returning();
    await db.insert(roomPlayers).values({ roomId: room.id, userId: 1, joinOrder: 0, isReady: true, isActive: true });

    const res = await adminCaller().matchEngine.startMatch({ roomCode: code });
    expect(res.currentRound).toBe(1);

    const [after] = await db.select().from(gameRooms).where(eq(gameRooms.id, room.id)).limit(1);
    expect(after.currentSongId).toBe(packIds[0]); // first pack song, in order
    const q = after.currentQuestion as any;
    expect(q.songId).toBe(packIds[0]);
    expect(q.artistOptions.length).toBe(4); // distractors found from the catalog

    // cleanup
    await db.delete(roomPlayers).where(eq(roomPlayers.roomId, room.id));
    await db.delete(gameRooms).where(eq(gameRooms.id, room.id));
  });

  it("finishes the match when the pack is exhausted", async () => {
    const db = (await getDb())!;
    const seed = await db.select().from(songs).where(eq(songs.isActive, true)).limit(1);
    if (seed.length < 1) return;
    const code = `CX${Date.now().toString().slice(-6)}`;
    // Single-song pack already 'used'; roundsTotal: 2 so decision === "next" (not "complete"),
    // forcing the exhaustion path rather than the normal end-of-rounds path.
    const [room] = await db.insert(gameRooms).values({
      roomCode: code, hostUserId: 1, mode: "multiplayer", selectedGenres: "[]", selectedDecades: "[]",
      difficulty: "medium", roundsTotal: 2, status: "active", currentRound: 1, roundPhase: "intermission",
      usedSongIds: JSON.stringify([seed[0].id]), customPackSongIds: [seed[0].id], customPackVariants: null,
    }).returning();
    await db.insert(roomPlayers).values({ roomId: room.id, userId: 1, joinOrder: 0, isReady: true, isActive: true });

    const res: any = await adminCaller().matchEngine.advanceRound({ roomCode: code });
    expect(res.complete).toBe(true);
    const [after] = await db.select().from(gameRooms).where(eq(gameRooms.id, room.id)).limit(1);
    expect(after.status).toBe("finished");

    await db.delete(roomPlayers).where(eq(roomPlayers.roomId, room.id));
    await db.delete(gameRooms).where(eq(gameRooms.id, room.id));
  });

  it("submitAnswer scores against forced variant index 1, not variant 0", async () => {
    const db = (await getDb())!;
    // Need a song with ≥2 entries in lyricVariants jsonb.
    const candidates = await db.select().from(songs).where(eq(songs.isActive, true)).limit(50);
    const song = candidates.find(
      (s) => Array.isArray(s.lyricVariants) && (s.lyricVariants as any[]).length >= 2,
    );
    if (!song) return; // no multi-variant seeds — skip
    const variants = song.lyricVariants as Array<{ answer: string; prompt: string }>;
    const v1Answer = variants[1].answer;

    // Create room already in active/in_question state so we bypass startMatch's
    // 2-player minimum and directly test the submitAnswer scoring path.
    const code = `VA${Date.now().toString().slice(-6)}`;
    const endsAt = new Date(Date.now() + 30_000);
    const [room] = await db.insert(gameRooms).values({
      roomCode: code, hostUserId: 1, mode: "multiplayer",
      selectedGenres: "[]", selectedDecades: "[]", difficulty: "medium",
      roundsTotal: 1, status: "active", currentRound: 1, roundPhase: "in_question",
      currentSongId: song.id,
      // usedSongIds already contains the song (appended by startMatch when served).
      usedSongIds: JSON.stringify([song.id]),
      customPackSongIds: [song.id],
      customPackVariants: [1], // force variant 1
      roundEndsAt: endsAt,
    }).returning();
    await db.insert(roomPlayers).values({
      roomId: room.id, userId: 1, joinOrder: 0, isReady: true, isActive: true,
    });

    const res = await adminCaller().matchEngine.submitAnswer({
      roomCode: code,
      lyricAnswer: v1Answer,
    });
    // A correct variant-1 lyric answer must earn lyric points (> 0 total).
    expect(res.totalRoundPoints).toBeGreaterThan(0);

    // cleanup
    await db.delete(roundResults).where(eq(roundResults.roomId, room.id));
    await db.delete(roomPlayers).where(eq(roomPlayers.roomId, room.id));
    await db.delete(gameRooms).where(eq(gameRooms.id, room.id));
  });
});
