// Chat tRPC router. Phase 1 landed the skeleton + ban-check middleware.
// Phase 2 adds the Global-tab user-facing endpoints + minimal admin moderation.
import { z } from "zod";
import { TRPCError } from "@trpc/server";
import { and, eq, sql, lt, gt, desc, isNull } from "drizzle-orm";
import { router, protectedProcedure, adminProcedure } from "../_core/trpc";
import { getDb } from "../db";
import {
  chatMessages,
  chatBans,
  chatRoomMembers,
  chatFriendsReadState,
  chatAuditLog,
  type ChatMessage as ChatMessageRow,
} from "../../drizzle/schema";
import { getActiveBan } from "../_core/chatBans";
import { enforceChatRateLimit } from "../_core/chatRateLimit";
import { assessProfanity } from "../_core/profanityFilter";
import { recordChatAction } from "../_core/chatAudit";

const ScopeEnum = z.enum(["global", "tournament", "friends"]);

async function ensureNotGloballyBanned(userId: number): Promise<void> {
  const ban = await getActiveBan(userId, { kind: "global" });
  if (!ban) return;
  if (ban.action === "ban") {
    throw new TRPCError({ code: "FORBIDDEN", message: "You are banned from chat." });
  }
  if (ban.action === "mute_visible") {
    throw new TRPCError({ code: "FORBIDDEN", message: "You can't post here." });
  }
  // mute_shadow falls through — caller handles it specially when inserting.
}

export const chatRouter = router({
  postMessage: protectedProcedure
    .input(
      z.object({
        scope: ScopeEnum,
        roomId: z.number().int().optional(),
        body: z.string().min(1).max(1000),
      }),
    )
    .mutation(async ({ input, ctx }) => {
      const db = await getDb();
      if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "DB unavailable" });

      // 1. Rate limit (no-op if UPSTASH env not set)
      await enforceChatRateLimit(`chat:post:${ctx.user.id}`);

      // 2. Ban/mute check (global + per-room)
      await ensureNotGloballyBanned(ctx.user.id);
      let shadowMuted = false;
      const globalBan = await getActiveBan(ctx.user.id, { kind: "global" });
      if (globalBan?.action === "mute_shadow") shadowMuted = true;

      if (input.scope === "tournament" || input.scope === "global") {
        if (input.roomId == null) {
          throw new TRPCError({ code: "BAD_REQUEST", message: "roomId required for this scope" });
        }
        const roomBan = await getActiveBan(ctx.user.id, { kind: "room", roomId: input.roomId });
        if (roomBan && roomBan.action === "ban") {
          throw new TRPCError({ code: "FORBIDDEN", message: "You are banned from this room." });
        }
        if (roomBan && roomBan.action === "mute_visible") {
          throw new TRPCError({ code: "FORBIDDEN", message: "You can't post here." });
        }
        if (roomBan && roomBan.action === "mute_shadow") shadowMuted = true;
      }

      // 3. Profanity (Tier 1)
      const profanity = assessProfanity(input.body);
      if (profanity.block) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: "Message contains blocked language. Please revise.",
        });
      }

      // 4. Insert
      const [inserted] = await db
        .insert(chatMessages)
        .values({
          scope: input.scope,
          roomId: input.scope === "friends" ? null : input.roomId!,
          authorId: ctx.user.id,
          body: input.body,
          postedWhileShadowBanned: shadowMuted,
          flagStatus: profanity.status === "flagged" ? "flagged" : "clean",
          flagReason: profanity.reason,
        })
        .returning();

      return inserted;
    }),

  fetchInitial: protectedProcedure
    .input(
      z.object({
        scope: ScopeEnum,
        roomId: z.number().int().optional(),
        limit: z.number().int().min(1).max(100).default(50),
      }),
    )
    .query(async ({ input, ctx }) => {
      const db = await getDb();
      if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "DB unavailable" });
      await ensureNotGloballyBanned(ctx.user.id);

      const where = [
        eq(chatMessages.scope, input.scope),
        isNull(chatMessages.deletedAt),
      ];
      if (input.scope !== "friends" && input.roomId != null) {
        where.push(eq(chatMessages.roomId, input.roomId));
      }

      const messages = await db
        .select()
        .from(chatMessages)
        .where(and(...where))
        .orderBy(desc(chatMessages.id))
        .limit(input.limit);

      return {
        messages,
        lastSeenSeq: messages[0]?.id ?? 0,
      };
    }),

  fetchOlder: protectedProcedure
    .input(
      z.object({
        scope: ScopeEnum,
        roomId: z.number().int().optional(),
        beforeId: z.number().int(),
        limit: z.number().int().min(1).max(100).default(50),
      }),
    )
    .query(async ({ input, ctx }) => {
      const db = await getDb();
      if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "DB unavailable" });
      await ensureNotGloballyBanned(ctx.user.id);

      const where = [
        eq(chatMessages.scope, input.scope),
        isNull(chatMessages.deletedAt),
        lt(chatMessages.id, input.beforeId),
      ];
      if (input.scope !== "friends" && input.roomId != null) {
        where.push(eq(chatMessages.roomId, input.roomId));
      }

      const messages = await db
        .select()
        .from(chatMessages)
        .where(and(...where))
        .orderBy(desc(chatMessages.id))
        .limit(input.limit);

      return messages;
    }),

  fetchSince: protectedProcedure
    .input(
      z.object({
        scope: ScopeEnum,
        roomId: z.number().int().optional(),
        lastSeenSeq: z.number().int(),
      }),
    )
    .query(async ({ input, ctx }) => {
      const db = await getDb();
      if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "DB unavailable" });
      await ensureNotGloballyBanned(ctx.user.id);

      const where = [
        eq(chatMessages.scope, input.scope),
        isNull(chatMessages.deletedAt),
        gt(chatMessages.id, input.lastSeenSeq),
      ];
      if (input.scope !== "friends" && input.roomId != null) {
        where.push(eq(chatMessages.roomId, input.roomId));
      }

      const messages = await db
        .select()
        .from(chatMessages)
        .where(and(...where))
        .orderBy(desc(chatMessages.id))
        .limit(200);

      return messages;
    }),

  markRead: protectedProcedure
    .input(
      z.object({
        scope: ScopeEnum,
        roomId: z.number().int().optional(),
        seq: z.number().int().min(0),
      }),
    )
    .mutation(async ({ input, ctx }) => {
      const db = await getDb();
      if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "DB unavailable" });

      if (input.scope === "friends") {
        await db
          .insert(chatFriendsReadState)
          .values({ userId: ctx.user.id, lastReadSeq: input.seq })
          .onConflictDoUpdate({
            target: chatFriendsReadState.userId,
            set: { lastReadSeq: input.seq, lastReadAt: new Date() },
          });
      } else {
        if (input.roomId == null) {
          throw new TRPCError({ code: "BAD_REQUEST", message: "roomId required for this scope" });
        }
        await db
          .insert(chatRoomMembers)
          .values({ userId: ctx.user.id, roomId: input.roomId, lastReadSeq: input.seq })
          .onConflictDoUpdate({
            target: [chatRoomMembers.userId, chatRoomMembers.roomId],
            set: { lastReadSeq: input.seq, lastReadAt: new Date() },
          });
      }

      return { success: true as const };
    }),

  unreadCounts: protectedProcedure.query(async ({ ctx }) => {
    const db = await getDb();
    if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "DB unavailable" });

    // Global: messages with id > last_read_seq for the (user, room=1) tuple.
    const [globalRow] = await db
      .select({ lastSeq: chatRoomMembers.lastReadSeq })
      .from(chatRoomMembers)
      .where(and(eq(chatRoomMembers.userId, ctx.user.id), eq(chatRoomMembers.roomId, 1)));
    const globalLastSeq = globalRow?.lastSeq ?? 0;

    const globalCountRows = await db.execute(sql`
      SELECT COUNT(*)::int AS count
      FROM chat_messages
      WHERE scope = 'global'
        AND room_id = 1
        AND id > ${globalLastSeq}
        AND deleted_at IS NULL
        AND NOT (posted_while_shadow_banned AND author_id != ${ctx.user.id})
    `);
    const globalRows = (globalCountRows as unknown as { rows?: Array<{ count: number }> }).rows
      ?? (Array.isArray(globalCountRows) ? (globalCountRows as unknown as Array<{ count: number }>) : []);

    return {
      global: globalRows[0]?.count ?? 0,
      friends: 0,         // Phase 3 will fill in
      tournaments: {} as Record<number, number>,  // Phase 4 will fill in
    };
  }),
});
