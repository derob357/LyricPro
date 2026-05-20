/**
 * tRPC router for Remote Live mode (Phase 1 — lobby only).
 *
 * Procedures:
 *   - createLiveRoom: host creates a new video-enabled game room, returns
 *     invite code + LiveKit token + ws URL.
 *   - getLiveRoom (by inviteCode): preview of a room (player count, genres,
 *     host name) — used by the join page before committing.
 *   - joinLiveRoom (by inviteCode): caller is added to roomPlayers and a
 *     fresh LiveKit token is minted for them.
 *   - leaveLiveRoom: marks caller as inactive (does not delete the room).
 *   - refreshToken: tokens have a short TTL; this endpoint re-issues for an
 *     active room member. Rate-limited per user.
 */
import { z } from "zod";
import { TRPCError } from "@trpc/server";
import { and, eq } from "drizzle-orm";
import { router, protectedProcedure } from "../_core/trpc";
import { gameRooms, roomPlayers } from "../../drizzle/schema";
import { getDb } from "../db";
import { mintLiveKitToken, generateRoomName } from "../_core/livekit";
import { rateLimit } from "../_core/rateLimit";
import { generateInviteCode } from "./game";

const TOKEN_TTL_SECONDS = 15 * 60;
const INVITE_EXPIRY_DAYS = 7;

const createLiveRoomInput = z.object({
  selectedGenres: z.array(z.string()).min(1),
  selectedDecades: z.array(z.string()).min(1),
  difficulty: z.enum(["low", "medium", "high"]).default("medium"),
  maxPlayers: z.number().int().min(2).max(8),
  timerSeconds: z.number().int().min(10).max(120).default(30),
  roundsTotal: z.number().int().min(1).max(50).default(10),
  explicitFilter: z.boolean().default(false),
});

export const liveRoomRouter = router({
  createLiveRoom: protectedProcedure
    .input(createLiveRoomInput)
    .mutation(async ({ ctx, input }) => {
      const db = await getDb();
      if (!db) throw new Error("Database not available");

      const videoRoomName = generateRoomName();
      const inviteCode = generateInviteCode();
      const inviteExpiresAt = new Date(
        Date.now() + INVITE_EXPIRY_DAYS * 24 * 60 * 60 * 1000,
      );

      const [room] = await db
        .insert(gameRooms)
        .values({
          roomCode: inviteCode.slice(0, 8).toUpperCase(),
          hostUserId: ctx.user.id,
          mode: "remote_live",
          rankingMode: "total_points",
          timerSeconds: input.timerSeconds,
          roundsTotal: input.roundsTotal,
          selectedGenres: JSON.stringify(input.selectedGenres),
          selectedDecades: JSON.stringify(input.selectedDecades),
          difficulty: input.difficulty,
          explicitFilter: input.explicitFilter,
          status: "waiting",
          isVideoRoom: true,
          videoRoomName,
          maxPlayers: input.maxPlayers,
          inviteCode,
          inviteExpiresAt,
        })
        .returning();

      // Host auto-joins as the first room player.
      await db.insert(roomPlayers).values({
        roomId: room.id,
        userId: ctx.user.id,
        guestName: ctx.user.firstName ?? "Host",
        joinOrder: 0,
        isReady: false,
        isActive: true,
      });

      const token = await mintLiveKitToken({
        roomName: videoRoomName,
        identity: `user_${ctx.user.id}`,
        name: ctx.user.firstName ?? "Host",
        ttlSeconds: TOKEN_TTL_SECONDS,
      });

      return {
        roomId: room.id,
        roomCode: room.roomCode,
        inviteCode: room.inviteCode!,
        videoRoomName,
        livekitUrl: process.env.LIVEKIT_URL ?? "",
        token,
      };
    }),

  getLiveRoom: protectedProcedure
    .input(z.object({ inviteCode: z.string().min(4).max(64) }))
    .query(async ({ input }) => {
      const db = await getDb();
      if (!db) throw new Error("Database not available");

      const rows = await db
        .select()
        .from(gameRooms)
        .where(
          and(
            eq(gameRooms.inviteCode, input.inviteCode),
            eq(gameRooms.isVideoRoom, true),
          ),
        )
        .limit(1);
      const room = rows[0];
      if (!room) {
        throw new TRPCError({ code: "NOT_FOUND", message: "Room not found" });
      }
      if (room.inviteExpiresAt && room.inviteExpiresAt < new Date()) {
        throw new TRPCError({ code: "FORBIDDEN", message: "Invite expired" });
      }

      const players = await db
        .select()
        .from(roomPlayers)
        .where(
          and(
            eq(roomPlayers.roomId, room.id),
            eq(roomPlayers.isActive, true),
          ),
        );

      return {
        roomId: room.id,
        roomCode: room.roomCode,
        difficulty: room.difficulty,
        selectedGenres: JSON.parse(room.selectedGenres) as string[],
        selectedDecades: JSON.parse(room.selectedDecades) as string[],
        maxPlayers: room.maxPlayers,
        playerCount: players.length,
        status: room.status,
      };
    }),

  joinLiveRoom: protectedProcedure
    .input(z.object({ inviteCode: z.string().min(4).max(64) }))
    .mutation(async ({ ctx, input }) => {
      const db = await getDb();
      if (!db) throw new Error("Database not available");

      const rows = await db
        .select()
        .from(gameRooms)
        .where(
          and(
            eq(gameRooms.inviteCode, input.inviteCode),
            eq(gameRooms.isVideoRoom, true),
          ),
        )
        .limit(1);
      const room = rows[0];
      if (!room) {
        throw new TRPCError({ code: "NOT_FOUND", message: "Room not found" });
      }
      if (room.status !== "waiting") {
        throw new TRPCError({
          code: "FORBIDDEN",
          message: "Game already started",
        });
      }

      const existingRows = await db
        .select()
        .from(roomPlayers)
        .where(
          and(
            eq(roomPlayers.roomId, room.id),
            eq(roomPlayers.userId, ctx.user.id),
          ),
        )
        .limit(1);
      const existing = existingRows[0];

      if (!existing) {
        const active = await db
          .select()
          .from(roomPlayers)
          .where(
            and(
              eq(roomPlayers.roomId, room.id),
              eq(roomPlayers.isActive, true),
            ),
          );
        if (active.length >= room.maxPlayers) {
          throw new TRPCError({
            code: "FORBIDDEN",
            message: `Room is full (${room.maxPlayers} player capacity)`,
          });
        }
        await db.insert(roomPlayers).values({
          roomId: room.id,
          userId: ctx.user.id,
          guestName: ctx.user.firstName ?? "Player",
          joinOrder: active.length,
          isActive: true,
        });
      } else if (!existing.isActive) {
        await db
          .update(roomPlayers)
          .set({ isActive: true })
          .where(eq(roomPlayers.id, existing.id));
      }

      const token = await mintLiveKitToken({
        roomName: room.videoRoomName!,
        identity: `user_${ctx.user.id}`,
        name: ctx.user.firstName ?? "Player",
        ttlSeconds: TOKEN_TTL_SECONDS,
      });

      return {
        roomId: room.id,
        roomCode: room.roomCode,
        videoRoomName: room.videoRoomName!,
        livekitUrl: process.env.LIVEKIT_URL ?? "",
        token,
      };
    }),

  leaveLiveRoom: protectedProcedure
    .input(z.object({ roomId: z.number().int() }))
    .mutation(async ({ ctx, input }) => {
      const db = await getDb();
      if (!db) throw new Error("Database not available");

      await db
        .update(roomPlayers)
        .set({ isActive: false })
        .where(
          and(
            eq(roomPlayers.roomId, input.roomId),
            eq(roomPlayers.userId, ctx.user.id),
          ),
        );
      return { success: true };
    }),

  refreshToken: protectedProcedure
    .input(z.object({ roomId: z.number().int() }))
    .mutation(async ({ ctx, input }) => {
      rateLimit("livekit_token_refresh", ctx.user.id, {
        max: 20,
        windowMs: 60_000,
      });
      const db = await getDb();
      if (!db) throw new Error("Database not available");

      const memberRows = await db
        .select()
        .from(roomPlayers)
        .where(
          and(
            eq(roomPlayers.roomId, input.roomId),
            eq(roomPlayers.userId, ctx.user.id),
            eq(roomPlayers.isActive, true),
          ),
        )
        .limit(1);
      const member = memberRows[0];
      if (!member) {
        throw new TRPCError({
          code: "FORBIDDEN",
          message: "Not a room member",
        });
      }

      const roomRows = await db
        .select()
        .from(gameRooms)
        .where(eq(gameRooms.id, input.roomId))
        .limit(1);
      const room = roomRows[0];
      if (!room?.videoRoomName) {
        throw new TRPCError({
          code: "NOT_FOUND",
          message: "Video room not found",
        });
      }

      const token = await mintLiveKitToken({
        roomName: room.videoRoomName,
        identity: `user_${ctx.user.id}`,
        name: ctx.user.firstName ?? "Player",
        ttlSeconds: TOKEN_TTL_SECONDS,
      });
      return { token, livekitUrl: process.env.LIVEKIT_URL ?? "" };
    }),
});
