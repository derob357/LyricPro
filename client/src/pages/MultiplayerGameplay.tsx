import { useCallback, useEffect, useRef, useState } from "react";
import { useParams, useLocation } from "wouter";
import { trpc } from "@/lib/trpc";
import { useGameChannel } from "@/lib/game/useGameChannel";
import { useLiveKitRoom } from "@/lib/livekit/useLiveKitRoom";
import { VideoGrid } from "@/components/livekit/VideoGrid";
import { useAuth } from "@/_core/hooks/useAuth";
import { formatMMSS } from "@/lib/formatTime";
import { Button } from "@/components/ui/button";
import { Clock, Trophy } from "lucide-react";

/**
 * /match/:roomCode — the synchronized multiplayer MATCH SCREEN.
 *
 * Authoritative state lives on the server (getMatchState). This screen polls it
 * (refetchInterval) AND refetches on every realtime broadcast (useGameChannel),
 * then renders by `room.roundPhase`:
 *
 *  - in_question:  prompt + selectable Title/Artist/Year/(Lyric on High) option
 *                  groups + countdown to roundEndsAt. Local player selects +
 *                  Submits → submitAnswer (server scores; the payload carries NO
 *                  correct flag — anti-cheat). After submit, inputs lock. When
 *                  the local countdown reaches 0 OR everyone has answered, the
 *                  client calls revealRound (idempotent server-side).
 *  - intermission: round standings + "X is in the lead! Next round in N".
 *                  When the countdown reaches 0 → advanceRound (idempotent).
 *  - complete OR status === "finished": navigate to /results/final/:roomCode.
 *
 * Reveal / advance / navigate triggers are guarded by a ref tracking the last
 * handled `round:phase` so each fires once per phase (no mutation spam even
 * though multiple polls/broadcasts re-render us).
 *
 * Video: on mount (once roomId is known) refreshToken → connect via the same
 * useLiveKitRoom pattern VideoLobby uses, render VideoGrid. On unmount,
 * leaveLiveRoom so the player's isActive flips false (graceful leave).
 */
export default function MultiplayerGameplay() {
  const { roomCode } = useParams<{ roomCode: string }>();
  const [, navigate] = useLocation();
  const { user } = useAuth();

  const state = trpc.match.getMatchState.useQuery(
    { roomCode: roomCode ?? "" },
    { enabled: !!roomCode, refetchInterval: 5000 },
  );

  const room = state.data?.room ?? null;
  const players = state.data?.players ?? [];
  const standings = state.data?.standings ?? [];
  const roomId = room?.id ?? null;

  // Any realtime broadcast → refetch the authoritative state.
  const refetch = useCallback(() => {
    void state.refetch();
  }, [state]);
  useGameChannel(roomId, refetch);

  // ── LiveKit: reconnect into the embedded room (token carries the room) ──────
  const refreshTokenMutation = trpc.liveRoom.refreshToken.useMutation();
  const leaveLiveRoomMutation = trpc.liveRoom.leaveLiveRoom.useMutation();
  const [creds, setCreds] = useState<{ token: string; livekitUrl: string } | null>(null);
  const joinAttemptedFor = useRef<number | null>(null);

  useEffect(() => {
    if (roomId == null || joinAttemptedFor.current === roomId) return;
    joinAttemptedFor.current = roomId; // guard double-join
    refreshTokenMutation
      .mutateAsync({ roomId })
      .then((res) => setCreds({ token: res.token, livekitUrl: res.livekitUrl }))
      .catch((err) => console.error("[match] refreshToken failed:", err));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [roomId]);

  // Graceful leave on unmount → server flips this player's isActive false.
  // Keep roomId in a ref so the cleanup (which runs once) sees the latest id.
  const roomIdRef = useRef<number | null>(null);
  roomIdRef.current = roomId;
  useEffect(() => {
    return () => {
      const id = roomIdRef.current;
      if (id != null) void leaveLiveRoomMutation.mutateAsync({ roomId: id });
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const { participants } = useLiveKitRoom({
    livekitUrl: creds?.livekitUrl ?? "",
    token: creds?.token ?? "",
    autoConnect: !!creds,
  });

  // ── Answer selection (anti-cheat: server scores, payload has no answer) ─────
  const submitAnswerMutation = trpc.match.submitAnswer.useMutation();
  const revealRoundMutation = trpc.match.revealRound.useMutation();
  const advanceRoundMutation = trpc.match.advanceRound.useMutation();

  const [titleAnswer, setTitleAnswer] = useState<string | null>(null);
  const [artistAnswer, setArtistAnswer] = useState<string | null>(null);
  const [yearAnswer, setYearAnswer] = useState<number | null>(null);
  const [lyricAnswer, setLyricAnswer] = useState<string | null>(null);
  const [hasSubmitted, setHasSubmitted] = useState(false);
  const roundStartRef = useRef<number>(Date.now());

  const currentRound = room?.currentRound ?? null;

  // Reset local selections whenever a new round begins.
  useEffect(() => {
    setTitleAnswer(null);
    setArtistAnswer(null);
    setYearAnswer(null);
    setLyricAnswer(null);
    setHasSubmitted(false);
    roundStartRef.current = Date.now();
  }, [currentRound]);

  const handleSubmit = useCallback(() => {
    if (!roomCode || hasSubmitted) return;
    setHasSubmitted(true);
    const responseTimeSeconds = (Date.now() - roundStartRef.current) / 1000;
    void submitAnswerMutation
      .mutateAsync({
        roomCode,
        titleAnswer: titleAnswer ?? undefined,
        artistAnswer: artistAnswer ?? undefined,
        yearAnswer: yearAnswer ?? undefined,
        lyricAnswer: lyricAnswer ?? undefined,
        responseTimeSeconds,
      })
      .catch((err) => {
        console.error("[match] submitAnswer failed:", err);
        setHasSubmitted(false); // allow retry
      });
  }, [roomCode, hasSubmitted, titleAnswer, artistAnswer, yearAnswer, lyricAnswer, submitAnswerMutation]);

  // ── Local countdown to room.roundEndsAt ─────────────────────────────────────
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 250);
    return () => clearInterval(t);
  }, []);
  const endsAtMs = room?.roundEndsAt ? new Date(room.roundEndsAt).getTime() : null;
  const secondsLeft = endsAtMs != null ? Math.max(0, Math.ceil((endsAtMs - now) / 1000)) : 0;

  // ── Phase-driven orchestration: reveal / advance / navigate ─────────────────
  // Guard so each side-effect fires once per (round, phase). Keyed string.
  const handledRef = useRef<string | null>(null);
  const phase = room?.roundPhase ?? null;
  const status = room?.status ?? null;

  // Did every active player answer? Driven by server-authoritative answeredPlayerIds
  // (populated by getMatchState, refetched on every player_answered broadcast).
  const answeredPlayerIds: number[] = state.data?.answeredPlayerIds ?? [];
  const activePlayers = players.filter((p) => p.isActive);
  const allAnswered =
    activePlayers.length > 0 &&
    activePlayers.every((p) => answeredPlayerIds.includes(p.id));

  useEffect(() => {
    if (!roomCode) return;

    // Terminal: match finished or round flow complete → final results.
    if (status === "finished" || phase === "complete") {
      const key = "navigate:final";
      if (handledRef.current !== key) {
        handledRef.current = key;
        navigate(`/results/final/${roomCode}`);
      }
      return;
    }

    if (phase === "in_question") {
      // Reveal when the local countdown expires OR all active players have
      // answered (server-authoritative via answeredPlayerIds). Idempotent
      // server-side, so multiple clients firing is safe.
      if ((secondsLeft <= 0 || allAnswered) && endsAtMs != null) {
        const key = `reveal:${currentRound}`;
        if (handledRef.current !== key) {
          handledRef.current = key;
          void revealRoundMutation.mutateAsync({ roomCode }).catch((err) => {
            console.error("[match] revealRound failed:", err);
            handledRef.current = null; // allow retry on next tick
          });
        }
      }
      return;
    }

    if (phase === "intermission") {
      if (secondsLeft <= 0 && endsAtMs != null) {
        const key = `advance:${currentRound}`;
        if (handledRef.current !== key) {
          handledRef.current = key;
          void advanceRoundMutation.mutateAsync({ roomCode }).catch((err) => {
            console.error("[match] advanceRound failed:", err);
            handledRef.current = null;
          });
        }
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [roomCode, status, phase, currentRound, secondsLeft, allAnswered, endsAtMs]);

  // ── Render ──────────────────────────────────────────────────────────────────
  if (!room) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <div className="text-center space-y-4">
          <div className="w-12 h-12 rounded-full border-2 border-primary border-t-transparent animate-spin mx-auto" />
          <p className="text-muted-foreground">Connecting to match…</p>
        </div>
      </div>
    );
  }

  const playerName = (playerId: number) => {
    const p = players.find((pl) => pl.id === playerId);
    if (!p) return `Player ${playerId}`;
    if (p.guestName) return p.guestName;
    if (p.userId === user?.id) return "You";
    if (p.userId === room.hostUserId) return "Host";
    return `Player ${p.joinOrder ?? playerId}`;
  };

  const question = room.currentQuestion;
  const showLyric = (room.difficulty ?? "").toLowerCase() === "high";

  return (
    <div className="min-h-screen text-foreground relative overflow-hidden">
      {/* Background orbs — match the app palette */}
      <div className="absolute top-0 left-1/4 w-[28rem] h-[28rem] rounded-full bg-primary/20 blur-3xl pointer-events-none" />
      <div className="absolute bottom-0 right-1/4 w-[22rem] h-[22rem] rounded-full bg-accent/15 blur-3xl pointer-events-none" />

      {/* Top bar */}
      <div className="glass border-b border-border/50 sticky top-0 z-40">
        <div className="container flex items-center justify-between h-14">
          <span className="font-mono text-sm text-muted-foreground">
            Round {room.currentRound}/{room.roundsTotal}
          </span>
          <div className="inline-flex items-center gap-1.5 font-mono text-sm text-accent">
            <Clock className="w-3.5 h-3.5" /> {formatMMSS(secondsLeft)}
          </div>
        </div>
      </div>

      <div className="container relative z-10 py-6 max-w-5xl space-y-6">
        {/* Player video grid */}
        <VideoGrid participants={participants} />

        {/* Timer bar */}
        <div className="h-2 bg-muted rounded-full overflow-hidden">
          <div
            className="h-full bg-gradient-to-r from-primary to-accent transition-[width] duration-300 ease-linear"
            style={{ width: `${room.timerSeconds ? Math.min(100, (secondsLeft / room.timerSeconds) * 100) : 0}%` }}
          />
        </div>

        {room.roundPhase === "in_question" && question && (
          <section data-testid="match-question" className="space-y-6">
            <p className="font-display text-2xl sm:text-4xl font-black text-center leading-tight max-w-3xl mx-auto">
              "{question.promptLyric}
              <span className="text-accent">…</span>"
            </p>

            {showLyric && question.lyricOptions?.length > 0 && (
              <OptionGroup
                label="Lyric"
                options={question.lyricOptions}
                selected={lyricAnswer}
                onSelect={(v) => !hasSubmitted && setLyricAnswer(String(v))}
                disabled={hasSubmitted}
              />
            )}
            <OptionGroup
              label="Title"
              options={question.titleOptions}
              selected={titleAnswer}
              onSelect={(v) => !hasSubmitted && setTitleAnswer(String(v))}
              disabled={hasSubmitted}
            />
            <OptionGroup
              label="Artist"
              options={question.artistOptions}
              selected={artistAnswer}
              onSelect={(v) => !hasSubmitted && setArtistAnswer(String(v))}
              disabled={hasSubmitted}
            />
            <OptionGroup
              label="Year"
              options={question.yearOptions}
              selected={yearAnswer}
              onSelect={(v) => !hasSubmitted && setYearAnswer(Number(v))}
              disabled={hasSubmitted}
            />

            <div className="flex flex-col items-center gap-2">
              {hasSubmitted ? (
                <p className="text-emerald-400 font-medium">Answered — waiting for others…</p>
              ) : (
                <Button data-testid="match-submit" size="lg" onClick={handleSubmit}>
                  Lock In Answer
                </Button>
              )}
              {/* "Who's answered" — readiness dots derived from active players */}
              <div className="flex items-center gap-2 mt-2">
                {players
                  .filter((p) => p.isActive)
                  .map((p) => (
                    <span
                      key={p.id}
                      title={playerName(p.id)}
                      className={`w-2.5 h-2.5 rounded-full ${
                        p.userId === user?.id && hasSubmitted ? "bg-emerald-400" : "bg-slate-600"
                      }`}
                    />
                  ))}
              </div>
            </div>
          </section>
        )}

        {room.roundPhase === "intermission" && (
          <section className="space-y-4 max-w-md mx-auto">
            <h2 className="font-display text-2xl font-black text-center">
              {standings[0] ? `${playerName(standings[0].playerId)} is in the lead!` : "Round complete"}
            </h2>
            <p className="text-center text-muted-foreground">
              Next round in {formatMMSS(secondsLeft)}
            </p>
            <ul className="space-y-2">
              {standings.map((s) => (
                <li
                  key={s.playerId}
                  className="glass rounded-xl px-4 py-3 flex items-center justify-between border border-border/50"
                >
                  <span className="flex items-center gap-2">
                    <span className="font-mono text-muted-foreground w-6">#{s.rank}</span>
                    <span className="font-medium">{playerName(s.playerId)}</span>
                  </span>
                  <span className="inline-flex items-center gap-1 text-yellow-400 font-bold">
                    <Trophy className="w-4 h-4" /> {s.score}
                  </span>
                </li>
              ))}
            </ul>
          </section>
        )}
      </div>
    </div>
  );
}

function OptionGroup({
  label,
  options,
  selected,
  onSelect,
  disabled,
}: {
  label: string;
  options: (string | number)[];
  selected: string | number | null;
  onSelect: (value: string | number) => void;
  disabled: boolean;
}) {
  return (
    <div className="max-w-3xl mx-auto">
      <p className="text-xs uppercase tracking-wide text-muted-foreground mb-2">{label}</p>
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        {options.map((option, idx) => {
          const isChosen = selected != null && String(selected) === String(option);
          return (
            <button
              key={idx}
              type="button"
              onClick={() => onSelect(option)}
              disabled={disabled}
              className={`glass rounded-xl p-3 text-left font-display font-bold text-base disabled:opacity-50 disabled:cursor-not-allowed hover:border-primary/70 hover:bg-primary/10 ${
                isChosen ? "border-accent bg-accent/15 ring-2 ring-accent" : "border-border/50"
              }`}
            >
              {option}
            </button>
          );
        })}
      </div>
    </div>
  );
}
