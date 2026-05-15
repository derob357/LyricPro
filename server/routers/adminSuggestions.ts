import { z } from "zod";
import { eq, asc } from "drizzle-orm";
import { adminProcedure, router } from "../_core/trpc";
import { getDb } from "../db";
import { suggestionRules, commentaryTemplates } from "../../drizzle/schema";
import { TRPCError } from "@trpc/server";

export const adminSuggestionsRouter = router({
  // ── Suggestion Rules ────────────────────────────────────────────────────
  listRules: adminProcedure.query(async () => {
    const db = await getDb();
    if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR" });
    return db.select().from(suggestionRules).orderBy(asc(suggestionRules.priority));
  }),

  updateRule: adminProcedure
    .input(z.object({
      id: z.number().int(),
      text: z.string().min(1).optional(),
      action: z.string().min(1).optional(),
      priority: z.number().int().optional(),
      isActive: z.boolean().optional(),
    }))
    .mutation(async ({ input }) => {
      const db = await getDb();
      if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR" });
      const { id, ...patch } = input;
      const set: Record<string, unknown> = { updatedAt: new Date() };
      if (patch.text !== undefined) set.text = patch.text;
      if (patch.action !== undefined) set.action = patch.action;
      if (patch.priority !== undefined) set.priority = patch.priority;
      if (patch.isActive !== undefined) set.isActive = patch.isActive;
      const [updated] = await db.update(suggestionRules).set(set).where(eq(suggestionRules.id, id)).returning();
      if (!updated) throw new TRPCError({ code: "NOT_FOUND" });
      return updated;
    }),

  createRule: adminProcedure
    .input(z.object({
      category: z.enum(["mode", "upsell"]),
      triggerKey: z.string().min(1).max(64),
      text: z.string().min(1),
      action: z.string().min(1),
      priority: z.number().int().default(100),
    }))
    .mutation(async ({ input }) => {
      const db = await getDb();
      if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR" });
      const [created] = await db.insert(suggestionRules).values(input).returning();
      return created;
    }),

  deleteRule: adminProcedure
    .input(z.object({ id: z.number().int() }))
    .mutation(async ({ input }) => {
      const db = await getDb();
      if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR" });
      await db.delete(suggestionRules).where(eq(suggestionRules.id, input.id));
      return { ok: true };
    }),

  // ── Commentary Templates ────────────────────────────────────────────────
  listTemplates: adminProcedure.query(async () => {
    const db = await getDb();
    if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR" });
    return db.select().from(commentaryTemplates).orderBy(asc(commentaryTemplates.triggerKey), asc(commentaryTemplates.priority));
  }),

  updateTemplate: adminProcedure
    .input(z.object({
      id: z.number().int(),
      triggerKey: z.string().min(1).max(64).optional(),
      text: z.string().min(1).optional(),
      priority: z.number().int().optional(),
      isActive: z.boolean().optional(),
    }))
    .mutation(async ({ input }) => {
      const db = await getDb();
      if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR" });
      const { id, ...patch } = input;
      const set: Record<string, unknown> = { updatedAt: new Date() };
      if (patch.triggerKey !== undefined) set.triggerKey = patch.triggerKey;
      if (patch.text !== undefined) set.text = patch.text;
      if (patch.priority !== undefined) set.priority = patch.priority;
      if (patch.isActive !== undefined) set.isActive = patch.isActive;
      const [updated] = await db.update(commentaryTemplates).set(set).where(eq(commentaryTemplates.id, id)).returning();
      if (!updated) throw new TRPCError({ code: "NOT_FOUND" });
      return updated;
    }),

  createTemplate: adminProcedure
    .input(z.object({
      triggerKey: z.string().min(1).max(64),
      text: z.string().min(1),
      priority: z.number().int().default(100),
    }))
    .mutation(async ({ input }) => {
      const db = await getDb();
      if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR" });
      const [created] = await db.insert(commentaryTemplates).values(input).returning();
      return created;
    }),

  deleteTemplate: adminProcedure
    .input(z.object({ id: z.number().int() }))
    .mutation(async ({ input }) => {
      const db = await getDb();
      if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR" });
      await db.delete(commentaryTemplates).where(eq(commentaryTemplates.id, input.id));
      return { ok: true };
    }),
});
