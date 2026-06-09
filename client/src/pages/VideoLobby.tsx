import { useEffect, useState } from "react";
import { useParams, useLocation } from "wouter";
import { trpc } from "@/lib/trpc";
import { useLiveKitRoom } from "@/lib/livekit/useLiveKitRoom";
import { VideoGrid } from "@/components/livekit/VideoGrid";
import { PermissionGate } from "@/components/livekit/PermissionGate";
import { useAuth } from "@/_core/hooks/useAuth";

/**
 * /lobby/live/:inviteCode
 *
 * - On mount (after permissions granted), calls liveRoom.joinLiveRoom to get
 *   a LiveKit token + the room's canonical roomCode.
 * - PermissionGate handles mic+camera prompts before any LiveKit work.
 * - Connects via useLiveKitRoom hook; renders VideoGrid + share-invite UI.
 * - HOST: sees per-player Ready badges, "I'm Ready" toggle, and a Start button
 *   that calls match.startMatch then navigates to /match/:roomCode.
 * - NON-HOST: same badges + toggle; auto-navigates to /match/:roomCode when
 *   the room status flips to "active" (polled via getMatchState).
 */
export default function VideoLobby() {
  const { inviteCode } = useParams<{ inviteCode: string }>();
  const [, navigate] = useLocation();
  const { user } = useAuth();
  const [permissionsGranted, setPermissionsGranted] = useState(false);
  const [creds, setCreds] = useState<{
    token: string;
    livekitUrl: string;
    roomId: number;
    roomCode: string;
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
          roomCode: res.roomCode,
        }),
      )
      .catch((err) => {
        console.error("[lobby] join failed:", err);
        navigate("/");
      });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [inviteCode, permissionsGranted]);

  const { room, participants, status, error } = useLiveKitRoom({
    livekitUrl: creds?.livekitUrl ?? "",
    token: creds?.token ?? "",
    autoConnect: !!creds,
  });

  // Publish mic + camera once connected. Tracks were already requested by
  // PermissionGate (so the browser permission prompt is past); this just tells
  // LiveKit to acquire and publish them to the room.
  useEffect(() => {
    if (room && status === "connected") {
      void room.localParticipant.setMicrophoneEnabled(true).catch((err) => {
        console.warn("[lobby] failed to enable mic:", err);
      });
      void room.localParticipant.setCameraEnabled(true).catch((err) => {
        console.warn("[lobby] failed to enable camera:", err);
      });
    }
  }, [room, status]);

  // ── Match state polling (player list + ready status + room status) ──────────
  // Poll once we have the roomCode. refetchInterval keeps non-host players
  // aware of the game starting so they can auto-navigate.
  const matchStateQuery = trpc.match.getMatchState.useQuery(
    { roomCode: creds?.roomCode ?? "" },
    {
      enabled: !!creds?.roomCode,
      refetchInterval: 2000,
    },
  );

  const matchState = matchStateQuery.data;
  const players = matchState?.players ?? [];
  const roomStatus = matchState?.room?.status ?? "waiting";
  const hostUserId = matchState?.room?.hostUserId ?? null;

  const localUserId = user?.id ?? null;
  const isHost = localUserId !== null && hostUserId === localUserId;
  const localPlayer = players.find((p) => p.userId === localUserId);
  const localIsReady = localPlayer?.isReady ?? false;

  const allReady =
    players.length >= 2 && players.every((p) => p.isReady);

  // ── setReady mutation ────────────────────────────────────────────────────────
  const setReadyMutation = trpc.game.setReady.useMutation();

  const handleToggleReady = () => {
    if (!creds?.roomCode) return;
    setReadyMutation.mutateAsync({ roomCode: creds.roomCode });
  };

  // ── startMatch mutation ──────────────────────────────────────────────────────
  const startMatchMutation = trpc.match.startMatch.useMutation();

  const handleStart = async () => {
    if (!creds?.roomCode) return;
    await startMatchMutation.mutateAsync({ roomCode: creds.roomCode });
    navigate(`/match/${creds.roomCode}`);
  };

  // ── Non-host auto-navigate when room goes active ─────────────────────────────
  useEffect(() => {
    if (!isHost && roomStatus === "active" && creds?.roomCode) {
      navigate(`/match/${creds.roomCode}`);
    }
  }, [isHost, roomStatus, creds?.roomCode, navigate]);

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

      {/* Player list with Ready badges */}
      {players.length > 0 && (
        <section className="rounded-lg border border-slate-700 p-4 space-y-2">
          <h3 className="font-semibold mb-2">Players</h3>
          <ul className="space-y-1">
            {players.map((p) => (
              <li key={p.id} className="flex items-center gap-2 text-sm">
                <span className="text-slate-200">
                  {p.guestName ?? (p.userId === hostUserId ? "Host" : `Player ${p.id}`)}
                  {p.userId === hostUserId && (
                    <span className="ml-1 text-xs text-amber-400">(host)</span>
                  )}
                </span>
                {p.isReady ? (
                  <span className="rounded px-1.5 py-0.5 bg-emerald-800 text-emerald-300 text-xs font-medium">
                    Ready
                  </span>
                ) : (
                  <span className="rounded px-1.5 py-0.5 bg-slate-700 text-slate-400 text-xs">
                    Not ready
                  </span>
                )}
              </li>
            ))}
          </ul>
        </section>
      )}

      <section className="rounded-lg border border-slate-700 p-4">
        <h3 className="font-semibold mb-2">Invite players</h3>
        <code className="block bg-slate-900 rounded px-2 py-1 text-sm break-all">
          {shareUrl}
        </code>
        <button
          type="button"
          onClick={() => navigator.clipboard.writeText(shareUrl)}
          className="mt-2 text-sm text-emerald-400 hover:underline"
        >
          Copy link
        </button>
      </section>

      <div className="flex items-center gap-3">
        {/* I'm Ready toggle — shown to all players (including host) */}
        {!localIsReady && (
          <button
            type="button"
            onClick={handleToggleReady}
            disabled={setReadyMutation.isPending}
            className="rounded-md bg-emerald-700 hover:bg-emerald-600 px-4 py-2 text-white font-medium disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {setReadyMutation.isPending ? "Marking ready…" : "I'm Ready"}
          </button>
        )}
        {localIsReady && !isHost && (
          <span className="text-emerald-400 text-sm font-medium">
            You are ready — waiting for host to start…
          </span>
        )}

        {/* Start button — host only */}
        {isHost && (
          <button
            type="button"
            data-testid="lobby-start"
            onClick={handleStart}
            disabled={!allReady || startMatchMutation.isPending}
            title={
              !allReady
                ? "Waiting for all players to be ready"
                : "Start the match"
            }
            className="rounded-md bg-indigo-600 hover:bg-indigo-500 px-4 py-2 text-white font-medium disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {startMatchMutation.isPending ? "Starting…" : "Start Game"}
          </button>
        )}
      </div>
    </div>
  );
}
