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
  userFavorites,
  type ChatMessage as ChatMessageRow,
} from "../../drizzle/schema";
import { getActiveBan } from "../_core/chatBans";
import { rateLimit } from "../_core/rateLimit";
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

function friendsVisibilityClause(viewerId: number) {
  // author_id IN (SELECT favorite_id FROM user_favorites WHERE follower_id = viewer UNION ALL SELECT viewer)
  return sql`(
    ${chatMessages.authorId} = ${viewerId}
    OR ${chatMessages.authorId} IN (
      SELECT ${userFavorites.favoriteId} FROM ${userFavorites}
      WHERE ${userFavorites.followerId} = ${viewerId}
    )
  )`;
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

      // 1. Rate limit. Per-Lambda in-process bucket — matches the project's
      // established pattern (auth.me, magic-link send, etc.). Documented
      // upgrade trigger to a Redis-backed limiter is ~50-100 RPS sustained
      // per the security baseline scan.
      rateLimit("chat.postMessage", ctx.user.id, { max: 10, windowMs: 10_000 });

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
      if (input.scope === "friends") {
        where.push(friendsVisibilityClause(ctx.user.id));
      } else if (input.roomId != null) {
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
      if (input.scope === "friends") {
        where.push(friendsVisibilityClause(ctx.user.id));
      } else if (input.roomId != null) {
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
      if (input.scope === "friends") {
        where.push(friendsVisibilityClause(ctx.user.id));
      } else if (input.roomId != null) {
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

  admin: router({
    deleteMessage: adminProcedure
      .input(z.object({ messageId: z.number().int(), reason: z.string().min(1) }))
      .mutation(async ({ input, ctx }) => {
        const db = await getDb();
        if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "DB unavailable" });

        await db.transaction(async (tx) => {
          const [updated] = await tx
            .update(chatMessages)
            .set({
              deletedAt: new Date(),
              deletedBy: ctx.user.id,
              deletedReason: input.reason,
            })
            .where(eq(chatMessages.id, input.messageId))
            .returning();
          if (!updated) {
            throw new TRPCError({ code: "NOT_FOUND", message: "Message not found" });
          }
          await recordChatAction({
            tx,
            actorId: ctx.user.id,
            actorRole: "admin",
            action: "message_delete",
            targetMessageId: input.messageId,
            targetUserId: updated.authorId,
            scope: updated.scope,
            roomId: updated.roomId ?? undefined,
            reason: input.reason,
          });
        });

        return { success: true as const };
      }),

    banAuthor: adminProcedure
      .input(
        z.object({
          userId: z.number().int(),
          scope: z.enum(["global", "room"]),
          roomId: z.number().int().optional(),
          expiresAt: z.string().datetime().optional(),
          reason: z.string().min(1),
        }),
      )
      .mutation(async ({ input, ctx }) => {
        const db = await getDb();
        if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "DB unavailable" });
        if (input.scope === "room" && input.roomId == null) {
          throw new TRPCError({ code: "BAD_REQUEST", message: "roomId required for room-scope ban" });
        }

        const banId = await db.transaction(async (tx) => {
          const [ban] = await tx
            .insert(chatBans)
            .values({
              userId: input.userId,
              scope: input.scope,
              roomId: input.scope === "room" ? input.roomId! : null,
              action: "ban",
              reason: input.reason,
              createdBy: ctx.user.id,
              expiresAt: input.expiresAt ? new Date(input.expiresAt) : null,
            })
            .returning({ id: chatBans.id });
          await recordChatAction({
            tx,
            actorId: ctx.user.id,
            actorRole: "admin",
            action: "ban",
            targetUserId: input.userId,
            scope: input.scope,
            roomId: input.roomId ?? undefined,
            reason: input.reason,
            metadata: { expiresAt: input.expiresAt ?? null },
          });
          return ban.id;
        });

        return { banId };
      }),

    muteAuthor: adminProcedure
      .input(
        z.object({
          userId: z.number().int(),
          scope: z.enum(["global", "room"]),
          roomId: z.number().int().optional(),
          flavor: z.enum(["visible", "shadow"]).default("visible"),
          expiresAt: z.string().datetime().optional(),
          reason: z.string().min(1),
        }),
      )
      .mutation(async ({ input, ctx }) => {
        const db = await getDb();
        if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "DB unavailable" });
        if (input.scope === "room" && input.roomId == null) {
          throw new TRPCError({ code: "BAD_REQUEST", message: "roomId required for room-scope mute" });
        }

        const action = input.flavor === "shadow" ? "mute_shadow" : "mute_visible";

        const banId = await db.transaction(async (tx) => {
          const [ban] = await tx
            .insert(chatBans)
            .values({
              userId: input.userId,
              scope: input.scope,
              roomId: input.scope === "room" ? input.roomId! : null,
              action,
              reason: input.reason,
              createdBy: ctx.user.id,
              expiresAt: input.expiresAt ? new Date(input.expiresAt) : null,
            })
            .returning({ id: chatBans.id });
          await recordChatAction({
            tx,
            actorId: ctx.user.id,
            actorRole: "admin",
            action,
            targetUserId: input.userId,
            scope: input.scope,
            roomId: input.roomId ?? undefined,
            reason: input.reason,
            metadata: { expiresAt: input.expiresAt ?? null, flavor: input.flavor },
          });
          return ban.id;
        });
        return { banId };
      }),

    revokeBan: adminProcedure
      .input(z.object({ banId: z.number().int(), reason: z.string().min(1) }))
      .mutation(async ({ input, ctx }) => {
        const db = await getDb();
        if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "DB unavailable" });

        await db.transaction(async (tx) => {
          const [existing] = await tx
            .select()
            .from(chatBans)
            .where(eq(chatBans.id, input.banId));
          if (!existing) throw new TRPCError({ code: "NOT_FOUND", message: "Ban not found" });
          if (existing.revokedAt != null) {
            throw new TRPCError({ code: "BAD_REQUEST", message: "Already revoked" });
          }

          await tx
            .update(chatBans)
            .set({ revokedAt: new Date(), revokedBy: ctx.user.id })
            .where(eq(chatBans.id, input.banId));

          const auditAction =
            existing.action === "ban" ? "unban" : "unmute";
          await recordChatAction({
            tx,
            actorId: ctx.user.id,
            actorRole: "admin",
            action: auditAction,
            targetUserId: existing.userId,
            scope: existing.scope,
            roomId: existing.roomId ?? undefined,
            reason: input.reason,
            metadata: { ban_id: input.banId, original_action: existing.action },
          });
        });

        return { success: true as const };
      }),

    editMessage: adminProcedure
      .input(
        z.object({
          messageId: z.number().int(),
          newBody: z.string().min(1).max(1000),
          reason: z.string().min(1),
        }),
      )
      .mutation(async ({ input, ctx }) => {
        const db = await getDb();
        if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "DB unavailable" });

        await db.transaction(async (tx) => {
          const [existing] = await tx
            .select()
            .from(chatMessages)
            .where(eq(chatMessages.id, input.messageId));
          if (!existing) throw new TRPCError({ code: "NOT_FOUND", message: "Message not found" });

          await tx
            .update(chatMessages)
            .set({
              body: input.newBody,
              editedAt: new Date(),
              editedBy: ctx.user.id,
            })
            .where(eq(chatMessages.id, input.messageId));

          await recordChatAction({
            tx,
            actorId: ctx.user.id,
            actorRole: "admin",
            action: "message_edit",
            targetMessageId: input.messageId,
            targetUserId: existing.authorId,
            scope: existing.scope,
            roomId: existing.roomId ?? undefined,
            reason: input.reason,
            metadata: { previous_body: existing.body, new_body: input.newBody },
          });
        });

        return { success: true as const };
      }),

    markFlaggedReviewed: adminProcedure
      .input(
        z.object({
          messageId: z.number().int(),
          outcome: z.enum(["clean", "delete"]),
          reason: z.string().min(1),
        }),
      )
      .mutation(async ({ input, ctx }) => {
        const db = await getDb();
        if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "DB unavailable" });

        await db.transaction(async (tx) => {
          const [existing] = await tx
            .select()
            .from(chatMessages)
            .where(eq(chatMessages.id, input.messageId));
          if (!existing) throw new TRPCError({ code: "NOT_FOUND", message: "Message not found" });

          if (input.outcome === "clean") {
            await tx
              .update(chatMessages)
              .set({ flagStatus: "reviewed_clean" })
              .where(eq(chatMessages.id, input.messageId));
          } else {
            await tx
              .update(chatMessages)
              .set({
                deletedAt: new Date(),
                deletedBy: ctx.user.id,
                deletedReason: input.reason,
              })
              .where(eq(chatMessages.id, input.messageId));
          }

          await recordChatAction({
            tx,
            actorId: ctx.user.id,
            actorRole: "admin",
            action: input.outcome === "clean" ? "message_edit" : "message_delete",
            targetMessageId: input.messageId,
            targetUserId: existing.authorId,
            scope: existing.scope,
            roomId: existing.roomId ?? undefined,
            reason: input.reason,
            metadata: { flag_review_outcome: input.outcome, original_flag_status: existing.flagStatus },
          });
        });

        return { success: true as const };
      }),

    flaggedMessages: adminProcedure
      .input(z.object({ limit: z.number().int().min(1).max(200).default(50) }))
      .query(async ({ input }) => {
        const db = await getDb();
        if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "DB unavailable" });
        const rows = await db
          .select()
          .from(chatMessages)
          .where(
            and(
              isNull(chatMessages.deletedAt),
              sql`${chatMessages.flagStatus} IN ('flagged', 'flagged_high_confidence')`,
            ),
          )
          .orderBy(desc(chatMessages.id))
          .limit(input.limit);
        return rows;
      }),

    recentBans: adminProcedure
      .input(z.object({ limit: z.number().int().min(1).max(200).default(100) }))
      .query(async ({ input }) => {
        const db = await getDb();
        if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "DB unavailable" });
        const rows = await db
          .select()
          .from(chatBans)
          .where(isNull(chatBans.revokedAt))
          .orderBy(desc(chatBans.createdAt))
          .limit(input.limit);
        return rows;
      }),

    auditLog: adminProcedure
      .input(
        z.object({
          actorId: z.number().int().optional(),
          action: z.string().optional(),
          targetUserId: z.number().int().optional(),
          beforeId: z.number().int().optional(),
          limit: z.number().int().min(1).max(200).default(50),
        }),
      )
      .query(async ({ input }) => {
        const db = await getDb();
        if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "DB unavailable" });
        const where = [] as ReturnType<typeof sql>[];
        if (input.actorId != null) where.push(sql`actor_id = ${input.actorId}`);
        if (input.action) where.push(sql`action = ${input.action}`);
        if (input.targetUserId != null) where.push(sql`target_user_id = ${input.targetUserId}`);
        if (input.beforeId != null) where.push(sql`id < ${input.beforeId}`);
        const whereClause = where.length ? sql`WHERE ${sql.join(where, sql` AND `)}` : sql``;
        const result = await db.execute(sql`
          SELECT * FROM chat_audit_log
          ${whereClause}
          ORDER BY id DESC
          LIMIT ${input.limit}
        `);
        const rows = ((result as unknown as { rows?: unknown[] }).rows
          ?? (Array.isArray(result) ? (result as unknown[]) : [])) as Array<Record<string, unknown>>;
        return { rows };
      }),

    userLookup: adminProcedure
      .input(z.object({ query: z.string().min(1).max(128) }))
      .query(async ({ input }) => {
        const db = await getDb();
        if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "DB unavailable" });
        const result = await db.execute(sql`
          SELECT
            u.id, u."openId", u.email, u."firstName", u."lastName", u.role,
            (
              SELECT COUNT(*)::int FROM chat_bans b
              WHERE b.user_id = u.id
                AND b.revoked_at IS NULL
                AND (b.expires_at IS NULL OR b.expires_at > NOW())
            ) AS "activeBanCount"
          FROM users u
          WHERE u.email ILIKE ${"%" + input.query + "%"}
             OR u."firstName" ILIKE ${"%" + input.query + "%"}
             OR u."lastName" ILIKE ${"%" + input.query + "%"}
          ORDER BY u.id DESC
          LIMIT 25
        `);
        const userRows = ((result as unknown as { rows?: unknown[] }).rows
          ?? (Array.isArray(result) ? (result as unknown[]) : [])) as Array<{
          id: number;
          openId: string;
          email: string | null;
          firstName: string | null;
          lastName: string | null;
          role: string;
          activeBanCount: number;
        }>;
        return { users: userRows };
      }),
  }),

  unreadCounts: protectedProcedure.query(async ({ ctx }) => {
    const db = await getDb();
    if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "DB unavailable" });

    // Global — messages with id > last_read_seq for (user, room=1)
    const [globalRow] = await db
      .select({ lastSeq: chatRoomMembers.lastReadSeq })
      .from(chatRoomMembers)
      .where(and(eq(chatRoomMembers.userId, ctx.user.id), eq(chatRoomMembers.roomId, 1)));
    const globalLastSeq = globalRow?.lastSeq ?? 0;

    const globalRes = await db.execute(sql`
      SELECT COUNT(*)::int AS count
      FROM chat_messages
      WHERE scope = 'global'
        AND room_id = 1
        AND id > ${globalLastSeq}
        AND deleted_at IS NULL
        AND NOT (posted_while_shadow_banned AND author_id != ${ctx.user.id})
    `);
    const globalCount = ((globalRes as unknown as { rows?: Array<{ count: number }> }).rows
      ?? (Array.isArray(globalRes) ? (globalRes as unknown as Array<{ count: number }>) : []))[0]?.count ?? 0;

    // Friends — messages in scope='friends' with author IN {self ∪ favorites(self)}, id > last_read_seq
    const [friendsRow] = await db
      .select({ lastSeq: chatFriendsReadState.lastReadSeq })
      .from(chatFriendsReadState)
      .where(eq(chatFriendsReadState.userId, ctx.user.id));
    const friendsLastSeq = friendsRow?.lastSeq ?? 0;

    const friendsRes = await db.execute(sql`
      SELECT COUNT(*)::int AS count
      FROM chat_messages
      WHERE scope = 'friends'
        AND id > ${friendsLastSeq}
        AND deleted_at IS NULL
        AND NOT (posted_while_shadow_banned AND author_id != ${ctx.user.id})
        AND (
          author_id = ${ctx.user.id}
          OR author_id IN (
            SELECT favorite_id FROM user_favorites WHERE follower_id = ${ctx.user.id}
          )
        )
    `);
    const friendsCount = ((friendsRes as unknown as { rows?: Array<{ count: number }> }).rows
      ?? (Array.isArray(friendsRes) ? (friendsRes as unknown as Array<{ count: number }>) : []))[0]?.count ?? 0;

    // Tournaments — per-tournament unread count for the viewer's active memberships
    const tournamentRows = await db.execute(sql`
      SELECT t.id AS tournament_id, t.chat_room_id, COALESCE(crm.last_read_seq, 0) AS last_read_seq
      FROM tournament_members tm
      JOIN tournaments t ON t.id = tm.tournament_id
      LEFT JOIN chat_room_members crm
        ON crm.user_id = ${ctx.user.id} AND crm.room_id = t.chat_room_id
      WHERE tm.user_id = ${ctx.user.id}
        AND tm.left_at IS NULL
        AND t.chat_room_id IS NOT NULL
    `);
    const tournamentMembershipRows = ((tournamentRows as unknown as { rows?: Array<{ tournament_id: number; chat_room_id: number; last_read_seq: number }> }).rows
      ?? (Array.isArray(tournamentRows) ? (tournamentRows as unknown as Array<{ tournament_id: number; chat_room_id: number; last_read_seq: number }>) : []));

    const tournamentCounts: Record<number, number> = {};
    for (const row of tournamentMembershipRows) {
      const countRes = await db.execute(sql`
        SELECT COUNT(*)::int AS count
        FROM chat_messages
        WHERE scope = 'tournament'
          AND room_id = ${row.chat_room_id}
          AND id > ${row.last_read_seq}
          AND deleted_at IS NULL
          AND NOT (posted_while_shadow_banned AND author_id != ${ctx.user.id})
      `);
      const c = ((countRes as unknown as { rows?: Array<{ count: number }> }).rows
        ?? (Array.isArray(countRes) ? (countRes as unknown as Array<{ count: number }>) : []))[0]?.count ?? 0;
      if (c > 0) tournamentCounts[row.tournament_id] = c;
    }

    return {
      global: globalCount,
      friends: friendsCount,
      tournaments: tournamentCounts,
    };
  }),
});
