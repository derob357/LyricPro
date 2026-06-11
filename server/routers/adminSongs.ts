import { z } from "zod";
import { and, asc, desc, eq, gt, sql } from "drizzle-orm";
import type { AnyColumn } from "drizzle-orm";
import { adminProcedure, router } from "../_core/trpc";
import { getDb } from "../db";
import { songs } from "../../drizzle/schema";
import { TRPCError } from "@trpc/server";
import { recordAdminAction } from "../_core/audit";
import { normalizeLyricText, validateLyricFields } from "../_core/lyricNormalize";

const songStatusValues = ["active", "disabled", "pending"] as const;

const songPatchSchema = z.object({
  title: z.string().min(1).max(256).optional(),
  artistName: z.string().min(1).max(256).optional(),
  featuredArtist: z.string().max(256).nullable().optional(),
  genre: z.string().max(64).optional(),
  subgenre: z.string().max(64).nullable().optional(),
  releaseYear: z.number().int().min(1900).max(2100).optional(),
  decadeRange: z.string().max(32).optional(),
  difficulty: z.enum(["low", "medium", "high"]).optional(),
  lyricSectionType: z.enum(["chorus", "hook", "verse", "call-response", "bridge"]).optional(),
  explicitFlag: z.boolean().optional(),
  isActive: z.boolean().optional(),
  approvedForGame: z.boolean().optional(),
  inCuratedBank: z.boolean().optional(),
  approvalStatus: z.enum(["pending", "approved", "rejected"]).optional(),
  curatorNotes: z.string().nullable().optional(),
  iswc: z.string().max(15).nullable().optional(),
  isrc: z.string().max(15).nullable().optional(),
  songwriters: z.array(z.object({
    name: z.string(),
    share: z.number().optional(),
    ipiNumber: z.string().optional(),
  })).optional(),
  publishers: z.array(z.object({
    name: z.string(),
    share: z.number().optional(),
    territory: z.string().optional(),
  })).optional(),
  lyricSourceProvider: z.enum(["internal", "lyricfind", "musixmatch", "direct_publisher"]).optional(),
  providerTrackId: z.string().max(64).nullable().optional(),
});

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
        sortBy: z.enum(["title", "artistName", "genre", "releaseYear", "status", "displayCount"]).default("title"),
        sortDir: z.enum(["asc", "desc"]).default("asc"),
      }),
    )
    .query(async ({ input }) => {
      const db = await getDb();
      if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "DB unavailable" });

      // Build filter conditions shared by both the data query and the COUNT query.
      // The cursor condition is intentionally excluded — total reflects all matching
      // rows regardless of pagination position.
      const filterConditions: any[] = [];
      if (input.search) {
        const pattern = `%${input.search}%`;
        filterConditions.push(
          sql`(${songs.title} ILIKE ${pattern} OR ${songs.artistName} ILIKE ${pattern})`
        );
      }
      if (input.genre) filterConditions.push(eq(songs.genre, input.genre));
      if (input.decade) filterConditions.push(eq(songs.decadeRange, input.decade));
      if (input.status === "active") {
        filterConditions.push(eq(songs.isActive, true));
        filterConditions.push(eq(songs.approvedForGame, true));
      }
      if (input.status === "disabled") filterConditions.push(eq(songs.isActive, false));
      if (input.status === "pending") filterConditions.push(eq(songs.approvalStatus, "pending"));
      if (input.inCuratedBank !== undefined) {
        filterConditions.push(eq(songs.inCuratedBank, input.inCuratedBank));
      }

      // Cursor condition applied only to the data query (keeps pagination working
      // while the total stays filter-scoped, not cursor-scoped).
      const dataConditions = input.cursor
        ? [...filterConditions, gt(songs.id, input.cursor)]
        : filterConditions;

      const sortColumnMap: Record<string, AnyColumn> = {
        title: songs.title,
        artistName: songs.artistName,
        genre: songs.genre,
        releaseYear: songs.releaseYear,
        status: songs.isActive,
        displayCount: songs.displayCount,
      };
      const sortCol = sortColumnMap[input.sortBy] ?? songs.title;
      const orderFn = input.sortDir === "desc" ? desc : asc;

      const [rows, countResult] = await Promise.all([
        db
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
          .where(dataConditions.length ? and(...dataConditions) : undefined)
          .orderBy(orderFn(sortCol), asc(songs.id))
          .limit(input.limit + 1),
        db
          .select({ total: sql<number>`COUNT(*)::int` })
          .from(songs)
          .where(filterConditions.length ? and(...filterConditions) : undefined),
      ]);

      const hasMore = rows.length > input.limit;
      const trimmed = hasMore ? rows.slice(0, input.limit) : rows;
      return {
        rows: trimmed,
        nextCursor: hasMore ? trimmed[trimmed.length - 1].id : null,
        total: countResult[0]?.total ?? 0,
      };
    }),

  get: adminProcedure
    .input(z.object({ id: z.number().int() }))
    .query(async ({ input }) => {
      const db = await getDb();
      if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "DB unavailable" });
      const [row] = await db.select().from(songs).where(eq(songs.id, input.id)).limit(1);
      if (!row) throw new TRPCError({ code: "NOT_FOUND" });
      return row;
    }),

  update: adminProcedure
    .input(z.object({ id: z.number().int(), patch: songPatchSchema }))
    .mutation(async ({ ctx, input }) => {
      const db = await getDb();
      if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "DB unavailable" });
      return await db.transaction(async (tx) => {
        const [before] = await tx.select().from(songs).where(eq(songs.id, input.id)).limit(1);
        if (!before) throw new TRPCError({ code: "NOT_FOUND" });
        const [after] = await tx
          .update(songs)
          .set({ ...input.patch, updatedAt: new Date() })
          .where(eq(songs.id, input.id))
          .returning();
        await recordAdminAction({
          ctx, tx,
          action: "song.update",
          targetType: "song",
          targetId: String(input.id),
          payload: { before, after, params: input.patch },
        });
        return after;
      });
    }),

  create: adminProcedure
    .input(songPatchSchema.extend({
      title: z.string().min(1).max(256),
      artistName: z.string().min(1).max(256),
      genre: z.string().max(64),
      releaseYear: z.number().int(),
      decadeRange: z.string().max(32),
      difficulty: z.enum(["low", "medium", "high"]),
      lyricSectionType: z.enum(["chorus","hook","verse","call-response","bridge"]),
      lyricPrompt: z.string(),
      lyricAnswer: z.string(),
    }))
    .mutation(async ({ ctx, input }) => {
      const db = await getDb();
      if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "DB unavailable" });
      // Normalize lyric text fields before insert.
      const normalizedPrompt = normalizeLyricText(input.lyricPrompt);
      const normalizedAnswer = normalizeLyricText(input.lyricAnswer);
      const validation = validateLyricFields(normalizedPrompt, normalizedAnswer);
      if (!validation.ok) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: `Lyric validation failed: ${validation.issues.join(" ")}`,
        });
      }
      const normalizedInput = { ...input, lyricPrompt: normalizedPrompt, lyricAnswer: normalizedAnswer };
      return await db.transaction(async (tx) => {
        const [inserted] = await tx.insert(songs).values(normalizedInput as any).returning();
        await recordAdminAction({
          ctx, tx,
          action: "song.create",
          targetType: "song",
          targetId: String(inserted.id),
          payload: { after: inserted, params: normalizedInput },
        });
        return inserted;
      });
    }),

  disable: adminProcedure
    .input(z.object({ id: z.number().int(), reason: z.string().optional() }))
    .mutation(async ({ ctx, input }) => {
      const db = await getDb();
      if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "DB unavailable" });
      return await db.transaction(async (tx) => {
        const [before] = await tx.select().from(songs).where(eq(songs.id, input.id)).limit(1);
        if (!before) throw new TRPCError({ code: "NOT_FOUND" });
        const [after] = await tx
          .update(songs).set({ isActive: false, updatedAt: new Date() })
          .where(eq(songs.id, input.id)).returning();
        await recordAdminAction({
          ctx, tx,
          action: "song.disable",
          targetType: "song",
          targetId: String(input.id),
          payload: { before, after, reason: input.reason },
        });
        return after;
      });
    }),

  enable: adminProcedure
    .input(z.object({ id: z.number().int() }))
    .mutation(async ({ ctx, input }) => {
      const db = await getDb();
      if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "DB unavailable" });
      return await db.transaction(async (tx) => {
        const [before] = await tx.select().from(songs).where(eq(songs.id, input.id)).limit(1);
        if (!before) throw new TRPCError({ code: "NOT_FOUND" });
        const [after] = await tx
          .update(songs).set({ isActive: true, updatedAt: new Date() })
          .where(eq(songs.id, input.id)).returning();
        await recordAdminAction({
          ctx, tx,
          action: "song.enable",
          targetType: "song",
          targetId: String(input.id),
          payload: { before, after },
        });
        return after;
      });
    }),
});
