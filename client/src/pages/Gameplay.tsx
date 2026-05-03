import { useState, useEffect, useRef, useCallback } from "react";
import { useLocation, useParams } from "wouter";
import { motion, AnimatePresence } from "framer-motion";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { trpc } from "@/lib/trpc";
import { useAuth } from "@/_core/hooks/useAuth";
import { toast } from "sonner";
import { Clock, Flame, Volume2, VolumeX, X, Trophy, Lightbulb, Music2 } from "lucide-react";
import Celebration, { type CelebrationLevel } from "@/components/Celebration";
import { usePaused } from "@/lib/pauseState";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";

type SongData = {
  id: number;
  title: string;
  artistName: string;
  lyricPrompt: string;
  lyricAnswer: string;
  releaseYear: number;
  genre: string;
  decade: string;
  difficulty: string;
  lyricOptions?: string[] | null;
  titleOptions?: string[] | null;
  artistOptions?: string[] | null;
  yearOptions?: (number | string)[] | null;
  artistMetadata?: Record<string, string | null> | null;
};

type Stage = "lyric" | "title" | "artist" | "year" | "submitting";

const POINT_LABELS = {
  low:    { lyric: 25, title: 25, artist: 25,  year: 50  },
  medium: { lyric: 50, title: 50, artist: 50,  year: 100 },
  high:   { lyric: 50, title: 50, artist: 100, year: 200 },
};

const BUZZ_KEYS = ["q", "b", "p", "y", "w", "e"];

const NUMBER_WORDS = ["zero", "one", "two", "three", "four", "five", "six", "seven", "eight", "nine", "ten",
  "eleven", "twelve", "thirteen", "fourteen", "fifteen", "sixteen", "seventeen", "eighteen", "nineteen", "twenty"];

export default function Gameplay() {
  const { roomCode } = useParams<{ roomCode: string }>();
  const [, navigate] = useLocation();
  const { user, isAuthenticated } = useAuth();
  const guestToken = localStorage.getItem("lyricpro_guest_token");

  const [currentSong, setCurrentSong] = useState<SongData | null>(null);
  const [stage, setStage] = useState<Stage>("lyric");
  const [answers, setAnswers] = useState({ lyric: "", title: "", artist: "", year: "" });
  const [timeLeft, setTimeLeft] = useState(30);
  const [timerActive, setTimerActive] = useState(false);
  const [roundStartTime, setRoundStartTime] = useState<number>(Date.now());
  const [showScoreFlash, setShowScoreFlash] = useState<number | null>(null);
  const [hasSubmitted, setHasSubmitted] = useState(false);
  const [celebrationLevel, setCelebrationLevel] = useState<CelebrationLevel>(0);
  const [muted, setMuted] = useState(() => localStorage.getItem("lyricpro_muted") === "true");
  const [buzzedPlayerIndex, setBuzzedPlayerIndex] = useState<number | null>(null);
  const [hintData, setHintData] = useState<Record<string, { firstLetter?: string; narrowedRange?: [number, number] } | null>>({});
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const tickSoundRef = useRef<HTMLAudioElement | null>(null);
  const paused = usePaused();

  const { data: room, refetch: refetchRoom } = trpc.game.getRoom.useQuery(
    { roomCode: roomCode ?? "" },
    { enabled: !!roomCode, refetchInterval: 3000 }
  );

  const difficulty = (room?.difficulty ?? "medium") as "low" | "medium" | "high";
  const ptLabels = POINT_LABELS[difficulty];
  const isSolo = room?.mode === "solo";

  const getNextSongMutation = trpc.game.getNextSong.useMutation({
    onSuccess: (song) => {
      setCurrentSong(song);
      setAnswers({ lyric: "", title: "", artist: "", year: "" });
      setStage("lyric");
      setHasSubmitted(false);
      setBuzzedPlayerIndex(null);
      setHintData({});
      setTimeLeft(room?.timerSeconds ?? 30);
      setRoundStartTime(Date.now());
      setTimerActive(true);
    },
    onError: (e) => toast.error(e.message),
  });

  const submitMutation = trpc.game.submitAnswer.useMutation({
    onSuccess: (result) => {
      setTimerActive(false);
      setHasSubmitted(true);
      setShowScoreFlash(result.total);
      setTimeout(() => setShowScoreFlash(null), 1500);
      sessionStorage.setItem(`lyricpro_round_result_${roomCode}`, JSON.stringify({
        ...result,
        song: currentSong,
      }));
      // Pull fresh player score so the top-bar trophy total animates to the
      // new value while the score flash is flying toward it.
      refetchRoom();
      const cnt = result.correctCount ?? 0;
      const lvl = (cnt >= 3 ? 3 : cnt >= 2 ? 2 : cnt >= 1 ? 1 : 0) as CelebrationLevel;
      if (lvl > 0) {
        setTimeout(() => setCelebrationLevel(lvl), 600);
      } else {
        navigate(`/results/round/${roomCode}`);
      }
    },
    onError: (e) => { toast.error(e.message); setHasSubmitted(false); },
  });

  const nextRoundMutation = trpc.game.nextRound.useMutation({
    onSuccess: (data) => {
      if (data.isGameOver) {
        navigate(`/results/final/${roomCode}`);
      } else {
        navigate(`/play/${roomCode}?round=${data.nextRound}`);
      }
    },
    onError: (e) => toast.error(e.message),
  });

  const trpcUtils = trpc.useUtils();

  const useHintMutation = trpc.game.useHint.useMutation({
    onSuccess: (result) => {
      setHintData(prev => ({ ...prev, [result.stage]: result }));
      trpcUtils.goldenNotes.getMyBalance.invalidate();
    },
    onError: (e) => toast.error(e.message || "Could not use hint"),
  });

  const startGameMutation = trpc.game.startGame.useMutation({
    onSuccess: () => refetchRoom(),
    onError: (e) => toast.error("Could not start game: " + e.message),
  });

  useEffect(() => {
    if (room && room.status === "waiting" && !startGameMutation.isPending) {
      startGameMutation.mutate({ roomCode: roomCode ?? "", guestToken: guestToken ?? undefined });
    }
  }, [room?.status]);

  useEffect(() => {
    if (room && room.status === "active" && !currentSong && !getNextSongMutation.isPending) {
      getNextSongMutation.mutate({ roomCode: roomCode ?? "" });
    }
  }, [room?.status]);

  // Submit accumulated answers to server.
  const submitAnswers = useCallback((final: typeof answers, passUsed = false) => {
    if (!currentSong || hasSubmitted) return;
    setHasSubmitted(true);
    setTimerActive(false);
    const responseTime = (Date.now() - roundStartTime) / 1000;
    submitMutation.mutate({
      roomCode: roomCode ?? "",
      songId: currentSong.id,
      lyricAnswer: final.lyric,
      titleAnswer: final.title,
      artistAnswer: final.artist,
      yearAnswer: final.year,
      passUsed,
      responseTimeSeconds: responseTime,
      answerMethod: "typed",
      guestToken: guestToken || undefined,
    });
  }, [currentSong, hasSubmitted, roundStartTime, roomCode, guestToken, submitMutation]);

  // Timer countdown with ticking sound in the last 10 seconds.
  useEffect(() => {
    if (!timerActive) {
      if (timerRef.current) clearInterval(timerRef.current);
      return;
    }
    timerRef.current = setInterval(() => {
      // Admin "freeze the world" — skip the tick so timeLeft holds steady
      // and the auto-submit at 0 doesn't fire during a pause.
      if (paused) return;
      setTimeLeft(prev => {
        if (prev <= 1) {
          clearInterval(timerRef.current!);
          setTimerActive(false);
          if (!hasSubmitted) submitAnswers(answers, false);
          return 0;
        }
        if (prev <= 10 && prev > 1 && !muted && tickSoundRef.current) {
          tickSoundRef.current.currentTime = 0;
          tickSoundRef.current.play().catch(() => {});
        }
        return prev - 1;
      });
    }, 1000);
    return () => { if (timerRef.current) clearInterval(timerRef.current); };
  }, [timerActive, hasSubmitted, muted, answers, submitAnswers, paused]);

  // Buzz-in keyboard listener.
  useEffect(() => {
    if (isSolo || !room?.players || buzzedPlayerIndex !== null || hasSubmitted) return;
    function onKey(e: KeyboardEvent) {
      const key = e.key.toLowerCase();
      const idx = BUZZ_KEYS.indexOf(key);
      if (idx < 0) return;
      if (!room?.players || idx >= room.players.length) return;
      setBuzzedPlayerIndex(idx);
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [isSolo, room?.players, buzzedPlayerIndex, hasSubmitted]);

  const toggleMute = () => {
    setMuted(prev => {
      const next = !prev;
      localStorage.setItem("lyricpro_muted", String(next));
      return next;
    });
  };

  // Handle selecting an MC option at the current stage.
  const pickOption = (value: string | number) => {
    if (hasSubmitted) return;
    // Only the buzzed player can answer in MP mode; solo is always enabled.
    if (!isSolo && buzzedPlayerIndex === null) return;
    const next = { ...answers };
    if (stage === "lyric") {
      next.lyric = String(value);
      setAnswers(next);
      setStage("title");
      setBuzzedPlayerIndex(null); // next stage re-opens buzzer
    } else if (stage === "title") {
      next.title = String(value);
      setAnswers(next);
      setStage("artist");
      setBuzzedPlayerIndex(null);
    } else if (stage === "artist") {
      next.artist = String(value);
      setAnswers(next);
      setStage("year");
      setBuzzedPlayerIndex(null);
    } else if (stage === "year") {
      next.year = String(value);
      setAnswers(next);
      setStage("submitting");
      submitAnswers(next, false);
    }
  };

  const handlePass = () => {
    submitAnswers({ lyric: "", title: "", artist: "", year: "" }, true);
  };

  const timerPct = ((timeLeft / (room?.timerSeconds ?? 30)) * 100);
  const isUrgent = timeLeft <= 5;

  const myPlayer = room?.players?.find(p =>
    (isAuthenticated && user && p.userId === user.id) ||
    (guestToken && p.guestToken === guestToken)
  );
  const myIndex = room?.players?.findIndex(p => p.id === myPlayer?.id) ?? 0;

  // Desaturation applies when someone else buzzed in (MP only).
  const desaturated = !isSolo && buzzedPlayerIndex !== null && buzzedPlayerIndex !== myIndex;

  // Stage metadata
  const stageInfo = (() => {
    if (stage === "lyric") {
      return {
        title: "Fill the Gap!",
        tag: "Lyric",
        value: ptLabels.lyric,
        options: currentSong?.lyricOptions ?? [],
        prompt: <>"{currentSong?.lyricPrompt}<span className="text-accent animate-pulse">...</span>"</>,
        sub: "Pick the missing line",
      };
    }
    if (stage === "title") {
      return {
        title: "Name That Song!",
        tag: "Title",
        value: ptLabels.title,
        options: currentSong?.titleOptions ?? [],
        prompt: <>"{currentSong?.lyricPrompt} {currentSong?.lyricAnswer}"</>,
        sub: "Which song is this?",
      };
    }
    if (stage === "artist") {
      return {
        title: "Who's the Artist?",
        tag: "Artist",
        value: ptLabels.artist,
        options: currentSong?.artistOptions ?? [],
        prompt: <>"{currentSong?.lyricPrompt} {currentSong?.lyricAnswer}" — who performed it?</>,
        sub: `Worth ${ptLabels.artist} pts`,
      };
    }
    // year
    return {
      title: "What Year?",
      tag: "Year",
      value: ptLabels.year,
      options: currentSong?.yearOptions ?? [],
      prompt: <>What year was "{currentSong?.title}" released?</>,
      sub: `Worth ${ptLabels.year} pts`,
    };
  })();

  const roundNumberPadded = String(room?.currentRound ?? 1).padStart(2, "0");
  const ghostWord = NUMBER_WORDS[(room?.currentRound ?? 1)] ?? "one";

  if (!room || !currentSong) {
    const loadingMsg = !room
      ? "Connecting to game..."
      : room.status === "waiting"
      ? "Starting game..."
      : getNextSongMutation.isError
      ? "Failed to load song. No songs match your selection."
      : "Loading round...";
    return (
      <div className="min-h-screen flex items-center justify-center">
        <div className="text-center space-y-4">
          {getNextSongMutation.isError ? (
            <div className="text-4xl">🎵</div>
          ) : (
            <div className="w-12 h-12 rounded-full border-2 border-primary border-t-transparent animate-spin mx-auto" />
          )}
          <p className="text-muted-foreground">{loadingMsg}</p>
          {getNextSongMutation.isError && (
            <Button variant="outline" onClick={() => navigate("/")}>Back to Home</Button>
          )}
          {room && room.status === "active" && !getNextSongMutation.isError && !getNextSongMutation.isPending && (
            <Button variant="outline" size="sm" onClick={() => getNextSongMutation.mutate({ roomCode: roomCode ?? "" })}>
              Retry
            </Button>
          )}
        </div>
      </div>
    );
  }

  const stageColor =
    stage === "lyric" || stage === "title" ? "primary" :
    stage === "artist" ? "accent" :
    "gold";

  return (
    <div className={`min-h-screen text-foreground relative overflow-hidden ${desaturated ? "stage-desaturated" : "stage-saturated"}`}>
      {/* Background orbs — same palette as home page */}
      <div className="absolute top-0 left-1/4 w-[28rem] h-[28rem] rounded-full bg-primary/20 blur-3xl pointer-events-none" />
      <div className="absolute bottom-0 right-1/4 w-[22rem] h-[22rem] rounded-full bg-accent/15 blur-3xl pointer-events-none" />

      {/* Hidden audio for ticking */}
      <audio
        ref={tickSoundRef}
        src="https://d2xsxph8kpxj0f.cloudfront.net/310519663406910235/dvh3FomWkRxEgTdm5VV9Xk/24-ClockEffect_b13f166a.mp3"
        preload="auto"
      />

      {/* Celebration */}
      <Celebration
        level={celebrationLevel}
        muted={muted}
        onComplete={() => {
          setCelebrationLevel(0);
          navigate(`/results/round/${roomCode}`);
        }}
      />

      {/* Top bar */}
      <div className="glass border-b border-border/50 sticky top-0 z-40">
        <div className="container flex items-center justify-between h-14">
          <div className="flex items-center gap-2">
            <AlertDialog>
              <AlertDialogTrigger asChild>
                <Button variant="ghost" size="icon" className="text-muted-foreground hover:text-red-400" title="Quit game">
                  <X className="w-4 h-4" />
                </Button>
              </AlertDialogTrigger>
              <AlertDialogContent>
                <AlertDialogHeader>
                  <AlertDialogTitle>Quit this game?</AlertDialogTitle>
                  <AlertDialogDescription>
                    Your progress for this session will be lost. You'll be taken back to the home screen.
                  </AlertDialogDescription>
                </AlertDialogHeader>
                <AlertDialogFooter>
                  <AlertDialogCancel>Keep Playing</AlertDialogCancel>
                  <AlertDialogAction className="bg-red-600 hover:bg-red-700 text-white" onClick={() => navigate("/")}>
                    Quit Game
                  </AlertDialogAction>
                </AlertDialogFooter>
              </AlertDialogContent>
            </AlertDialog>
            <Badge variant="secondary" className="font-mono">Round {room.currentRound}/{room.roundsTotal}</Badge>
            {room.rankingMode === "streak_bonus" && myPlayer && myPlayer.currentStreak >= 2 && (
              <Badge className="bg-orange-500/20 text-orange-400 border-orange-500/30">
                <Flame className="w-3 h-3 mr-1" /> {myPlayer.currentStreak}x Streak
              </Badge>
            )}
          </div>
          <Button variant="ghost" size="icon" className="text-muted-foreground hover:text-foreground" onClick={toggleMute}>
            {muted ? <VolumeX className="w-4 h-4" /> : <Volume2 className="w-4 h-4" />}
          </Button>
          <div className="flex items-center gap-2">
            <Trophy className="w-4 h-4 text-yellow-400" />
            <motion.span
              key={myPlayer?.currentScore ?? 0}
              initial={{ scale: 1.5, color: "#fbbf24" }}
              animate={{ scale: 1, color: "var(--foreground)" }}
              transition={{ duration: 0.4, ease: "easeOut" }}
              className="font-semibold text-foreground inline-block"
            >
              {myPlayer?.currentScore ?? 0}
            </motion.span>
          </div>
        </div>
      </div>

      {/* Main stage */}
      <div className="container relative z-10 py-8 max-w-4xl">
        {/* Ghost number-word backdrop */}
        <div
          aria-hidden
          className="absolute right-0 top-1/3 pointer-events-none select-none font-display font-black leading-none text-[12rem] sm:text-[16rem] tracking-tighter ghost-number"
        >
          {ghostWord}
        </div>

        {/* Header row: round badge + title + prize value + timer */}
        <div className="flex items-start justify-between gap-4 mb-6 relative z-10">
          <div className="flex items-center gap-4">
            <div className={`w-14 h-14 rounded-full bg-${stageColor === "gold" ? "yellow-400" : stageColor}/15 border-2 border-${stageColor === "gold" ? "yellow-400" : stageColor}/50 flex items-center justify-center font-display font-black text-lg text-foreground glow-purple`}>
              {roundNumberPadded}
            </div>
            <div>
              <h2 className="font-display text-2xl sm:text-3xl font-black text-gradient leading-tight">
                {stageInfo.title}
              </h2>
              <div className="flex items-center gap-2 mt-1">
                <Badge className={`text-xs ${
                  stage === "lyric" || stage === "title" ? "bg-primary/20 text-primary border-primary/40" :
                  stage === "artist" ? "bg-accent/20 text-accent border-accent/40" :
                  "bg-yellow-500/20 text-yellow-400 border-yellow-500/40"
                }`}>{stageInfo.tag}</Badge>
                <Badge variant="secondary" className="text-xs">{currentSong.genre}</Badge>
                <Badge variant="secondary" className="text-xs">{currentSong.decade}</Badge>
                <Badge variant="secondary" className="text-xs capitalize">{difficulty}</Badge>
              </div>
            </div>
          </div>
          <div className="text-right shrink-0">
            <div className="font-display font-black text-3xl sm:text-4xl text-yellow-400 neon-gold inline-flex items-center justify-end gap-1.5">
              <Music2 className="w-7 h-7 sm:w-9 sm:h-9" />
              {stageInfo.value}
            </div>
            <div className={`inline-flex items-center gap-1 mt-1 text-sm font-mono ${isUrgent ? "timer-urgent" : "text-accent"}`}>
              <Clock className="w-3.5 h-3.5" /> 0:{String(timeLeft).padStart(2, "0")}
            </div>
          </div>
        </div>

        {/* Timer bar */}
        <div className="mb-6 h-1.5 bg-muted rounded-full overflow-hidden relative z-10">
          <div
            className={`h-full transition-all duration-1000 ease-linear ${isUrgent ? "bg-red-500" : "bg-gradient-to-r from-primary to-accent"}`}
            style={{ width: `${timerPct}%` }}
          />
        </div>

        {/* Score flash — flies up toward the top-bar trophy on exit */}
        <AnimatePresence>
          {showScoreFlash !== null && (
            <motion.div
              initial={{ opacity: 0, scale: 0.5, y: -20 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.3, y: -64, x: "42vw" }}
              transition={{ exit: { duration: 0.5, ease: "easeIn" } }}
              className="fixed top-20 left-1/2 -translate-x-1/2 z-50 bg-primary text-primary-foreground px-6 py-3 rounded-2xl font-display font-black text-2xl glow-purple"
            >
              +{showScoreFlash} pts!
            </motion.div>
          )}
        </AnimatePresence>

        {/* Prompt */}
        <AnimatePresence mode="wait">
          <motion.div
            key={`${currentSong.id}-${stage}`}
            initial={{ opacity: 0, y: 16 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -8 }}
            className="relative z-10 mb-6"
          >
            <p className="font-display text-xl sm:text-2xl font-bold text-foreground leading-relaxed text-center max-w-3xl mx-auto">
              {stageInfo.prompt}
            </p>
            <p className="text-muted-foreground text-sm text-center mt-2">{stageInfo.sub}</p>
          </motion.div>
        </AnimatePresence>

        {/* Buzz-in gate for MP */}
        {!isSolo && buzzedPlayerIndex === null && !hasSubmitted && (
          <div className="relative z-10 text-center mb-4">
            <Badge className="bg-accent/20 text-accent border-accent/40 px-4 py-1 text-sm">
              Press your buzzer key to answer
            </Badge>
          </div>
        )}

        {/* Hint notice — shown above MC grid after hint is used */}
        {stage !== "submitting" && hintData[stage] && (
          <div className="relative z-10 max-w-3xl mx-auto mb-3">
            <div className="glass rounded-xl px-4 py-2.5 flex items-center gap-2 border border-yellow-400/30 bg-yellow-400/5">
              <Lightbulb className="w-4 h-4 text-yellow-400 shrink-0" />
              <span className="text-sm text-yellow-300">
                {stage === "year" && hintData[stage]?.narrowedRange
                  ? `Year is between ${hintData[stage]!.narrowedRange![0]} and ${hintData[stage]!.narrowedRange![1]}`
                  : `Starts with: ${hintData[stage]?.firstLetter}`
                }
              </span>
            </div>
          </div>
        )}

        {/* MC options grid */}
        <div className="relative z-10 grid grid-cols-1 sm:grid-cols-2 gap-3 max-w-3xl mx-auto mb-8">
          {stageInfo.options.map((option, idx) => {
            const isChosen =
              (stage === "lyric" && answers.lyric === String(option)) ||
              (stage === "title" && answers.title === String(option)) ||
              (stage === "artist" && answers.artist === String(option)) ||
              (stage === "year" && answers.year === String(option));
            const disabled = hasSubmitted || (!isSolo && buzzedPlayerIndex !== null && buzzedPlayerIndex !== myIndex);
            return (
              <button
                key={idx}
                type="button"
                onClick={() => pickOption(option)}
                disabled={disabled}
                className={`group glass rounded-xl p-4 text-left flex items-center gap-3 transition-all hover:border-primary/70 hover:bg-primary/10 hover:shadow-[0_0_20px_oklch(0.65_0.28_290/0.25)] disabled:opacity-50 disabled:cursor-not-allowed ${
                  isChosen ? "border-accent bg-accent/15 ring-2 ring-accent" : "border-border/50"
                }`}
              >
                <span className="w-8 h-8 rounded-full bg-primary/20 border border-primary/50 text-primary font-bold text-sm flex items-center justify-center shrink-0">
                  {idx + 1}
                </span>
                <span className="font-display font-bold text-base sm:text-lg text-accent uppercase tracking-wide">
                  {option}
                </span>
              </button>
            );
          })}
        </div>

        {/* Hint button — authenticated users only, one per stage */}
        {isAuthenticated && !hasSubmitted && stage !== "submitting" && (
          <div className="relative z-10 text-center mb-4">
            {hintData[stage] ? (
              <Button variant="ghost" size="sm" disabled className="text-muted-foreground opacity-50 cursor-not-allowed">
                <Lightbulb className="w-3.5 h-3.5 mr-1" />
                Hint used
              </Button>
            ) : (
              <Button
                variant="ghost"
                size="sm"
                onClick={() => {
                  if (!currentSong) return;
                  useHintMutation.mutate({ roomCode: roomCode ?? "", songId: currentSong.id, stage: stage as "lyric" | "title" | "artist" | "year" });
                }}
                disabled={useHintMutation.isPending}
                className="text-yellow-400 hover:text-yellow-300 hover:bg-yellow-400/10"
              >
                <Lightbulb className="w-3.5 h-3.5 mr-1" />
                Hint (1 GN)
              </Button>
            )}
          </div>
        )}

        {/* Pass button */}
        {!hasSubmitted && (isSolo || buzzedPlayerIndex === myIndex) && (
          <div className="relative z-10 text-center mb-6">
            <Button variant="ghost" size="sm" onClick={handlePass} className="text-muted-foreground hover:text-foreground">
              Pass this round
            </Button>
          </div>
        )}

        {/* Player panels */}
        <div className="relative z-10 mt-4">
          <div className={`grid gap-3 ${room.players && room.players.length > 1
            ? `grid-cols-${Math.min(room.players.length, 4)}`
            : "grid-cols-1 max-w-xs mx-auto"}`}>
            {(room.players ?? []).map((p, idx) => {
              const isMe = p.id === myPlayer?.id;
              const hasBuzzed = buzzedPlayerIndex === idx;
              const displayName = p.guestName || (isMe ? (user?.firstName ?? "You") : `Player ${idx + 1}`);
              return (
                <div
                  key={p.id}
                  className={`relative glass rounded-xl pt-3 px-3 pb-2 text-center transition-all ${
                    hasBuzzed ? "ring-2 ring-accent glow-cyan" : ""
                  } ${isMe ? "border-primary/60" : "border-border/50"}`}
                >
                  {!isSolo && (
                    <div className="absolute top-1.5 right-1.5 w-6 h-6 rounded-full bg-accent text-background font-bold text-xs flex items-center justify-center buzz-key-glow">
                      {BUZZ_KEYS[idx]?.toUpperCase()}
                    </div>
                  )}
                  <div className="font-display font-black text-5xl sm:text-6xl leading-none text-gradient">
                    {idx + 1}
                  </div>
                  <div className="font-display font-bold text-foreground text-sm mt-1 truncate">
                    {displayName}
                  </div>
                  <div className="text-yellow-400 font-bold text-sm neon-gold-sm">
                    ${p.currentScore ?? 0}
                  </div>
                  {p.currentStreak >= 2 && (
                    <Flame className="w-3 h-3 text-orange-400 absolute bottom-1 left-1.5" />
                  )}
                </div>
              );
            })}
          </div>
        </div>
      </div>
    </div>
  );
}
