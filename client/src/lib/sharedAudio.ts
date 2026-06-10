/**
 * Module-level AudioContext singleton (research delta D5).
 *
 * - One context per session: browsers cap concurrent contexts and each new
 *   context starts suspended until a user gesture.
 * - unlockAudioOnGesture() must be called from a real user-gesture handler
 *   (gameplay answer clicks do this) so later programmatic sounds — e.g. the
 *   celebration chime on results-mount — are already unlocked.
 * - iOS WKWebView (Capacitor): Web Audio obeys the physical silent switch
 *   (WebKit bug 237322). Playing a short silent <audio> element on the first
 *   gesture kicks the audio session into playback mode — the standard
 *   field-tested workaround.
 * - Safari can move the context to "interrupted"/"suspended" on
 *   backgrounding; a visibilitychange listener resumes it.
 */

// 0.1s of silence, 8kHz mono WAV — tiny inline asset for the iOS session kick.
const SILENT_WAV =
  "data:audio/wav;base64,UklGRiQEAABXQVZFZm10IBAAAAABAAEAQB8AAEAfAAABAAgAZGF0YQAEAACAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgIA=";

type AnyAudioContext = typeof AudioContext;

let ctx: AudioContext | null = null;
let kicked = false;
let visibilityHooked = false;

export function getSharedAudioContext(): AudioContext | null {
  const Ctor: AnyAudioContext | undefined =
    typeof AudioContext !== "undefined"
      ? AudioContext
      : typeof (window as unknown as { webkitAudioContext?: AnyAudioContext }).webkitAudioContext !== "undefined"
        ? (window as unknown as { webkitAudioContext: AnyAudioContext }).webkitAudioContext
        : undefined;

  if (!Ctor) return null;

  if (!ctx) {
    ctx = new Ctor();
    if (!visibilityHooked && typeof document !== "undefined") {
      visibilityHooked = true;
      document.addEventListener("visibilitychange", () => {
        if (document.visibilityState === "visible" && ctx && ctx.state !== "running") {
          ctx.resume().catch(() => {});
        }
      });
    }
  }
  return ctx;
}

export function unlockAudioOnGesture(): void {
  const c = getSharedAudioContext();
  if (!c) return;
  if (c.state !== "running") c.resume().catch(() => {});
  if (!kicked && typeof window !== "undefined") {
    kicked = true;
    try {
      const el = new Audio(SILENT_WAV);
      el.volume = 0;
      void el.play().catch(() => {});
    } catch {
      /* non-fatal — audio kick is best-effort */
    }
  }
}
