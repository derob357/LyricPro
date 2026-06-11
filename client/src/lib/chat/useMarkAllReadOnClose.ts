// Hook that calls chat.markAllRead and then invalidates the unreadCounts
// query whenever the caller signals that the chat surface is closing.
//
// Usage:
//   const markAllRead = useMarkAllReadOnClose();
//   // When panel closes:
//   markAllRead();          // fire-and-forget; safe to call multiple times
//
// Contract:
// - The mutation is awaited before the invalidation to prevent the badge
//   from flashing back (race: invalidate fires before DB write completes).
// - The overall call is fire-and-forget from the caller's perspective so
//   the close animation is not blocked.
import { useCallback } from "react";
import { trpc } from "@/lib/trpc";

export function useMarkAllReadOnClose(): () => void {
  const utils = trpc.useUtils();
  const mutation = trpc.chat.markAllRead.useMutation();

  return useCallback(() => {
    // Fire-and-forget: don't block close animation.
    void (async () => {
      try {
        await mutation.mutateAsync();
        await utils.chat.unreadCounts.invalidate();
      } catch {
        // Non-fatal — badge may linger until next natural refetch.
      }
    })();
    // mutation and utils are stable references; listing them would cause
    // the callback identity to change on every render. The refs are stable
    // by design (trpc hooks return stable mutation objects).
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
}
