// Admin "freeze the world" pause state.
//
// Persisted to localStorage so a paused session survives reloads (handy when
// pausing for a screenshot, then reloading to retest from a clean slate).
//
// State is mirrored onto document.documentElement.dataset.paused so a single
// CSS rule (in index.css) can pause every animation/transition globally
// without each component opting in.
//
// Cross-component sync uses a custom DOM event so the pause button, the
// gameplay timer, and any other consumers all stay in lockstep without
// needing a top-level React Context.

import { useEffect, useState } from "react";

const STORAGE_KEY = "lyricpro_admin_paused";
const EVENT_NAME = "lyricpro:pausechange";

function readPaused(): boolean {
  if (typeof window === "undefined") return false;
  return localStorage.getItem(STORAGE_KEY) === "true";
}

function applyPausedToDom(paused: boolean) {
  if (typeof document === "undefined") return;
  if (paused) {
    document.documentElement.dataset.paused = "true";
  } else {
    delete document.documentElement.dataset.paused;
  }
}

export function setPaused(paused: boolean) {
  if (typeof window === "undefined") return;
  localStorage.setItem(STORAGE_KEY, String(paused));
  applyPausedToDom(paused);
  window.dispatchEvent(new CustomEvent(EVENT_NAME, { detail: paused }));
}

export function usePaused(): boolean {
  const [paused, setPausedState] = useState<boolean>(readPaused);

  useEffect(() => {
    const handler = (e: Event) => {
      setPausedState((e as CustomEvent<boolean>).detail);
    };
    window.addEventListener(EVENT_NAME, handler);
    // Re-sync on mount in case the value changed before this component
    // subscribed (e.g. another tab updated localStorage).
    setPausedState(readPaused());
    return () => window.removeEventListener(EVENT_NAME, handler);
  }, []);

  return paused;
}

// Apply on module load so the first paint already reflects the persisted
// pause state (avoids a brief flash of un-paused animation on reload).
if (typeof window !== "undefined") {
  applyPausedToDom(readPaused());
}
