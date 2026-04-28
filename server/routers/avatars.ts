import { and, asc, eq, isNull } from "drizzle-orm";
import { TRPCError } from "@trpc/server";
import { router, protectedProcedure } from "../_core/trpc";
import { getDb } from "../db";
import {
  avatars,
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
});
