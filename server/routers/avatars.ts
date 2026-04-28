import { z } from "zod";
import { and, asc, eq, isNull, sql } from "drizzle-orm";
import { TRPCError } from "@trpc/server";
import { router, protectedProcedure } from "../_core/trpc";
import { rateLimit } from "../_core/rateLimit";
import { getDb } from "../db";
import {
  avatars,
  goldenNoteBalances,
  goldenNoteTransactions,
  userAvatars,
  users,
} from "../../drizzle/schema";

// Lazy onboarding: when a user first lands on any avatars surface, ensure they
// own the default starter avatar and have an equipped pointer set. The
// migration backfilled this for users who existed at migration time, but new
// signups don't go through the migration path — this idempotent helper closes
// that gap without requiring signup-handler changes. Both the INSERT and
// UPDATE are no-ops after the first call, so calling on every list is safe.
async function ensureStarterOwnership(userId: number): Promise<void> {
  const db = await getDb();
  if (!db) return;
  const [starter] = await db
    .select({ id: avatars.id })
    .from(avatars)
    .where(eq(avatars.slug, "default-mic"))
    .limit(1);
  if (!starter) return; // catalog not seeded; fail open
  await db
    .insert(userAvatars)
    .values({
      userId,
      avatarId: starter.id,
      acquiredVia: "starter",
      spentGn: 0,
    })
    .onConflictDoNothing();
  await db
    .update(users)
    .set({ equippedAvatarId: starter.id })
    .where(and(eq(users.id, userId), isNull(users.equippedAvatarId)));
}

export const avatarsRouter = router({
  // Catalog + ownership state for the signed-in user. Renders both the
  // "Owned" and "Available to unlock" grids on /avatars from one response.
  list: protectedProcedure.query(async ({ ctx }) => {
    const db = await getDb();
    if (!db) {
      throw new TRPCError({
        code: "INTERNAL_SERVER_ERROR",
        message: "Database unavailable",
      });
    }

    await ensureStarterOwnership(ctx.user.id);

    const ownedRows = await db
      .select({ avatarId: userAvatars.avatarId })
      .from(userAvatars)
      .where(eq(userAvatars.userId, ctx.user.id));
    const ownedIds = new Set(ownedRows.map((r) => r.avatarId));

    const catalogRows = await db
      .select()
      .from(avatars)
      .where(eq(avatars.isActive, true))
      .orderBy(asc(avatars.sortOrder));

    const [me] = await db
      .select({ equippedAvatarId: users.equippedAvatarId })
      .from(users)
      .where(eq(users.id, ctx.user.id));

    return {
      catalog: catalogRows.map((a) => ({
        id: a.id,
        slug: a.slug,
        name: a.name,
        imageUrl: a.imageUrl,
        rarity: a.rarity,
        priceGn: a.priceGn,
        owned: ownedIds.has(a.id),
      })),
      equippedAvatarId: me?.equippedAvatarId ?? null,
    };
  }),

  // Spend Golden Notes to unlock an avatar. Server-owned price; race-safe
  // debit using UPDATE ... WHERE balance >= cost RETURNING — same pattern as
  // goldenNotes.spend so concurrent unlocks can't double-debit. On success,
  // auto-equips the new avatar.
  unlock: protectedProcedure
    .input(z.object({ avatarId: z.number().int().positive() }))
    .mutation(async ({ ctx, input }) => {
      rateLimit("avatars.unlock", ctx.user.id, { max: 30, windowMs: 60_000 });
      const db = await getDb();
      if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "Database unavailable" });

      // Ensure the balance row exists (mirrors getOrCreateBalance in
      // goldenNotes.ts so brand-new users hit a clean "0 balance" path
      // rather than relying on the UPDATE finding no row at all).
      await db
        .insert(goldenNoteBalances)
        .values({ userId: ctx.user.id })
        .onConflictDoNothing();

      // Look up avatar (server-owned price)
      const [avatar] = await db
        .select()
        .from(avatars)
        .where(eq(avatars.id, input.avatarId))
        .limit(1);
      if (!avatar) throw new TRPCError({ code: "NOT_FOUND", message: "Avatar not found" });
      if (!avatar.isActive) {
        throw new TRPCError({ code: "BAD_REQUEST", message: "This avatar is no longer available" });
      }

      // Reject double-purchase
      const existing = await db
        .select({ avatarId: userAvatars.avatarId })
        .from(userAvatars)
        .where(and(eq(userAvatars.userId, ctx.user.id), eq(userAvatars.avatarId, input.avatarId)))
        .limit(1);
      if (existing.length > 0) {
        throw new TRPCError({ code: "BAD_REQUEST", message: "You already own this avatar" });
      }

      const cost = avatar.priceGn;

      // Race-safe debit + ownership row + audit log + auto-equip
      return await db.transaction(async (tx) => {
        const debited = await tx
          .update(goldenNoteBalances)
          .set({
            balance: sql`${goldenNoteBalances.balance} - ${cost}`,
            lifetimeSpent: sql`${goldenNoteBalances.lifetimeSpent} + ${cost}`,
            updatedAt: new Date(),
          })
          .where(
            and(
              eq(goldenNoteBalances.userId, ctx.user.id),
              sql`${goldenNoteBalances.balance} >= ${cost}`,
            ),
          )
          .returning({ newBalance: goldenNoteBalances.balance });

        if (debited.length === 0) {
          throw new TRPCError({
            code: "BAD_REQUEST",
            message: `Not enough Golden Notes. You need ${cost}.`,
          });
        }
        const newBalance = debited[0].newBalance;

        await tx.insert(userAvatars).values({
          userId: ctx.user.id,
          avatarId: avatar.id,
          acquiredVia: "purchase",
          spentGn: cost,
        });

        await tx.insert(goldenNoteTransactions).values({
          userId: ctx.user.id,
          amount: -cost,
          kind: "spend_avatar_unlock",
          reason: `avatar:${avatar.slug}`,
          balanceAfter: newBalance,
        });

        await tx
          .update(users)
          .set({ equippedAvatarId: avatar.id, updatedAt: new Date() })
          .where(eq(users.id, ctx.user.id));

        return { avatarId: avatar.id, newBalance, equipped: true as const };
      });
    }),

  // Set the user's equipped avatar. Must be one they own.
  equip: protectedProcedure
    .input(z.object({ avatarId: z.number().int().positive() }))
    .mutation(async ({ ctx, input }) => {
      rateLimit("avatars.equip", ctx.user.id, { max: 60, windowMs: 60_000 });
      const db = await getDb();
      if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "Database unavailable" });

      const owns = await db
        .select({ avatarId: userAvatars.avatarId })
        .from(userAvatars)
        .where(and(eq(userAvatars.userId, ctx.user.id), eq(userAvatars.avatarId, input.avatarId)))
        .limit(1);
      if (owns.length === 0) {
        throw new TRPCError({ code: "FORBIDDEN", message: "You don't own this avatar." });
      }

      await db
        .update(users)
        .set({ equippedAvatarId: input.avatarId, updatedAt: new Date() })
        .where(eq(users.id, ctx.user.id));

      return { equippedAvatarId: input.avatarId };
    }),
});
