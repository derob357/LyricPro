// server/routers/adminCuratedSets.ts
import { z } from "zod";
import { and, desc, eq, ilike, inArray } from "drizzle-orm";
import { adminProcedure, router } from "../_core/trpc";
import { getDb } from "../db";
import { curatedSongSets, songs } from "../../drizzle/schema";
import { TRPCError } from "@trpc/server";
import { recordAdminAction } from "../_core/audit";

const itemSchema = z.object({ songId: z.number().int(), variantIndex: z.number().int().nullable() });

export const adminCuratedSetsRouter = router({
  list: adminProcedure
    .input(z.object({ search: z.string().optional(), status: z.enum(["active", "draft"]).optional() }).default({}))
    .query(async ({ input }) => {
      const db = await getDb();
      if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "DB unavailable" });
      const conds = [];
      if (input.search) conds.push(ilike(curatedSongSets.name, `%${input.search}%`));
      if (input.status) conds.push(eq(curatedSongSets.status, input.status));
      const rows = await db.select().from(curatedSongSets)
        .where(conds.length ? and(...conds) : undefined)
        .orderBy(desc(curatedSongSets.updatedAt));
      return rows.map((r) => ({ id: r.id, name: r.name, description: r.description, status: r.status, songCount: r.items.length, updatedAt: r.updatedAt }));
    }),

  get: adminProcedure
    .input(z.object({ id: z.number().int() }))
    .query(async ({ input }) => {
      const db = await getDb();
      if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "DB unavailable" });
      const [set] = await db.select().from(curatedSongSets).where(eq(curatedSongSets.id, input.id)).limit(1);
      if (!set) throw new TRPCError({ code: "NOT_FOUND" });
      // Resolve song metadata + available variant prompts for the builder UI.
      const ids = set.items.map((i) => i.songId);
      const songRows = ids.length
        ? await db.select().from(songs).where(inArray(songs.id, ids))
        : [];
      const byId = new Map(songRows.map((s) => [s.id, s]));
      const resolvedItems = set.items.map((it) => {
        const s = byId.get(it.songId);
        const variants = (s?.lyricVariants ?? []) as Array<{ prompt: string }>;
        return {
          songId: it.songId,
          variantIndex: it.variantIndex,
          title: s?.title ?? "(missing song)",
          artistName: s?.artistName ?? "",
          available: !!s && s.isActive && s.approvalStatus === "approved",
          variantPrompts: variants.map((v) => v.prompt),
        };
      });
      return { id: set.id, name: set.name, description: set.description, status: set.status, items: resolvedItems };
    }),

  create: adminProcedure
    .input(z.object({ name: z.string().min(1), description: z.string().optional(), items: z.array(itemSchema).default([]), status: z.enum(["active", "draft"]).default("active") }))
    .mutation(async ({ ctx, input }) => {
      const db = await getDb();
      if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "DB unavailable" });
      return await db.transaction(async (tx) => {
        const [created] = await tx.insert(curatedSongSets).values({
          name: input.name, description: input.description ?? null, items: input.items, status: input.status, createdBy: ctx.user.id,
        }).returning();
        await recordAdminAction({ ctx, tx, action: "curatedSet.create", targetType: "curatedSet", targetId: String(created.id), payload: { after: created } });
        return created;
      });
    }),

  update: adminProcedure
    .input(z.object({ id: z.number().int(), patch: z.object({ name: z.string().min(1).optional(), description: z.string().nullable().optional(), items: z.array(itemSchema).optional(), status: z.enum(["active", "draft"]).optional() }) }))
    .mutation(async ({ ctx, input }) => {
      const db = await getDb();
      if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "DB unavailable" });
      return await db.transaction(async (tx) => {
        const [before] = await tx.select().from(curatedSongSets).where(eq(curatedSongSets.id, input.id)).limit(1);
        if (!before) throw new TRPCError({ code: "NOT_FOUND" });
        const [after] = await tx.update(curatedSongSets).set({ ...input.patch, updatedAt: new Date() }).where(eq(curatedSongSets.id, input.id)).returning();
        await recordAdminAction({ ctx, tx, action: "curatedSet.update", targetType: "curatedSet", targetId: String(input.id), payload: { before, after, params: input.patch } });
        return after;
      });
    }),

  delete: adminProcedure
    .input(z.object({ id: z.number().int() }))
    .mutation(async ({ ctx, input }) => {
      const db = await getDb();
      if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "DB unavailable" });
      return await db.transaction(async (tx) => {
        const [before] = await tx.select().from(curatedSongSets).where(eq(curatedSongSets.id, input.id)).limit(1);
        if (!before) throw new TRPCError({ code: "NOT_FOUND" });
        await tx.delete(curatedSongSets).where(eq(curatedSongSets.id, input.id));
        await recordAdminAction({ ctx, tx, action: "curatedSet.delete", targetType: "curatedSet", targetId: String(input.id), payload: { before } });
        return { ok: true };
      });
    }),

  // Builder helper: songs by an artist (active+approved), with variant prompts.
  songsByArtist: adminProcedure
    .input(z.object({ artist: z.string().min(1) }))
    .query(async ({ input }) => {
      const db = await getDb();
      if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "DB unavailable" });
      const rows = await db.select().from(songs).where(
        and(ilike(songs.artistName, `%${input.artist}%`), eq(songs.isActive, true), eq(songs.approvalStatus, "approved")),
      );
      return rows.map((s) => ({ id: s.id, title: s.title, artistName: s.artistName, variantPrompts: ((s.lyricVariants ?? []) as Array<{ prompt: string }>).map((v) => v.prompt) }));
    }),
});
