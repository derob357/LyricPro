/**
 * iOS Capacitor AVAudioSession pre-warm.
 *
 * WKWebView starts the AVAudioSession in a category that causes the first
 * second of LiveKit audio to drop. We pre-activate the session via a native
 * plugin (LiveKitAudioPlugin) BEFORE Room.connect(). On non-iOS platforms
 * (web, Android), this is a no-op.
 *
 * The native plugin is registered as `LiveKitAudio` and exposes a single
 * `prewarm()` method.
 */
import { Capacitor, registerPlugin } from "@capacitor/core";

interface LiveKitAudioPlugin {
  prewarm(): Promise<void>;
}

const LiveKitAudio = registerPlugin<LiveKitAudioPlugin>("LiveKitAudio");

export async function prewarmIosAudio(): Promise<void> {
  if (Capacitor.getPlatform() !== "ios") return;
  try {
    await LiveKitAudio.prewarm();
  } catch (err) {
    // Non-fatal — log and continue; LiveKit will still work, just with the
    // first-second audio glitch documented in our research.
    console.warn("[livekit] iOS audio pre-warm failed:", err);
  }
}
