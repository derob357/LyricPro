import { z } from "zod";
import { eq } from "drizzle-orm";
import { adminProcedure, router } from "../_core/trpc";
import { getDb } from "../db";
import { songs } from "../../drizzle/schema";
import { recordAdminAction } from "../_core/audit";
import { TRPCError } from "@trpc/server";

const variantPatchSchema = z.object({
  prompt: z.string().optional(),
  answer: z.string().optional(),
  distractors: z.array(z.string()).optional(),
  sectionType: z.string().optional(),
});

export const adminVariantsRouter = router({
  update: adminProcedure
    .input(z.object({
      songId: z.number().int(),
      variantIndex: z.number().int().min(0),
      patch: variantPatchSchema,
    }))
    .mutation(async ({ ctx, input }) => {
      const db = await getDb();
      if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "DB unavailable" });
      return await db.transaction(async (tx) => {
        const [song] = await tx.select().from(songs).where(eq(songs.id, input.songId)).limit(1);
        if (!song) throw new TRPCError({ code: "NOT_FOUND" });
        const variants = Array.isArray(song.lyricVariants) ? [...song.lyricVariants] : [];
        if (input.variantIndex >= variants.length) {
          throw new TRPCError({ code: "BAD_REQUEST", message: "variantIndex out of range" });
        }
        const before = variants[input.variantIndex];
        const after = { ...before, ...input.patch };
        variants[input.variantIndex] = after;
        await tx.update(songs).set({ lyricVariants: variants, updatedAt: new Date() })
          .where(eq(songs.id, input.songId));
        await recordAdminAction({
          ctx, tx,
          action: "lyric_variant.update",
          targetType: "lyric_variant",
          targetId: String(input.songId),
          targetVariantIndex: input.variantIndex,
          payload: { before, after, params: input.patch },
        });
        return after;
      });
    }),

  create: adminProcedure
    .input(z.object({
      songId: z.number().int(),
      variant: variantPatchSchema.required({ prompt: true, answer: true, sectionType: true }),
    }))
    .mutation(async ({ ctx, input }) => {
      const db = await getDb();
      if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "DB unavailable" });
      return await db.transaction(async (tx) => {
        const [song] = await tx.select().from(songs).where(eq(songs.id, input.songId)).limit(1);
        if (!song) throw new TRPCError({ code: "NOT_FOUND" });
        const variants = Array.isArray(song.lyricVariants) ? [...song.lyricVariants] : [];
        const newVariant = {
          prompt: input.variant.prompt!,
          answer: input.variant.answer!,
          distractors: input.variant.distractors ?? [],
          sectionType: input.variant.sectionType!,
        };
        variants.push(newVariant);
        await tx.update(songs).set({ lyricVariants: variants, updatedAt: new Date() })
          .where(eq(songs.id, input.songId));
        const newIndex = variants.length - 1;
        await recordAdminAction({
          ctx, tx,
          action: "lyric_variant.create",
          targetType: "lyric_variant",
          targetId: String(input.songId),
          targetVariantIndex: newIndex,
          payload: { after: newVariant },
        });
        return { variantIndex: newIndex, variant: newVariant };
      });
    }),

  delete: adminProcedure
    .input(z.object({
      songId: z.number().int(),
      variantIndex: z.number().int().min(0),
    }))
    .mutation(async ({ ctx, input }) => {
      const db = await getDb();
      if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "DB unavailable" });
      return await db.transaction(async (tx) => {
        const [song] = await tx.select().from(songs).where(eq(songs.id, input.songId)).limit(1);
        if (!song) throw new TRPCError({ code: "NOT_FOUND" });
        const variants = Array.isArray(song.lyricVariants) ? [...song.lyricVariants] : [];
        if (input.variantIndex >= variants.length) {
          throw new TRPCError({ code: "BAD_REQUEST", message: "variantIndex out of range" });
        }
        const removed = variants.splice(input.variantIndex, 1)[0];
        await tx.update(songs).set({ lyricVariants: variants, updatedAt: new Date() })
          .where(eq(songs.id, input.songId));
        await recordAdminAction({
          ctx, tx,
          action: "lyric_variant.delete",
          targetType: "lyric_variant",
          targetId: String(input.songId),
          targetVariantIndex: input.variantIndex,
          payload: { before: removed },
        });
        return { removedVariantIndex: input.variantIndex };
      });
    }),
});
