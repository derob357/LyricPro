// server/routers/matchEngine.ts
import { z } from "zod";
import { eq } from "drizzle-orm";
import { TRPCError } from "@trpc/server";
import { router, publicProcedure } from "../_core/trpc";
import { getDb } from "../db";
import { gameRooms, roomPlayers } from "../../drizzle/schema";

// Authoritative snapshot for join / reconnect / post-broadcast refetch.
export const matchEngineRouter = router({
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
