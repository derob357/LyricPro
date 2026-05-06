import { z } from "zod";
import { and, eq, sql } from "drizzle-orm";
import { TRPCError } from "@trpc/server";
import { notifyOwner } from "./notification";
import { sendFeedbackEmail } from "./sendFeedbackEmail";
import { adminProcedure, publicProcedure, router } from "./trpc";
import { getDb } from "../db";
import { songs } from "../../drizzle/schema";

export const systemRouter = router({
  health: publicProcedure
    .input(
      z.object({
        timestamp: z.number().min(0, "timestamp cannot be negative"),
      })
    )
    .query(() => ({
      ok: true,
    })),

  // Live count of playable songs — used by the Home page "Song Catalog"
  // stat so the displayed number stays in sync with the actual library
  // (the expand-library script can grow it; songs can be deactivated).
  libraryStats: publicProcedure.query(async () => {
    const db = await getDb();
    if (!db) return { totalSongs: 0 };
    const [row] = await db
      .select({ count: sql<number>`count(*)::int` })
      .from(songs)
      .where(and(eq(songs.isActive, true), eq(songs.approvalStatus, "approved")));
    return { totalSongs: row?.count ?? 0 };
  }),

  notifyOwner: adminProcedure
    .input(
      z.object({
        title: z.string().min(1, "title is required"),
        content: z.string().min(1, "content is required"),
      })
    )
    .mutation(async ({ input }) => {
      const delivered = await notifyOwner(input);
      return {
        success: delivered,
      } as const;
    }),

  submitFeedback: publicProcedure
    .input(
      z.object({
        name: z.string().min(1, "name is required"),
        email: z.string().email("valid email is required"),
        message: z.string().min(1, "message is required"),
        type: z.enum(["feedback", "support", "bug"]),
      })
    )
    .mutation(async ({ input }) => {
      try {
        await sendFeedbackEmail(input);
      } catch (err) {
        console.error("[submitFeedback] send failed:", err);
        throw new TRPCError({
          code: "INTERNAL_SERVER_ERROR",
          message:
            "We couldn't send your feedback right now. Please try again in a minute.",
        });
      }
      return { success: true } as const;
    }),
});
