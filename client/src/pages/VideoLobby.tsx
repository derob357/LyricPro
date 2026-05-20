import { useEffect, useState } from "react";
import { useParams, useLocation } from "wouter";
import { trpc } from "@/lib/trpc";
import { useLiveKitRoom } from "@/lib/livekit/useLiveKitRoom";
import { VideoGrid } from "@/components/livekit/VideoGrid";
import { PermissionGate } from "@/components/livekit/PermissionGate";

/**
 * /lobby/live/:inviteCode
 *
 * - On mount (after permissions granted), calls liveRoom.joinLiveRoom to get
 *   a LiveKit token.
 * - PermissionGate handles mic+camera prompts before any LiveKit work.
 * - Connects via useLiveKitRoom hook; renders VideoGrid + share-invite UI.
 * - Phase 2 will wire up the Start Game button to real gameplay.
 */
export default function VideoLobby() {
  const { inviteCode } = useParams<{ inviteCode: string }>();
  const [, navigate] = useLocation();
  const [permissionsGranted, setPermissionsGranted] = useState(false);
  const [creds, setCreds] = useState<{
    token: string;
    livekitUrl: string;
    roomId: number;
  } | null>(null);

  const joinMutation = trpc.liveRoom.joinLiveRoom.useMutation();

  useEffect(() => {
    if (!inviteCode || !permissionsGranted || creds) return;
    joinMutation
      .mutateAsync({ inviteCode })
      .then((res) =>
        setCreds({
          token: res.token,
          livekitUrl: res.livekitUrl,
          roomId: res.roomId,
        }),
      )
      .catch((err) => {
        console.error("[lobby] join failed:", err);
        navigate("/");
      });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [inviteCode, permissionsGranted]);

  const { participants, status, error } = useLiveKitRoom({
    livekitUrl: creds?.livekitUrl ?? "",
    token: creds?.token ?? "",
    autoConnect: !!creds,
  });

  if (!permissionsGranted) {
    return (
      <div className="max-w-md mx-auto p-6">
        <PermissionGate onGranted={() => setPermissionsGranted(true)} />
      </div>
    );
  }

  if (!creds) {
    return <div className="p-6 text-slate-400">Joining room…</div>;
  }

  const shareUrl = `${window.location.origin}/lobby/live/${inviteCode}`;

  return (
    <div className="max-w-5xl mx-auto p-6 space-y-6">
      <header className="flex items-center justify-between">
        <h1 className="text-2xl font-bold">Multiplayer Lobby</h1>
        <div className="text-sm text-slate-400">
          Status: <span className="font-mono">{status}</span>
        </div>
      </header>

      {error && (
        <div className="rounded-md bg-red-900/30 border border-red-700 p-3 text-red-200">
          Connection error: {error.message}
        </div>
      )}

      <VideoGrid participants={participants} />

      <section className="rounded-lg border border-slate-700 p-4">
        <h3 className="font-semibold mb-2">Invite players</h3>
        <code className="block bg-slate-900 rounded px-2 py-1 text-sm break-all">
          {shareUrl}
        </code>
        <button
          onClick={() => navigator.clipboard.writeText(shareUrl)}
          className="mt-2 text-sm text-emerald-400 hover:underline"
        >
          Copy link
        </button>
      </section>

      <button
        disabled
        title="Phase 2 — turn-based gameplay not yet implemented"
        className="rounded-md bg-slate-700 px-4 py-2 text-slate-400 cursor-not-allowed"
      >
        Start Game (Phase 2)
      </button>
    </div>
  );
}
