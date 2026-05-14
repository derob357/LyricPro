import { z } from "zod";
import { and, asc, eq, gt, sql } from "drizzle-orm";
import { adminProcedure, router } from "../_core/trpc";
import { getDb } from "../db";
import { songs } from "../../drizzle/schema";
import { TRPCError } from "@trpc/server";

const songStatusValues = ["active", "disabled", "pending"] as const;

export const adminSongsRouter = router({
  list: adminProcedure
    .input(
      z.object({
        limit: z.number().int().min(1).max(200).default(50),
        cursor: z.number().int().optional(),
        search: z.string().optional(),
        genre: z.string().optional(),
        decade: z.string().optional(),
        status: z.enum(songStatusValues).optional(),
        inCuratedBank: z.boolean().optional(),
      }),
    )
    .query(async ({ input }) => {
      const db = await getDb();
      if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "DB unavailable" });
      const where: any[] = [];
      if (input.cursor) where.push(gt(songs.id, input.cursor));
      if (input.search) {
        const pattern = `%${input.search}%`;
        where.push(
          sql`(${songs.title} ILIKE ${pattern} OR ${songs.artistName} ILIKE ${pattern})`
        );
      }
      if (input.genre) where.push(eq(songs.genre, input.genre));
      if (input.decade) where.push(eq(songs.decadeRange, input.decade));
      if (input.status === "active") {
        where.push(eq(songs.isActive, true));
        where.push(eq(songs.approvedForGame, true));
      }
      if (input.status === "disabled") where.push(eq(songs.isActive, false));
      if (input.status === "pending") where.push(eq(songs.approvalStatus, "pending"));
      if (input.inCuratedBank !== undefined) {
        where.push(eq(songs.inCuratedBank, input.inCuratedBank));
      }
      const rows = await db
        .select({
          id: songs.id,
          title: songs.title,
          artistName: songs.artistName,
          genre: songs.genre,
          releaseYear: songs.releaseYear,
          decadeRange: songs.decadeRange,
          isActive: songs.isActive,
          approvedForGame: songs.approvedForGame,
          approvalStatus: songs.approvalStatus,
          inCuratedBank: songs.inCuratedBank,
          displayCount: songs.displayCount,
          variantCount: sql<number>`COALESCE(jsonb_array_length(${songs.lyricVariants}), 0)::int`,
          updatedAt: songs.updatedAt,
        })
        .from(songs)
        .where(where.length ? and(...where) : undefined)
        .orderBy(asc(songs.id))
        .limit(input.limit + 1);
      const hasMore = rows.length > input.limit;
      const trimmed = hasMore ? rows.slice(0, input.limit) : rows;
      return {
        rows: trimmed,
        nextCursor: hasMore ? trimmed[trimmed.length - 1].id : null,
      };
    }),
});
