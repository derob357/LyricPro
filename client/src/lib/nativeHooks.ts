// Thin wrappers around Capacitor native plugins. All no-op on web.
// Keeps the rest of the codebase platform-agnostic — components just
// call `haptic.success()` without guarding on IS_NATIVE themselves.

import { IS_NATIVE } from "./platform";
import { Haptics, ImpactStyle, NotificationType } from "@capacitor/haptics";
import { StatusBar, Style } from "@capacitor/status-bar";
import { SplashScreen } from "@capacitor/splash-screen";

// ── Haptics ─────────────────────────────────────────────────────────────────
export const haptic = {
  /** Light tap. Use for UI button presses. */
  light: async () => {
    if (!IS_NATIVE) return;
    try { await Haptics.impact({ style: ImpactStyle.Light }); } catch {}
  },
  /** Medium impact. Answer submitted. */
  medium: async () => {
    if (!IS_NATIVE) return;
    try { await Haptics.impact({ style: ImpactStyle.Medium }); } catch {}
  },
  /** Success pattern. Correct answer. */
  success: async () => {
    if (!IS_NATIVE) return;
    try { await Haptics.notification({ type: NotificationType.Success }); } catch {}
  },
  /** Warning pattern. Incorrect answer / near-miss. */
  warning: async () => {
    if (!IS_NATIVE) return;
    try { await Haptics.notification({ type: NotificationType.Warning }); } catch {}
  },
  /** Error pattern. Out of Golden Notes, timer expired without answer, etc. */
  error: async () => {
    if (!IS_NATIVE) return;
    try { await Haptics.notification({ type: NotificationType.Error }); } catch {}
  },
};

// ── Status bar ──────────────────────────────────────────────────────────────
export async function configureStatusBar() {
  if (!IS_NATIVE) return;
  try {
    await StatusBar.setStyle({ style: Style.Dark });
    await StatusBar.setBackgroundColor({ color: "#0a0015" });
  } catch {
    // Status bar not available on this platform variant — ignore.
  }
}

// ── Splash screen ──────────────────────────────────────────────────────────
// capacitor.config.ts sets launchShowDuration so the splash auto-hides.
// This is a manual override for cases where we want to hide it earlier
// (e.g. after first successful tRPC call).
export async function hideSplash() {
  if (!IS_NATIVE) return;
  try { await SplashScreen.hide(); } catch {}
}
