import { useSyncExternalStore } from "react";

// Tiny module-scoped store for the "is the desktop chat slide-over open?"
// boolean. Lives outside React so the PersistentHeader (mounted at App level)
// and the ChatPanel (also at App level) can sync without prop drilling or a
// Context provider. Mobile uses the /chat route instead of this panel, so this
// store is effectively desktop-only.

let open = false;
const listeners = new Set<() => void>();

export function isChatPanelOpen(): boolean {
  return open;
}

export function setChatPanelOpen(next: boolean): void {
  if (open === next) return;
  open = next;
  // Avoid `for...of` over a Set so the file compiles cleanly under the
  // project's lower TS `target` (no --downlevelIteration needed).
  listeners.forEach((l) => l());
}

export function useChatPanelOpen(): [boolean, (next: boolean) => void] {
  const value = useSyncExternalStore(
    (cb) => {
      listeners.add(cb);
      return () => listeners.delete(cb);
    },
    isChatPanelOpen,
    isChatPanelOpen,
  );
  return [value, setChatPanelOpen];
}
