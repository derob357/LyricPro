import { useState } from "react";
import { prewarmIosAudio } from "../../lib/livekit/iosAudioShim";

interface PermissionGateProps {
  onGranted: () => void;
}

/**
 * Pre-flight UI requesting mic + camera access. On user click:
 *   1. Pre-warm iOS AVAudioSession (no-op on web/Android).
 *   2. Call navigator.mediaDevices.getUserMedia to surface the permission
 *      prompt explicitly (rather than letting LiveKit do it mid-connect).
 *   3. Release the test tracks immediately.
 *   4. Notify parent via onGranted().
 *
 * If permission is denied, an error message is shown with a retry button.
 */
export function PermissionGate({ onGranted }: PermissionGateProps) {
  const [error, setError] = useState<string | null>(null);
  const [requesting, setRequesting] = useState(false);

  const requestAccess = async () => {
    setRequesting(true);
    setError(null);
    try {
      await prewarmIosAudio();
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: true,
        video: true,
      });
      // Release immediately — LiveKit will re-acquire on connect.
      stream.getTracks().forEach((t) => t.stop());
      onGranted();
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : "Permission denied";
      setError(
        `Camera and microphone access is required to join. (${message})`,
      );
      setRequesting(false);
    }
  };

  return (
    <div className="rounded-lg border border-slate-700 p-6 text-center">
      <h2 className="text-lg font-semibold mb-2">
        Allow camera and microphone
      </h2>
      <p className="text-sm text-slate-400 mb-4">
        You'll see your fellow players and they'll see you. You can mute or
        hide yourself any time.
      </p>
      <button
        onClick={requestAccess}
        disabled={requesting}
        className="rounded-md bg-emerald-500 hover:bg-emerald-400 disabled:opacity-50 px-4 py-2 text-white font-medium"
      >
        {requesting ? "Requesting…" : "Allow access"}
      </button>
      {error && <p className="mt-3 text-sm text-red-400">{error}</p>}
    </div>
  );
}
