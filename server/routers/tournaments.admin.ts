// Tournaments admin sub-router. All procedures require role='admin'.
import { z } from "zod";
import { TRPCError } from "@trpc/server";
import { and, eq, isNull } from "drizzle-orm";
import { router, adminProcedure } from "../_core/trpc";
import { getDb } from "../db";
import {
  tournaments,
  tournamentMembers,
  chatRooms,
} from "../../drizzle/schema";
import { creditGoldenNotes } from "../_core/goldenNotesLedger";
import { recordChatAction } from "../_core/chatAudit";

const NameSchema = z.string().min(1).max(128);

export const tournamentsAdminRouter = router({
  create: adminProcedure
    .input(
      z.object({
        name: NameSchema,
        description: z.string().optional(),
        entryCostGn: z.number().int().min(0).default(0),
        capacity: z.number().int().min(1).optional(),
        startsAt: z.string().datetime(),
        endsAt: z.string().datetime(),
        prizePoolId: z.number().int().optional(),
      }),
    )
    .mutation(async ({ input, ctx }) => {
      const db = await getDb();
      if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "DB unavailable" });

      // NOTE on insertion order: migration 0013 adds CHECK constraint
      // chat_rooms_tournament_required which requires
      //   (kind='tournament' AND tournament_id IS NOT NULL)
      // The constraint is non-deferrable so we cannot insert a tournament-kind
      // chat_rooms row with a NULL tournament_id and patch it later. Instead:
      //   1. Insert tournament with chat_room_id=NULL (allowed; the FK is
      //      nullable).
      //   2. Insert chat_rooms with tournament_id already set (constraint
      //      satisfied at INSERT time).
      //   3. UPDATE tournament with chat_room_id (closes the bidirectional
      //      link).
      const result = await db.transaction(async (tx) => {
        // 1. Insert tournament with chat_room_id=NULL
        const [t] = await tx
          .insert(tournaments)
          .values({
            name: input.name,
            description: input.description ?? null,
            entryCostGn: input.entryCostGn,
            capacity: input.capacity ?? null,
            startsAt: new Date(input.startsAt),
            endsAt: new Date(input.endsAt),
            chatRoomId: null,
            status: "draft",
            prizePoolId: input.prizePoolId ?? null,
            createdBy: ctx.user.id,
          })
          .returning();

        // 2. Insert chat_rooms WITH tournament_id set (CHECK constraint satisfied)
        const [room] = await tx
          .insert(chatRooms)
          .values({ kind: "tournament", tournamentId: t.id, retentionDays: 60 })
          .returning();

        // 3. UPDATE tournament with chat_room_id (closes bidirectional link)
        await tx
          .update(tournaments)
          .set({ chatRoomId: room.id })
          .where(eq(tournaments.id, t.id));

        // 4. Audit
        await recordChatAction({
          tx,
          actorId: ctx.user.id,
          actorRole: "admin",
          action: "tournament_create",
          targetTournamentId: t.id,
          reason: `created ${t.name}`,
          metadata: { entryCostGn: t.entryCostGn, capacity: t.capacity },
        });

        return { id: t.id, chatRoomId: room.id };
      });

      return result;
    }),

  update: adminProcedure
    .input(
      z.object({
        id: z.number().int(),
        name: NameSchema.optional(),
        description: z.string().optional(),
      }),
    )
    .mutation(async ({ input, ctx }) => {
      const db = await getDb();
      if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "DB unavailable" });

      const result = await db.transaction(async (tx) => {
        const [updated] = await tx
          .update(tournaments)
          .set({
            ...(input.name != null ? { name: input.name } : {}),
            ...(input.description !== undefined ? { description: input.description } : {}),
            updatedAt: new Date(),
          })
          .where(eq(tournaments.id, input.id))
          .returning();
        if (!updated) throw new TRPCError({ code: "NOT_FOUND", message: "Tournament not found" });

        await recordChatAction({
          tx,
          actorId: ctx.user.id,
          actorRole: "admin",
          action: "tournament_update",
          targetTournamentId: input.id,
          reason: "metadata update",
        });

        return updated;
      });

      return result;
    }),

  openTournament: adminProcedure
    .input(z.object({ id: z.number().int() }))
    .mutation(async ({ input, ctx }) => transitionStatus(input.id, ctx.user.id, "draft", "open")),

  startTournament: adminProcedure
    .input(z.object({ id: z.number().int() }))
    .mutation(async ({ input, ctx }) => transitionStatus(input.id, ctx.user.id, "open", "in_progress")),

  completeTournament: adminProcedure
    .input(z.object({ id: z.number().int() }))
    .mutation(async ({ input, ctx }) => transitionStatus(input.id, ctx.user.id, "in_progress", "completed")),

  cancelTournament: adminProcedure
    .input(z.object({ id: z.number().int(), reason: z.string().min(1) }))
    .mutation(async ({ input, ctx }) => {
      const db = await getDb();
      if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "DB unavailable" });

      const result = await db.transaction(async (tx) => {
        const [t] = await tx
          .select()
          .from(tournaments)
          .where(eq(tournaments.id, input.id))
          .for("update");
        if (!t) throw new TRPCError({ code: "NOT_FOUND", message: "Tournament not found" });
        if (t.status === "completed" || t.status === "cancelled") {
          throw new TRPCError({ code: "BAD_REQUEST", message: `Already ${t.status}` });
        }

        await tx
          .update(tournaments)
          .set({ status: "cancelled", updatedAt: new Date() })
          .where(eq(tournaments.id, input.id));

        // Refund paid members
        const paidMembers = await tx
          .select()
          .from(tournamentMembers)
          .where(
            and(
              eq(tournamentMembers.tournamentId, input.id),
              eq(tournamentMembers.entryMethod, "paid"),
              isNull(tournamentMembers.leftAt),
            ),
          );

        for (const m of paidMembers) {
          await creditGoldenNotes(
            tx,
            m.userId,
            m.gnSpent,
            "refund",
            `Refund: tournament "${t.name}" cancelled`,
          );
          await recordChatAction({
            tx,
            actorId: ctx.user.id,
            actorRole: "admin",
            action: "tournament_remove_member",
            targetUserId: m.userId,
            targetTournamentId: input.id,
            reason: `refund on cancel (${m.gnSpent} GN)`,
            metadata: { refunded: true, amount: m.gnSpent },
          });
        }

        await recordChatAction({
          tx,
          actorId: ctx.user.id,
          actorRole: "admin",
          action: "tournament_cancel",
          targetTournamentId: input.id,
          reason: input.reason,
          metadata: { refundedCount: paidMembers.length },
        });

        return { refundedCount: paidMembers.length };
      });

      return result;
    }),

  addMember: adminProcedure
    .input(
      z.object({
        tournamentId: z.number().int(),
        userId: z.number().int(),
        method: z.enum(["admin_invited", "comp"]),
      }),
    )
    .mutation(async ({ input, ctx }) => {
      const db = await getDb();
      if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "DB unavailable" });

      await db.transaction(async (tx) => {
        await tx
          .insert(tournamentMembers)
          .values({
            tournamentId: input.tournamentId,
            userId: input.userId,
            entryMethod: input.method,
            gnSpent: 0,
          })
          .onConflictDoNothing();

        await recordChatAction({
          tx,
          actorId: ctx.user.id,
          actorRole: "admin",
          action: "tournament_add_member",
          targetUserId: input.userId,
          targetTournamentId: input.tournamentId,
          reason: input.method,
        });
      });

      return { success: true as const };
    }),

  removeMember: adminProcedure
    .input(
      z.object({
        tournamentId: z.number().int(),
        userId: z.number().int(),
        refundGn: z.boolean(),
        reason: z.string().min(1),
      }),
    )
    .mutation(async ({ input, ctx }) => {
      const db = await getDb();
      if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "DB unavailable" });

      const result = await db.transaction(async (tx) => {
        const [m] = await tx
          .select()
          .from(tournamentMembers)
          .where(
            and(
              eq(tournamentMembers.tournamentId, input.tournamentId),
              eq(tournamentMembers.userId, input.userId),
              isNull(tournamentMembers.leftAt),
            ),
          );
        if (!m) throw new TRPCError({ code: "NOT_FOUND", message: "Member not found" });

        await tx
          .update(tournamentMembers)
          .set({ leftAt: new Date() })
          .where(
            and(
              eq(tournamentMembers.tournamentId, input.tournamentId),
              eq(tournamentMembers.userId, input.userId),
            ),
          );

        let refunded = 0;
        if (input.refundGn && m.entryMethod === "paid" && m.gnSpent > 0) {
          await creditGoldenNotes(tx, input.userId, m.gnSpent, "refund", `Admin removed: ${input.reason}`);
          refunded = m.gnSpent;
        }

        await recordChatAction({
          tx,
          actorId: ctx.user.id,
          actorRole: "admin",
          action: "tournament_remove_member",
          targetUserId: input.userId,
          targetTournamentId: input.tournamentId,
          reason: input.reason,
          metadata: { refunded: refunded > 0, amount: refunded },
        });

        return { refunded };
      });

      return result;
    }),
});

async function transitionStatus(
  id: number,
  actorId: number,
  fromStatus: "draft" | "open" | "in_progress",
  toStatus: "open" | "in_progress" | "completed",
): Promise<{ status: "open" | "in_progress" | "completed" }> {
  const db = await getDb();
  if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "DB unavailable" });

  const result = await db.transaction(async (tx) => {
    const [t] = await tx
      .select()
      .from(tournaments)
      .where(eq(tournaments.id, id))
      .for("update");
    if (!t) throw new TRPCError({ code: "NOT_FOUND", message: "Tournament not found" });
    if (t.status !== fromStatus) {
      throw new TRPCError({
        code: "BAD_REQUEST",
        message: `Expected status ${fromStatus}, found ${t.status}`,
      });
    }

    await tx
      .update(tournaments)
      .set({ status: toStatus, updatedAt: new Date() })
      .where(eq(tournaments.id, id));

    await recordChatAction({
      tx,
      actorId,
      actorRole: "admin",
      action: "tournament_update",
      targetTournamentId: id,
      reason: `status: ${fromStatus} -> ${toStatus}`,
      metadata: { from: fromStatus, to: toStatus },
    });

    return { status: toStatus };
  });

  return result;
}
