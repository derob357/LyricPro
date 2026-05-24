// Tournaments tRPC router. User-facing procedures only in this file.
// Admin procedures live on the .admin sub-router (Task 3).
import { z } from "zod";
import { TRPCError } from "@trpc/server";
import { and, eq, sql, isNull } from "drizzle-orm";
import { router, protectedProcedure } from "../_core/trpc";
import { getDb } from "../db";
import {
  tournaments,
  tournamentMembers,
  chatRoomMembers,
} from "../../drizzle/schema";
import { spendGoldenNotes } from "../_core/goldenNotesLedger";
import { recordChatAction } from "../_core/chatAudit";
import { tournamentsAdminRouter } from "./tournaments.admin";

export const tournamentsRouter = router({
  listOpen: protectedProcedure.query(async () => {
    const db = await getDb();
    if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "DB unavailable" });
    const rows = await db
      .select()
      .from(tournaments)
      .where(eq(tournaments.status, "open"))
      .orderBy(sql`${tournaments.startsAt} ASC`);
    return rows;
  }),

  getById: protectedProcedure
    .input(z.object({ id: z.number().int() }))
    .query(async ({ input }) => {
      const db = await getDb();
      if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "DB unavailable" });

      const [tournament] = await db
        .select()
        .from(tournaments)
        .where(eq(tournaments.id, input.id));
      if (!tournament) {
        throw new TRPCError({ code: "NOT_FOUND", message: "Tournament not found" });
      }

      const [{ count }] = await db
        .select({ count: sql<number>`COUNT(*)::int` })
        .from(tournamentMembers)
        .where(
          and(
            eq(tournamentMembers.tournamentId, input.id),
            isNull(tournamentMembers.leftAt),
          ),
        );

      return { tournament, rosterSize: count };
    }),

  myMemberships: protectedProcedure.query(async ({ ctx }) => {
    const db = await getDb();
    if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "DB unavailable" });
    const rows = await db
      .select({
        tournamentId: tournamentMembers.tournamentId,
        joinedAt: tournamentMembers.joinedAt,
        entryMethod: tournamentMembers.entryMethod,
        name: tournaments.name,
        status: tournaments.status,
        chatRoomId: tournaments.chatRoomId,
      })
      .from(tournamentMembers)
      .innerJoin(tournaments, eq(tournamentMembers.tournamentId, tournaments.id))
      .where(
        and(
          eq(tournamentMembers.userId, ctx.user.id),
          isNull(tournamentMembers.leftAt),
        ),
      )
      .orderBy(sql`${tournamentMembers.joinedAt} DESC`);
    return rows;
  }),

  payEntry: protectedProcedure
    .input(z.object({ tournamentId: z.number().int() }))
    .mutation(async ({ input, ctx }) => {
      const db = await getDb();
      if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "DB unavailable" });

      const result = await db.transaction(async (tx) => {
        // 1. Lock the tournament row + read entry cost & status & capacity
        const [t] = await tx
          .select()
          .from(tournaments)
          .where(eq(tournaments.id, input.tournamentId))
          .for("update");
        if (!t) throw new TRPCError({ code: "NOT_FOUND", message: "Tournament not found" });
        if (t.status !== "open") {
          throw new TRPCError({
            code: "BAD_REQUEST",
            message: "Tournament is closed and not open for entry.",
          });
        }

        // 2. Capacity check
        if (t.capacity != null) {
          const [{ count }] = await tx
            .select({ count: sql<number>`COUNT(*)::int` })
            .from(tournamentMembers)
            .where(
              and(
                eq(tournamentMembers.tournamentId, input.tournamentId),
                isNull(tournamentMembers.leftAt),
              ),
            );
          if (count >= t.capacity) {
            throw new TRPCError({ code: "BAD_REQUEST", message: "Tournament is full." });
          }
        }

        // 3. Already-member check (active only)
        const existing = await tx
          .select()
          .from(tournamentMembers)
          .where(
            and(
              eq(tournamentMembers.tournamentId, input.tournamentId),
              eq(tournamentMembers.userId, ctx.user.id),
              isNull(tournamentMembers.leftAt),
            ),
          )
          .limit(1);
        if (existing.length > 0) {
          throw new TRPCError({
            code: "BAD_REQUEST",
            message: "You're already a member of this tournament.",
          });
        }

        // 4. Spend GN (throws if insufficient)
        const { newBalance } = await spendGoldenNotes(
          tx,
          ctx.user.id,
          t.entryCostGn,
          "spend_tournament",
          `Tournament entry: ${t.name}`,
        );

        // 5. Insert roster row
        await tx.insert(tournamentMembers).values({
          tournamentId: input.tournamentId,
          userId: ctx.user.id,
          entryMethod: "paid",
          gnSpent: t.entryCostGn,
        });

        // 6. Insert chat_room_members row so unread tracking starts at 0
        if (t.chatRoomId != null) {
          await tx
            .insert(chatRoomMembers)
            .values({ userId: ctx.user.id, roomId: t.chatRoomId, lastReadSeq: 0 })
            .onConflictDoNothing();
        }

        // 7. Audit
        await recordChatAction({
          tx,
          actorId: ctx.user.id,
          actorRole: "user",
          action: "tournament_join_paid",
          targetUserId: ctx.user.id,
          targetTournamentId: input.tournamentId,
          reason: `paid ${t.entryCostGn} GN`,
        });

        return { newBalance };
      });

      return { success: true as const, newBalance: result.newBalance };
    }),

  // Admin sub-router lives in tournaments.admin.ts and is composed here.
  admin: tournamentsAdminRouter,
});
