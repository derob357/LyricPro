// Looks up whether a user has an active ban or mute. Returns the most
// recently created active row, or null. Called by every chat tRPC procedure
// before the actual operation. Defense in depth — same check is also enforced
// by RLS at channel join (see migration 0013).
import { sql, and, eq, or, isNull, gt } from "drizzle-orm";
import { getDb } from "../db";
import { chatBans, type ChatBan } from "../../drizzle/schema";

export type BanCheckScope =
  | { kind: "global" }
  | { kind: "room"; roomId: number };

/**
 * Returns the most recent active ban OR mute for the user, considering the
 * requested scope. A global ban matches any scope query. A per-room ban only
 * matches when the scope is `room` and the roomId matches.
 *
 * "Active" = revoked_at IS NULL AND (expires_at IS NULL OR expires_at > NOW()).
 */
export async function getActiveBan(
  userId: number,
  scope: BanCheckScope,
): Promise<ChatBan | null> {
  const db = await getDb();
  if (!db) throw new Error("DB unavailable");

  const scopeCondition =
    scope.kind === "global"
      ? eq(chatBans.scope, "global")
      : or(
          eq(chatBans.scope, "global"),
          and(eq(chatBans.scope, "room"), eq(chatBans.roomId, scope.roomId)),
        );

  const rows = await db
    .select()
    .from(chatBans)
    .where(
      and(
        eq(chatBans.userId, userId),
        isNull(chatBans.revokedAt),
        or(isNull(chatBans.expiresAt), gt(chatBans.expiresAt, sql`NOW()`)),
        scopeCondition,
      ),
    )
    .orderBy(sql`${chatBans.createdAt} DESC`)
    .limit(1);

  return rows[0] ?? null;
}
