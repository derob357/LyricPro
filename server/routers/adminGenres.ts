import { z } from "zod";
import { eq, asc, isNull } from "drizzle-orm";
import { adminProcedure, publicProcedure, router } from "../_core/trpc";
import { getDb } from "../db";
import { genres } from "../../drizzle/schema";
import { TRPCError } from "@trpc/server";

export const adminGenresRouter = router({
  // Public: any caller can fetch the genre tree (used by SongEdit, GameSetup)
  list: publicProcedure.query(async () => {
    const db = await getDb();
    if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR" });
    return db.select().from(genres).orderBy(asc(genres.sortOrder), asc(genres.name));
  }),

  create: adminProcedure
    .input(z.object({
      name: z.string().min(1).max(64),
      parentId: z.number().int().nullable().default(null),
      sortOrder: z.number().int().default(100),
    }))
    .mutation(async ({ input }) => {
      const db = await getDb();
      if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR" });
      const [created] = await db.insert(genres).values(input).returning();
      return created;
    }),

  update: adminProcedure
    .input(z.object({
      id: z.number().int(),
      name: z.string().min(1).max(64).optional(),
      parentId: z.number().int().nullable().optional(),
      isActive: z.boolean().optional(),
      sortOrder: z.number().int().optional(),
    }))
    .mutation(async ({ input }) => {
      const db = await getDb();
      if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR" });
      const { id, ...patch } = input;
      const set: Record<string, unknown> = {};
      if (patch.name !== undefined) set.name = patch.name;
      if (patch.parentId !== undefined) set.parentId = patch.parentId;
      if (patch.isActive !== undefined) set.isActive = patch.isActive;
      if (patch.sortOrder !== undefined) set.sortOrder = patch.sortOrder;
      if (Object.keys(set).length === 0) throw new TRPCError({ code: "BAD_REQUEST" });
      const [updated] = await db.update(genres).set(set).where(eq(genres.id, id)).returning();
      if (!updated) throw new TRPCError({ code: "NOT_FOUND" });
      return updated;
    }),

  delete: adminProcedure
    .input(z.object({ id: z.number().int() }))
    .mutation(async ({ input }) => {
      const db = await getDb();
      if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR" });
      await db.delete(genres).where(eq(genres.id, input.id));
      return { ok: true };
    }),
});
