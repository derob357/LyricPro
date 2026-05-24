// Chat tRPC router. Phase 1 lands the skeleton + the shared ban-check
// middleware so the ban-enforcement contract is testable. Endpoints
// (fetch / post / markRead / unreadCounts) arrive in Phase 2 along with
// the Global chat UI.
import { TRPCError } from "@trpc/server";
import { router, protectedProcedure } from "../_core/trpc";
import { getActiveBan } from "../_core/chatBans";

/**
 * Adds "user is not globally banned from chat" as a precondition to any
 * procedure that composes it. Per-room ban enforcement is layered on top
 * inside individual procedures (since the room id is procedure-specific).
 */
export const requireNotGloballyChatBanned = protectedProcedure.use(async (opts) => {
  const ban = await getActiveBan(opts.ctx.user.id, { kind: "global" });
  if (ban && ban.action === "ban") {
    throw new TRPCError({
      code: "FORBIDDEN",
      message: "You are banned from chat.",
    });
  }
  return opts.next();
});

export const chatRouter = router({
  // Phase 2: fetchInitial, fetchOlder, fetchSince, postMessage, markRead, unreadCounts
});
