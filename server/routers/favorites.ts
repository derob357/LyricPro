// User-favorites tRPC router. Powers the leaderboard heart-toggle and the
// Friends chat tab. Asymmetric: A favoriting B does not imply B favoriting A.
// 100-favorite cap enforced here so users get a friendly error rather than a
// raw constraint violation (the DB has no cap; this is application-layer).
import { z } from "zod";
import { TRPCError } from "@trpc/server";
import { and, eq, sql } from "drizzle-orm";
import { router, protectedProcedure, adminProcedure } from "../_core/trpc";
import { getDb } from "../db";
import { userFavorites } from "../../drizzle/schema";
import { recordChatAction } from "../_core/chatAudit";

const FAVORITES_CAP = 100;

const adminSubRouter = router({
  addFor: adminProcedure
    .input(z.object({ ownerId: z.number().int(), favoriteId: z.number().int(), reason: z.string().min(1) }))
    .mutation(async ({ input, ctx }) => {
      if (input.ownerId === input.favoriteId) {
        throw new TRPCError({ code: "BAD_REQUEST", message: "Cannot self-favorite." });
      }
      const db = await getDb();
      if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "DB unavailable" });

      const result = await db.transaction(async (tx) => {
        const ins = await tx
          .insert(userFavorites)
          .values({ followerId: input.ownerId, favoriteId: input.favoriteId })
          .onConflictDoNothing()
          .returning({ id: userFavorites.id });
        await recordChatAction({
          tx,
          actorId: ctx.user.id,
          actorRole: "admin",
          action: "favorite_added",
          targetUserId: input.ownerId,
          reason: input.reason,
          metadata: { affected_user: input.favoriteId },
        });
        return { added: ins.length > 0 };
      });

      return result;
    }),

  removeFor: adminProcedure
    .input(z.object({ ownerId: z.number().int(), favoriteId: z.number().int(), reason: z.string().min(1) }))
    .mutation(async ({ input, ctx }) => {
      const db = await getDb();
      if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "DB unavailable" });

      const result = await db.transaction(async (tx) => {
        const del = await tx
          .delete(userFavorites)
          .where(
            and(
              eq(userFavorites.followerId, input.ownerId),
              eq(userFavorites.favoriteId, input.favoriteId),
            ),
          )
          .returning({ id: userFavorites.id });
        await recordChatAction({
          tx,
          actorId: ctx.user.id,
          actorRole: "admin",
          action: "favorite_removed",
          targetUserId: input.ownerId,
          reason: input.reason,
          metadata: { affected_user: input.favoriteId },
        });
        return { removed: del.length > 0 };
      });

      return result;
    }),
});

export const favoritesRouter = router({
  add: protectedProcedure
    .input(z.object({ userId: z.number().int() }))
    .mutation(async ({ input, ctx }) => {
      if (input.userId === ctx.user.id) {
        throw new TRPCError({ code: "BAD_REQUEST", message: "You cannot favorite yourself." });
      }
      const db = await getDb();
      if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "DB unavailable" });

      // Check cap before insert. (DB has no cap; UX clarity wins here.)
      const [{ count }] = await db
        .select({ count: sql<number>`COUNT(*)::int` })
        .from(userFavorites)
        .where(eq(userFavorites.followerId, ctx.user.id));
      if (count >= FAVORITES_CAP) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: `You've reached your favorites limit (${FAVORITES_CAP}). Remove one to add another.`,
        });
      }

      // Idempotent insert — UNIQUE(follower_id, favorite_id) on the table
      // protects us from races. ON CONFLICT DO NOTHING lets us tell the
      // caller whether it was a new add or a no-op.
      const result = await db
        .insert(userFavorites)
        .values({ followerId: ctx.user.id, favoriteId: input.userId })
        .onConflictDoNothing()
        .returning({ id: userFavorites.id });

      const added = result.length > 0;
      return { added, totalFavorites: added ? count + 1 : count };
    }),

  remove: protectedProcedure
    .input(z.object({ userId: z.number().int() }))
    .mutation(async ({ input, ctx }) => {
      const db = await getDb();
      if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "DB unavailable" });
      const result = await db
        .delete(userFavorites)
        .where(
          and(
            eq(userFavorites.followerId, ctx.user.id),
            eq(userFavorites.favoriteId, input.userId),
          ),
        )
        .returning({ id: userFavorites.id });
      return { removed: result.length > 0 };
    }),

  list: protectedProcedure.query(async ({ ctx }) => {
    const db = await getDb();
    if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "DB unavailable" });
    const rows = await db
      .select()
      .from(userFavorites)
      .where(eq(userFavorites.followerId, ctx.user.id))
      .orderBy(sql`${userFavorites.createdAt} DESC`);
    return rows;
  }),

  countForUser: protectedProcedure
    .input(z.object({ userId: z.number().int() }))
    .query(async ({ input }) => {
      const db = await getDb();
      if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "DB unavailable" });
      const [{ count }] = await db
        .select({ count: sql<number>`COUNT(*)::int` })
        .from(userFavorites)
        .where(eq(userFavorites.followerId, input.userId));
      return { count };
    }),

  followerCountForMe: protectedProcedure.query(async ({ ctx }) => {
    const db = await getDb();
    if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "DB unavailable" });
    const [{ count }] = await db
      .select({ count: sql<number>`COUNT(*)::int` })
      .from(userFavorites)
      .where(eq(userFavorites.favoriteId, ctx.user.id));
    return { count };
  }),

  admin: adminSubRouter,
});
