import { z } from "zod";
import { eq, asc, and, lte, gte, sql } from "drizzle-orm";
import { adminProcedure, publicProcedure, router } from "../_core/trpc";
import { getDb } from "../db";
import { banners, bannerImpressions, playerProfiles } from "../../drizzle/schema";
import { TRPCError } from "@trpc/server";
import type { PlayerProfileData } from "../_core/playerProfile";

function matchesTarget(profile: PlayerProfileData | null, target: Record<string, unknown>): boolean {
  if (!profile) return Object.keys(target).length === 0;
  if (target.minGames && profile.totalGames < (target.minGames as number)) return false;
  if (target.maxGames && profile.totalGames > (target.maxGames as number)) return false;
  if (target.minDaysInactive && profile.daysSinceLastGame < (target.minDaysInactive as number)) return false;
  if (target.maxDaysInactive && profile.daysSinceLastGame > (target.maxDaysInactive as number)) return false;
  if (target.preferredDifficulty && profile.preferredDifficulty !== target.preferredDifficulty) return false;
  if (target.genres && Array.isArray(target.genres)) {
    const tg = target.genres as string[];
    if (tg.length > 0 && !tg.some(g => profile.strongestGenres.includes(g) || profile.weakestGenres.includes(g))) return false;
  }
  return true;
}

export const bannersRouter = router({
  // Public: resolve the best banner for the current user
  getActive: publicProcedure.query(async ({ ctx }) => {
    const db = await getDb();
    if (!db) return null;

    const now = new Date();
    const rows = await db
      .select()
      .from(banners)
      .where(eq(banners.isActive, true))
      .orderBy(asc(banners.priority));

    // Filter by date range
    const inRange = rows.filter(b => {
      if (b.startsAt && new Date(b.startsAt) > now) return false;
      if (b.endsAt && new Date(b.endsAt) < now) return false;
      return true;
    });

    const isAuthed = !!ctx.user;
    let profile: PlayerProfileData | null = null;
    if (ctx.user) {
      const [row] = await db
        .select({ profile: playerProfiles.profile })
        .from(playerProfiles)
        .where(eq(playerProfiles.userId, ctx.user.id))
        .limit(1);
      if (row) profile = row.profile as unknown as PlayerProfileData;
    }

    for (const b of inRange) {
      if (b.audience === "visitor" && isAuthed) continue;
      if (b.audience === "authenticated" && !isAuthed) continue;
      if (b.audience === "targeted") {
        const target = (b.targetJson ?? {}) as Record<string, unknown>;
        if (!matchesTarget(profile, target)) continue;
      }
      return b;
    }

    return null;
  }),

  // Track impression (fire-and-forget from client)
  trackImpression: publicProcedure
    .input(z.object({ bannerId: z.number().int() }))
    .mutation(async ({ input, ctx }) => {
      const db = await getDb();
      if (!db) return { ok: true };
      await db.insert(bannerImpressions).values({
        bannerId: input.bannerId,
        userId: ctx.user?.id ?? null,
      });
      return { ok: true };
    }),

  // Track click
  trackClick: publicProcedure
    .input(z.object({ bannerId: z.number().int() }))
    .mutation(async ({ input, ctx }) => {
      const db = await getDb();
      if (!db) return { ok: true };
      await db.insert(bannerImpressions).values({
        bannerId: input.bannerId,
        userId: ctx.user?.id ?? null,
        clickedAt: new Date(),
      });
      return { ok: true };
    }),

  // ── Admin CRUD ──────────────────────────────────────────────────────────
  list: adminProcedure.query(async () => {
    const db = await getDb();
    if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR" });
    const rows = await db.select().from(banners).orderBy(asc(banners.priority));

    // Compute impressions/clicks for CTR
    const stats = await db
      .select({
        bannerId: bannerImpressions.bannerId,
        impressions: sql<number>`COUNT(*)::int`,
        clicks: sql<number>`COUNT(${bannerImpressions.clickedAt})::int`,
      })
      .from(bannerImpressions)
      .groupBy(bannerImpressions.bannerId);
    const statsMap = new Map(stats.map(s => [s.bannerId, s]));

    return rows.map(b => ({
      ...b,
      impressions: statsMap.get(b.id)?.impressions ?? 0,
      clicks: statsMap.get(b.id)?.clicks ?? 0,
      ctr: statsMap.get(b.id)
        ? ((statsMap.get(b.id)!.clicks / Math.max(statsMap.get(b.id)!.impressions, 1)) * 100).toFixed(1)
        : "0.0",
    }));
  }),

  create: adminProcedure
    .input(z.object({
      title: z.string().min(1).max(256),
      subtitle: z.string().nullable().default(null),
      ctaText: z.string().min(1).max(64).default("Learn More"),
      ctaAction: z.string().min(1).max(512),
      partnerName: z.string().nullable().default(null),
      badgeText: z.string().nullable().default("Featured"),
      badgeColor: z.string().max(7).default("#EF4444"),
      imageEmoji: z.string().nullable().default(null),
      audience: z.string().max(32).default("all"),
      targetJson: z.record(z.string(), z.unknown()).default({}),
      priority: z.number().int().default(100),
      startsAt: z.string().nullable().default(null),
      endsAt: z.string().nullable().default(null),
    }))
    .mutation(async ({ input }) => {
      const db = await getDb();
      if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR" });
      const [created] = await db.insert(banners).values({
        ...input,
        startsAt: input.startsAt ? new Date(input.startsAt) : null,
        endsAt: input.endsAt ? new Date(input.endsAt) : null,
      }).returning();
      return created;
    }),

  update: adminProcedure
    .input(z.object({
      id: z.number().int(),
      title: z.string().min(1).max(256).optional(),
      subtitle: z.string().nullable().optional(),
      ctaText: z.string().min(1).max(64).optional(),
      ctaAction: z.string().min(1).max(512).optional(),
      partnerName: z.string().nullable().optional(),
      badgeText: z.string().nullable().optional(),
      badgeColor: z.string().max(7).optional(),
      imageEmoji: z.string().nullable().optional(),
      audience: z.string().max(32).optional(),
      targetJson: z.record(z.string(), z.unknown()).optional(),
      priority: z.number().int().optional(),
      isActive: z.boolean().optional(),
      startsAt: z.string().nullable().optional(),
      endsAt: z.string().nullable().optional(),
    }))
    .mutation(async ({ input }) => {
      const db = await getDb();
      if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR" });
      const { id, startsAt, endsAt, ...rest } = input;
      const set: Record<string, unknown> = { ...rest, updatedAt: new Date() };
      if (startsAt !== undefined) set.startsAt = startsAt ? new Date(startsAt) : null;
      if (endsAt !== undefined) set.endsAt = endsAt ? new Date(endsAt) : null;
      const [updated] = await db.update(banners).set(set).where(eq(banners.id, id)).returning();
      if (!updated) throw new TRPCError({ code: "NOT_FOUND" });
      return updated;
    }),

  delete: adminProcedure
    .input(z.object({ id: z.number().int() }))
    .mutation(async ({ input }) => {
      const db = await getDb();
      if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR" });
      await db.delete(banners).where(eq(banners.id, input.id));
      return { ok: true };
    }),
});
