import { z } from "zod";
import { eq } from "drizzle-orm";
import { adminProcedure, router } from "../_core/trpc";
import { getDb } from "../db";
import { songs } from "../../drizzle/schema";
import { recordAdminAction } from "../_core/audit";
import { TRPCError } from "@trpc/server";
import { normalizeLyricText, validateLyricFields } from "../_core/lyricNormalize";

// difficulty: z.null() means "clear the tag (Inherit)"; z.undefined means "no change".
// JSON serialization drops undefined keys, so we use null as the explicit clear sentinel.
const variantPatchSchema = z.object({
  prompt: z.string().optional(),
  answer: z.string().optional(),
  distractors: z.array(z.string()).optional(),
  sectionType: z.string().optional(),
  difficulty: z.enum(["low", "medium", "high"]).nullable().optional(),
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
        // Normalize text fields before writing.
        const normalizedPatch: Record<string, unknown> = { ...input.patch };
        if (typeof normalizedPatch.prompt === "string") {
          normalizedPatch.prompt = normalizeLyricText(normalizedPatch.prompt as string);
        }
        if (typeof normalizedPatch.answer === "string") {
          normalizedPatch.answer = normalizeLyricText(normalizedPatch.answer as string);
        }
        if (Array.isArray(normalizedPatch.distractors)) {
          normalizedPatch.distractors = (normalizedPatch.distractors as string[]).map(normalizeLyricText);
        }
        // Validate the resolved prompt + answer.
        const resolvedPrompt = typeof normalizedPatch.prompt === "string" ? normalizedPatch.prompt : before.prompt;
        const resolvedAnswer = typeof normalizedPatch.answer === "string" ? normalizedPatch.answer : before.answer;
        const validation = validateLyricFields(resolvedPrompt, resolvedAnswer);
        if (!validation.ok) {
          throw new TRPCError({
            code: "BAD_REQUEST",
            message: `Lyric validation failed: ${validation.issues.join(" ")}`,
          });
        }
        // Build after object: spread before + normalizedPatch, then handle difficulty null (clear).
        const after = { ...before, ...normalizedPatch } as typeof before;
        if (normalizedPatch.difficulty === null) {
          // null means "clear the explicit tag" (back to Inherit / heuristic).
          delete after.difficulty;
        }
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
        const normalizedPrompt = normalizeLyricText(input.variant.prompt!);
        const normalizedAnswer = normalizeLyricText(input.variant.answer!);
        const validation = validateLyricFields(normalizedPrompt, normalizedAnswer);
        if (!validation.ok) {
          throw new TRPCError({
            code: "BAD_REQUEST",
            message: `Lyric validation failed: ${validation.issues.join(" ")}`,
          });
        }
        const newVariant: {
          prompt: string;
          answer: string;
          distractors: string[];
          sectionType: string;
          difficulty?: "low" | "medium" | "high";
        } = {
          prompt: normalizedPrompt,
          answer: normalizedAnswer,
          distractors: (input.variant.distractors ?? []).map(normalizeLyricText),
          sectionType: input.variant.sectionType!,
        };
        // null means "no explicit tag" for create — omit the key entirely.
        if (input.variant.difficulty && input.variant.difficulty !== null) {
          newVariant.difficulty = input.variant.difficulty;
        }
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
