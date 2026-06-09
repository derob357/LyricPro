// server/routers/matchEngine.ts
import { z } from "zod";
import { and, eq } from "drizzle-orm";
import { TRPCError } from "@trpc/server";
import { router, publicProcedure } from "../_core/trpc";
import { getDb } from "../db";
import { gameRooms, roomPlayers } from "../../drizzle/schema";
import { selectSongForRoom } from "../_core/songSelection";

export function assertCanStart(opts: {
  isHost: boolean;
  status: string;
  readyCount: number;
  playerCount: number;
}): void {
  if (!opts.isHost) throw new TRPCError({ code: "FORBIDDEN", message: "Only the host can start." });
  if (opts.status !== "waiting") throw new TRPCError({ code: "BAD_REQUEST", message: "Match already started." });
  if (opts.playerCount < 2) throw new TRPCError({ code: "BAD_REQUEST", message: "Need at least 2 players." });
  if (opts.readyCount < opts.playerCount) throw new TRPCError({ code: "BAD_REQUEST", message: "All players must be ready." });
}

// Authoritative snapshot for join / reconnect / post-broadcast refetch.
export const matchEngineRouter = router({
  startMatch: publicProcedure
    .input(z.object({ roomCode: z.string() }))
    .mutation(async ({ input, ctx }) => {
      const db = await getDb();
      if (!db) throw new Error("Database not available");
      const [room] = await db.select().from(gameRooms).where(eq(gameRooms.roomCode, input.roomCode)).limit(1);
      if (!room) throw new TRPCError({ code: "NOT_FOUND", message: "Room not found" });
      const players = await db.select().from(roomPlayers).where(eq(roomPlayers.roomId, room.id));
      const isHost = (!!ctx.user?.id && room.hostUserId === ctx.user.id);
      assertCanStart({ isHost, status: room.status, readyCount: players.filter(p => p.isReady).length, playerCount: players.length });

      const used: number[] = room.usedSongIds ? JSON.parse(room.usedSongIds) : [];
      const pick = await selectSongForRoom(db, {
        genres: JSON.parse(room.selectedGenres), decades: JSON.parse(room.selectedDecades),
        difficulty: room.difficulty, explicitFilter: room.explicitFilter, usedSongIds: used,
      });
      if (!pick) throw new TRPCError({ code: "BAD_REQUEST", message: "No songs available for these filters." });

      const now = new Date();
      const endsAt = new Date(now.getTime() + room.timerSeconds * 1000);
      const res = await db.update(gameRooms).set({
        status: "active", currentRound: 1, roundPhase: "in_question",
        currentSongId: pick.songId, usedSongIds: JSON.stringify([...used, pick.songId]),
        roundEndsAt: endsAt, updatedAt: now,
      }).where(and(eq(gameRooms.id, room.id), eq(gameRooms.status, "waiting"))).returning({ id: gameRooms.id });
      if (res.length === 0) throw new TRPCError({ code: "CONFLICT", message: "Match already started." });
      return { ok: true, currentRound: 1, roundEndsAt: endsAt };
    }),

  getMatchState: publicProcedure
    .input(z.object({ roomCode: z.string() }))
    .query(async ({ input }) => {
      const db = await getDb();
      if (!db) throw new Error("Database not available");
      const [room] = await db
        .select()
        .from(gameRooms)
        .where(eq(gameRooms.roomCode, input.roomCode))
        .limit(1);
      if (!room) throw new TRPCError({ code: "NOT_FOUND", message: "Room not found" });
      const players = await db
        .select()
        .from(roomPlayers)
        .where(eq(roomPlayers.roomId, room.id))
        .orderBy(roomPlayers.joinOrder);
      const standings = [...players].sort((a, b) => b.currentScore - a.currentScore);
      return {
        room: {
          id: room.id,
          roomCode: room.roomCode,
          status: room.status,
          roundPhase: room.roundPhase,
          currentRound: room.currentRound,
          roundsTotal: room.roundsTotal,
          roundEndsAt: room.roundEndsAt,
          currentSongId: room.currentSongId,
          difficulty: room.difficulty,
          timerSeconds: room.timerSeconds,
          hostUserId: room.hostUserId,
          maxPlayers: room.maxPlayers,
        },
        players: players.map(p => ({
          id: p.id,
          userId: p.userId,
          guestName: p.guestName,
          currentScore: p.currentScore,
          isReady: p.isReady,
          isActive: p.isActive,
          joinOrder: p.joinOrder,
        })),
        standings: standings.map((p, i) => ({
          rank: i + 1,
          playerId: p.id,
          score: p.currentScore,
        })),
      };
    }),
});
