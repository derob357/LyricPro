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
});
