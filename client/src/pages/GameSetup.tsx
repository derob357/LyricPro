import { useState, useEffect, useRef } from "react";
import { useLocation, useSearch } from "wouter";
import { motion, AnimatePresence } from "framer-motion";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";
import { trpc } from "@/lib/trpc";
import { useAuth } from "@/_core/hooks/useAuth";
import { toast } from "sonner";
import { ArrowLeft, Users, User, UsersRound, Video, Wifi, Clock, Layers, BarChart3, Music, Music2, Calendar, ChevronRight, ChevronDown, Mic, Star, Crown, Trophy, LogOut, Coins, Plus, Minus } from "lucide-react";
import { getLoginUrl, getSignUpUrl } from "@/const";
import type { GameMode, Difficulty } from "@/contexts/GameContext";

const GENRES = ["Country", "Hip Hop", "R&B", "Pop", "Rock", "Gospel", "Soul", "Jazz", "Blues", "Alternative", "Reggae", "Mixed"];
const DECADES = ["1940–1950", "1950–1960", "1960–1970", "1970–1980", "1980–1990", "1990–2000", "2000–2010", "2010–2020", "2020–Present"];
const TIMERS = [15, 30, 45];
const ROUNDS = [3, 5, 10];

export default function GameSetup() {
  const [, navigate] = useLocation();
  const search = useSearch();
  const params = new URLSearchParams(search);
  const { isAuthenticated, logout, user } = useAuth();

  // Multiplayer + Team modes are temporarily disabled (see modeOptions
  // below). Force any URL ?mode=multiplayer/team back to solo so a stale
  // shared link doesn't land in a now-greyed-out mode.
  const [mode, setMode] = useState<GameMode>(() => {
    const fromUrl = params.get("mode") as GameMode | null;
    return fromUrl === "multiplayer" || fromUrl === "team" ? "solo" : (fromUrl || "solo");
  });
  const [selectedGenres, setSelectedGenres] = useState<string[]>([]);
  const [selectedDecades, setSelectedDecades] = useState<string[]>([]);
  const [difficulty, setDifficulty] = useState<Difficulty>("medium");
  const [openDifficulty, setOpenDifficulty] = useState<string | null>(null);
  const [timerSeconds, setTimerSeconds] = useState(30);
  const [rounds, setRounds] = useState(10);
  const [explicitFilter, setExplicitFilter] = useState(false);
  const [streakInsurance, setStreakInsurance] = useState(false);
  const [isCreating, setIsCreating] = useState(false);
  const [prefsApplied, setPrefsApplied] = useState(false);
  const hasHydratedRef = useRef(false);

  // Redirect unauthenticated users to sign in
  useEffect(() => {
    if (!isAuthenticated && user !== undefined) {
      window.location.href = getLoginUrl();
    }
  }, [isAuthenticated, user]);

  // Fetch saved prefs for logged-in users
  const { data: serverPrefs, isLoading: prefsLoading } = trpc.game.getMyGamePrefs.useQuery(
    undefined,
    { enabled: isAuthenticated }
  );

  // Hydrate form from saved prefs once on mount
  useEffect(() => {
    if (hasHydratedRef.current) return;
    if (isAuthenticated && prefsLoading) return; // wait for query

    let prefs: any = null;
    if (isAuthenticated && serverPrefs) {
      prefs = serverPrefs;
    } else if (!isAuthenticated) {
      try {
        const raw = localStorage.getItem("lyricpro_game_prefs");
        if (raw) prefs = JSON.parse(raw);
      } catch {}
    }

    if (prefs && typeof prefs === "object") {
      // URL ?mode= param takes precedence over saved prefs
      if (prefs.mode && params.get("mode") === null) setMode(prefs.mode);
      if (Array.isArray(prefs.genres)) setSelectedGenres(prefs.genres);
      if (Array.isArray(prefs.decades)) setSelectedDecades(prefs.decades);
      if (prefs.difficulty) setDifficulty(prefs.difficulty);
      if (typeof prefs.timerSeconds === "number") setTimerSeconds(prefs.timerSeconds);
      if (typeof prefs.rounds === "number") setRounds(prefs.rounds);
      if (typeof prefs.explicitFilter === "boolean") setExplicitFilter(prefs.explicitFilter);
      setPrefsApplied(true);
    }

    hasHydratedRef.current = true;
  }, [isAuthenticated, serverPrefs, prefsLoading]);

  // Ante stepper (solo + authenticated only): fetch earned balance to compute max stake.
  const { data: balanceData } = trpc.goldenNotes.getMyBalance.useQuery(
    undefined,
    { enabled: isAuthenticated }
  );
  const earnedBalance = balanceData?.earnedBalance ?? 0;
  const maxAnte = Math.floor(earnedBalance / 25) * 25;

  // ante state: null until balance loads (defaults to min(50, maxAnte) once loaded).
  const [ante, setAnte] = useState<number | null>(null);

  // Initialize ante from balance once data arrives and state is still null.
  useEffect(() => {
    if (ante === null && balanceData !== undefined) {
      setAnte(Math.min(50, maxAnte));
    }
  }, [balanceData, maxAnte]); // eslint-disable-line react-hooks/exhaustive-deps

  // Effective ante used in the payload and UI display.
  const effectiveAnte = ante ?? Math.min(50, maxAnte);

  const savePrefsMutation = trpc.game.saveGamePrefs.useMutation();

  const createRoomMutation = trpc.game.createRoom.useMutation({
    onSuccess: (data) => {
      if (mode === "solo") {
        navigate(`/play/${data.roomCode}`);
      } else {
        navigate(`/lobby/${data.roomCode}`);
      }
    },
    onError: (err) => {
      toast.error(err.message || "Failed to create game");
      setIsCreating(false);
    },
  });

  const createLiveRoomMutation = trpc.liveRoom.createLiveRoom.useMutation({
    onSuccess: (data) => {
      navigate(`/lobby/live/${data.inviteCode}`);
    },
    onError: (err) => {
      toast.error(err.message || "Failed to create live room");
      setIsCreating(false);
    },
  });

  const toggleGenre = (genre: string) => {
    setSelectedGenres(prev =>
      prev.includes(genre) ? prev.filter(g => g !== genre) : [...prev, genre]
    );
  };

  const toggleDecade = (decade: string) => {
    setSelectedDecades(prev =>
      prev.includes(decade) ? prev.filter(d => d !== decade) : [...prev, decade]
    );
  };

  const handleStart = () => {
    if (selectedGenres.length === 0) {
      toast.error("Please select at least one genre");
      return;
    }
    if (selectedDecades.length === 0) {
      toast.error("Please select at least one decade");
      return;
    }

    const prefs = { mode, genres: selectedGenres, decades: selectedDecades, difficulty, timerSeconds, rounds, explicitFilter };

    // Persist prefs (fire-and-forget — don't block createRoom)
    // remote_live uses its own mutation; skip room-prefs save for that mode
    if (mode !== "remote_live") {
      if (isAuthenticated) {
        savePrefsMutation.mutate(prefs as Parameters<typeof savePrefsMutation.mutate>[0]);
      } else {
        try { localStorage.setItem("lyricpro_game_prefs", JSON.stringify(prefs)); } catch {}
      }
    }

    setIsCreating(true);
    if (mode === "remote_live") {
      createLiveRoomMutation.mutate({
        selectedGenres,
        selectedDecades,
        difficulty,
        maxPlayers: 8,
        timerSeconds,
        roundsTotal: rounds,
        explicitFilter,
      });
      return;
    }
    createRoomMutation.mutate({
      mode,
      genres: selectedGenres,
      decades: selectedDecades,
      difficulty,
      timerSeconds,
      rounds,
      explicitFilter,
      streakInsurance,
      ante: mode === "solo" && isAuthenticated ? effectiveAnte : 0,
    });
  };

  // Multiplayer + Team modes are paused while we focus on Solo polish.
  // To re-enable: flip `disabled: false` on the relevant entries.
  const modeOptions = [
    { value: "solo", icon: User, label: "Solo", desc: "Play alone", disabled: false },
    { value: "multiplayer", icon: Users, label: "Multiplayer", desc: "Coming soon", disabled: true },
    { value: "team", icon: UsersRound, label: "Team Mode", desc: "Coming soon", disabled: true },
    { value: "remote_live", icon: Video, label: "Remote Live", desc: "Live video lobby (2-8 players)", disabled: false },
  ];

  const difficultyOptions = [
    { value: "low", label: "Low", desc: "4 questions per round — finish the lyric, name the title, artist & year (125 pts max)", color: "text-green-400" },
    { value: "medium", label: "Medium", desc: "4 questions per round — finish the lyric, name the title, artist & year (250 pts max)", color: "text-yellow-400" },
    { value: "high", label: "High", desc: "4 questions per round — finish the lyric, name the title, artist & year (400 pts max)", color: "text-red-400" },
  ];

  return (
    <div className="min-h-screen text-foreground">
      {/* Header */}
      <div className="glass border-b border-border/50 sticky top-0 z-40">
        <div className="container flex items-center justify-between h-16">
          <button onClick={() => navigate("/")} className="flex items-center gap-2 text-muted-foreground hover:text-foreground transition-colors">
            <ArrowLeft className="w-4 h-4" />
            <span className="text-sm">Back</span>
          </button>
          <h1 className="font-display font-bold text-lg text-gradient">Game Setup</h1>
          <div className="flex items-center gap-2">
            {isAuthenticated ? (
              <div className="flex items-center gap-3">
                <span className="text-sm text-foreground font-medium hidden sm:block">
                  {user?.firstName || user?.name?.split(" ")[0] || ""}
                </span>
                <button onClick={logout} className="flex items-center gap-1 text-muted-foreground hover:text-red-400 transition-colors text-xs" title="Log Out">
                  <LogOut className="w-3.5 h-3.5" />
                  <span className="hidden sm:inline">Log Out</span>
                </button>
              </div>
            ) : (
              <div className="flex items-center gap-2">
                <a href={getLoginUrl()} className="text-xs text-muted-foreground hover:text-foreground transition-colors">Sign In</a>
                <a href={getSignUpUrl()} className="text-xs text-primary hover:text-primary/80 transition-colors hidden sm:block">Sign Up</a>
              </div>
            )}
          </div>
        </div>
      </div>

      <div className="container py-8 max-w-3xl">
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          className="space-y-8"
        >
          {/* Quick-start card — shown when saved prefs were restored */}
          {prefsApplied && (
            <div className="glass rounded-2xl p-4 flex items-center justify-between gap-3">
              <div className="min-w-0">
                <p className="text-sm text-muted-foreground">Last settings restored</p>
                <p className="text-xs text-muted-foreground truncate">
                  {mode === "solo" ? "Solo" : mode === "multiplayer" ? "Multiplayer" : mode === "team" ? "Team Mode" : "Remote Live"} · {difficulty} · {rounds} rounds · {timerSeconds}s
                </p>
              </div>
              <Button
                className="bg-primary text-primary-foreground hover:bg-primary/90 glow-purple px-6 py-3 font-semibold rounded-xl shrink-0"
                onClick={handleStart}
                disabled={isCreating || selectedGenres.length === 0 || selectedDecades.length === 0}
              >
                {isCreating ? "Creating…" : (mode === "solo" ? "Start Game" : mode === "remote_live" ? "Create Live Room" : "Create Room")}
                <ChevronRight className="w-4 h-4 ml-1" />
              </Button>
            </div>
          )}

          {/* Player info */}
          {isAuthenticated && (
            <div className="glass rounded-xl p-4 flex items-center gap-3">
              <div className="w-8 h-8 rounded-full bg-primary/20 flex items-center justify-center">
                <User className="w-4 h-4 text-primary" />
              </div>
              <div className="flex-1">
                <p className="text-sm font-medium text-foreground">
                  Playing as: <span className="text-primary">{user?.firstName ? `${user.firstName}${user.lastName ? ' ' + user.lastName : ''}` : user?.name || "Player"}</span>
                </p>
              </div>
            </div>
          )}

          {/* Game Mode */}
          <section>
            <div className="flex items-center gap-2 mb-4">
              <Wifi className="w-4 h-4 text-primary" />
              <h2 className="font-display font-semibold text-lg text-foreground">Game Mode</h2>
            </div>
            <div className="grid grid-cols-3 gap-3">
              {modeOptions.map(({ value, icon: Icon, label, desc, disabled }) => (
                <button
                  key={value}
                  onClick={() => { if (!disabled) setMode(value as GameMode); }}
                  disabled={disabled}
                  aria-disabled={disabled ? "true" : "false"}
                  className={`glass rounded-xl p-4 text-center transition-all duration-200 border ${
                    disabled
                      ? "border-border/30 opacity-40 cursor-not-allowed"
                      : mode === value
                      ? "border-primary/60 bg-primary/10 glow-purple"
                      : "border-border/40 hover:border-primary/30"
                  }`}
                >
                  <Icon className={`w-6 h-6 mx-auto mb-2 ${disabled ? "text-muted-foreground" : mode === value ? "text-primary" : "text-muted-foreground"}`} />
                  <div className={`font-semibold text-sm ${disabled ? "text-muted-foreground" : mode === value ? "text-primary" : "text-foreground"}`}>{label}</div>
                  <div className="text-xs text-muted-foreground mt-0.5">{desc}</div>
                </button>
              ))}
            </div>
          </section>

          {/* Genre Selection */}
          <section>
            <div className="flex items-center gap-2 mb-4">
              <Music className="w-4 h-4 text-primary" />
              <h2 className="font-display font-semibold text-lg text-foreground">Genres</h2>
              <span className="text-muted-foreground text-sm">(select one or more)</span>
            </div>
            <div className="flex flex-wrap gap-2">
              {GENRES.map((genre) => (
                <button
                  key={genre}
                  onClick={() => toggleGenre(genre)}
                  className={`px-4 py-2 rounded-full text-sm font-medium transition-all duration-200 border ${
                    selectedGenres.includes(genre)
                      ? "bg-primary/20 border-primary/60 text-primary glow-purple"
                      : "glass border-border/40 text-muted-foreground hover:border-primary/30 hover:text-foreground"
                  }`}
                >
                  {genre}
                </button>
              ))}
            </div>
          </section>

          {/* Decade Selection */}
          <section>
            <div className="flex items-center gap-2 mb-4">
              <Calendar className="w-4 h-4 text-primary" />
              <h2 className="font-display font-semibold text-lg text-foreground">Decades</h2>
              <span className="text-muted-foreground text-sm">(select one or more)</span>
            </div>
            <div className="flex flex-wrap gap-2">
              {DECADES.map((decade) => (
                <button
                  key={decade}
                  onClick={() => toggleDecade(decade)}
                  className={`px-4 py-2 rounded-full text-sm font-medium transition-all duration-200 border ${
                    selectedDecades.includes(decade)
                      ? "bg-accent/20 border-accent/60 text-accent glow-cyan"
                      : "glass border-border/40 text-muted-foreground hover:border-accent/30 hover:text-foreground"
                  }`}
                >
                  {decade}
                </button>
              ))}
            </div>
          </section>

          {/* Difficulty */}
          <section>
            <div className="flex items-center gap-2 mb-4">
              <Layers className="w-4 h-4 text-primary" />
              <h2 className="font-display font-semibold text-lg text-foreground">Difficulty</h2>
            </div>
            <div className="grid grid-cols-3 gap-3">
              {difficultyOptions.map(({ value, label, desc, color }) => (
                <button
                  key={value}
                  onClick={() => setDifficulty(value as Difficulty)}
                  className={`glass rounded-xl p-4 text-center transition-all duration-200 border ${
                    difficulty === value
                      ? "border-primary/60 bg-primary/10"
                      : "border-border/40 hover:border-primary/30"
                  }`}
                >
                  <div className={`font-display font-bold text-lg ${difficulty === value ? color : "text-foreground"}`}>{label}</div>
                  <div className="text-xs text-muted-foreground mt-1">{desc}</div>
                </button>
              ))}
            </div>
          </section>

          {/* Point System */}
          <section>
            <div className="flex items-center gap-2 mb-2">
              <Trophy className="w-4 h-4 text-primary" />
              <h2 className="font-display font-semibold text-lg text-foreground">Point System</h2>
            </div>
            <p className="text-muted-foreground text-sm mb-4">Every round asks 4 questions — lyric, title, artist, and year. Points scale with difficulty.</p>
            <div className="space-y-2">
              {[
                { diff: "Low", color: "text-green-400", bg: "bg-green-500/10", border: "border-green-500/30", lyric: null, title: 25, artist: 25, year: 50, total: 100 },
                { diff: "Medium", color: "text-yellow-400", bg: "bg-yellow-500/10", border: "border-yellow-500/30", lyric: null, title: 50, artist: 50, year: 100, total: 200 },
                { diff: "High", color: "text-red-400", bg: "bg-red-500/10", border: "border-red-500/30", lyric: 50, title: 100, artist: 100, year: 200, total: 450 },
              ].map(({ diff, color, bg, border, lyric, title, artist, year, total }) => {
                const isOpen = openDifficulty === diff;
                return (
                  <div key={diff} className={`rounded-xl border ${border} ${bg} overflow-hidden`}>
                    <button
                      type="button"
                      onClick={() => setOpenDifficulty(isOpen ? null : diff)}
                      className="w-full flex items-center justify-between px-4 py-3 text-left hover:bg-white/5 transition-colors"
                      aria-expanded={isOpen}
                    >
                      <span className={`font-display font-bold text-base ${color}`}>{diff}</span>
                      <div className="flex items-center gap-3">
                        <span className="text-muted-foreground text-xs">Max {total} pts/round</span>
                        <ChevronDown className={`w-4 h-4 ${color} transition-transform ${isOpen ? "rotate-180" : ""}`} />
                      </div>
                    </button>
                    <AnimatePresence initial={false}>
                      {isOpen && (
                        <motion.div
                          initial={{ height: 0, opacity: 0 }}
                          animate={{ height: "auto", opacity: 1 }}
                          exit={{ height: 0, opacity: 0 }}
                          transition={{ duration: 0.2, ease: "easeInOut" }}
                          className="overflow-hidden"
                        >
                          <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 px-4 pb-4 pt-0">
                            {lyric !== null && (
                              <div className="text-center p-2 rounded-lg bg-card/40">
                                <Mic className="w-4 h-4 text-primary mx-auto mb-1" />
                                <div className="font-bold text-foreground text-sm">{lyric} pts</div>
                                <div className="text-muted-foreground text-xs">Lyric</div>
                              </div>
                            )}
                            <div className="text-center p-2 rounded-lg bg-card/40">
                              <Music className="w-4 h-4 text-accent mx-auto mb-1" />
                              <div className="font-bold text-foreground text-sm">{title} pts</div>
                              <div className="text-muted-foreground text-xs">Title</div>
                            </div>
                            <div className="text-center p-2 rounded-lg bg-card/40">
                              <Star className="w-4 h-4 text-primary mx-auto mb-1" />
                              <div className="font-bold text-foreground text-sm">{artist} pts</div>
                              <div className="text-muted-foreground text-xs">Artist</div>
                            </div>
                            <div className="text-center p-2 rounded-lg bg-card/40">
                              <Crown className="w-4 h-4 text-yellow-400 mx-auto mb-1" />
                              <div className="font-bold text-foreground text-sm">{year} pts</div>
                              <div className="text-muted-foreground text-xs">Year</div>
                            </div>
                          </div>
                        </motion.div>
                      )}
                    </AnimatePresence>
                  </div>
                );
              })}
            </div>
          </section>

          {/* Timer & Rounds */}
          <div className="grid sm:grid-cols-2 gap-6">
            <section>
              <div className="flex items-center gap-2 mb-4">
                <Clock className="w-4 h-4 text-primary" />
                <h2 className="font-display font-semibold text-lg text-foreground">Timer</h2>
              </div>
              <div className="flex gap-3">
                {TIMERS.map((t) => (
                  <button
                    key={t}
                    onClick={() => setTimerSeconds(t)}
                    className={`flex-1 glass rounded-xl py-3 text-center font-semibold transition-all duration-200 border ${
                      timerSeconds === t
                        ? "border-primary/60 bg-primary/10 text-primary"
                        : "border-border/40 text-muted-foreground hover:border-primary/30"
                    }`}
                  >
                    {t}s
                  </button>
                ))}
              </div>
            </section>

            <section>
              <div className="flex items-center gap-2 mb-4">
                <BarChart3 className="w-4 h-4 text-primary" />
                <h2 className="font-display font-semibold text-lg text-foreground">Rounds</h2>
              </div>
              <div className="flex gap-3">
                {ROUNDS.map((r) => (
                  <button
                    key={r}
                    onClick={() => setRounds(r)}
                    className={`flex-1 glass rounded-xl py-3 text-center font-semibold transition-all duration-200 border ${
                      rounds === r
                        ? "border-primary/60 bg-primary/10 text-primary"
                        : "border-border/40 text-muted-foreground hover:border-primary/30"
                    }`}
                  >
                    {r}
                  </button>
                ))}
              </div>
            </section>
          </div>

          {/* Clean Mode */}
          <section className="glass rounded-xl p-4 flex items-center justify-between">
            <div>
              <Label className="font-medium text-foreground">Clean Mode</Label>
              <p className="text-muted-foreground text-sm mt-0.5">Filter out songs with explicit content</p>
            </div>
            <Switch checked={explicitFilter} onCheckedChange={setExplicitFilter} />
          </section>

          {/* Streak Insurance — authenticated users only */}
          {isAuthenticated && (
            <section className="glass rounded-xl p-4 flex items-center justify-between">
              <div>
                <div className="flex items-center gap-2">
                  <Label className="font-medium text-foreground">Streak Insurance</Label>
                  <span className="flex items-center gap-0.5 text-yellow-400 neon-gold-sm text-xs font-semibold">
                    <Music2 className="w-3.5 h-3.5" />
                    3
                  </span>
                </div>
                <p className="text-muted-foreground text-sm mt-0.5">Keep your streak if you blank one round.</p>
              </div>
              <Switch checked={streakInsurance} onCheckedChange={setStreakInsurance} />
            </section>
          )}

          {/* Ante — stake earned Golden Notes on this game (solo, signed-in) */}
          {isAuthenticated && mode === "solo" && (
            <section className="glass rounded-xl p-4">
              <div className="flex items-center justify-between gap-4 flex-wrap">
                <div>
                  <h3 className="font-display font-semibold flex items-center gap-2">
                    <Coins className="w-4 h-4 text-yellow-400" /> Ante
                  </h3>
                  <p className="text-muted-foreground text-xs mt-1">
                    Stake Golden Notes: win a round (3+ of 4 correct) +25, lose a round −25 from your stake.
                    Unused stake comes back at the end. Stakeable: {earnedBalance}
                  </p>
                </div>
                <div className="flex items-center gap-3">
                  <Button
                    type="button"
                    variant="outline"
                    size="icon"
                    data-testid="ante-down"
                    onClick={() => setAnte(a => Math.max(0, (a ?? effectiveAnte) - 25))}
                  >
                    <Minus className="w-4 h-4" />
                  </Button>
                  <span
                    data-testid="ante-value"
                    className="font-display font-bold text-xl text-yellow-400 w-12 text-center"
                  >
                    {effectiveAnte}
                  </span>
                  <Button
                    type="button"
                    variant="outline"
                    size="icon"
                    data-testid="ante-up"
                    onClick={() => setAnte(a => Math.min(maxAnte, (a ?? effectiveAnte) + 25))}
                  >
                    <Plus className="w-4 h-4" />
                  </Button>
                </div>
              </div>
              {effectiveAnte === 0 && (
                <p className="text-xs text-muted-foreground mt-2">Playing for fun — no stake.</p>
              )}
            </section>
          )}

          {/* Summary & Start */}
          <div className="glass rounded-2xl p-6 space-y-5">
            <h3 className="font-display font-semibold text-foreground text-lg">Game Summary</h3>
            <div className="grid grid-cols-2 gap-3">
              {/* Game Mode */}
              <div className="flex items-center gap-2.5 bg-white/5 rounded-xl px-3 py-2.5">
                {mode === "solo" ? <User className="w-4 h-4 text-primary shrink-0" /> : mode === "multiplayer" ? <Users className="w-4 h-4 text-primary shrink-0" /> : mode === "team" ? <UsersRound className="w-4 h-4 text-primary shrink-0" /> : <Video className="w-4 h-4 text-primary shrink-0" />}
                <div className="min-w-0">
                  <p className="text-[10px] text-muted-foreground uppercase tracking-wide">Mode</p>
                  <p className="text-sm font-medium text-foreground truncate">{mode === "solo" ? "Solo" : mode === "multiplayer" ? "Multiplayer" : mode === "team" ? "Team Mode" : "Remote Live"}</p>
                </div>
              </div>
              {/* Difficulty */}
              <div className="flex items-center gap-2.5 bg-white/5 rounded-xl px-3 py-2.5">
                <BarChart3 className="w-4 h-4 text-primary shrink-0" />
                <div className="min-w-0">
                  <p className="text-[10px] text-muted-foreground uppercase tracking-wide">Difficulty</p>
                  <p className="text-sm font-medium text-foreground truncate">{difficulty.charAt(0).toUpperCase() + difficulty.slice(1)}</p>
                </div>
              </div>
              {/* Timer */}
              <div className="flex items-center gap-2.5 bg-white/5 rounded-xl px-3 py-2.5">
                <Clock className="w-4 h-4 text-primary shrink-0" />
                <div className="min-w-0">
                  <p className="text-[10px] text-muted-foreground uppercase tracking-wide">Timer</p>
                  <p className="text-sm font-medium text-foreground">{timerSeconds}s per round</p>
                </div>
              </div>
              {/* Rounds */}
              <div className="flex items-center gap-2.5 bg-white/5 rounded-xl px-3 py-2.5">
                <Layers className="w-4 h-4 text-primary shrink-0" />
                <div className="min-w-0">
                  <p className="text-[10px] text-muted-foreground uppercase tracking-wide">Rounds</p>
                  <p className="text-sm font-medium text-foreground">{rounds} rounds</p>
                </div>
              </div>
              {/* Clean Mode */}
              <div className="flex items-center gap-2.5 bg-white/5 rounded-xl px-3 py-2.5">
                <Music className="w-4 h-4 text-primary shrink-0" />
                <div className="min-w-0">
                  <p className="text-[10px] text-muted-foreground uppercase tracking-wide">Clean Mode</p>
                  <p className="text-sm font-medium text-foreground">{explicitFilter ? "On (family-safe)" : "Off"}</p>
                </div>
              </div>
              {/* Ante (solo signed-in only) */}
              {isAuthenticated && mode === "solo" && (
                <div className="flex items-center gap-2.5 bg-white/5 rounded-xl px-3 py-2.5">
                  <Coins className="w-4 h-4 text-yellow-400 shrink-0" />
                  <div className="min-w-0">
                    <p className="text-[10px] text-muted-foreground uppercase tracking-wide">Ante</p>
                    <p className="text-sm font-medium text-foreground">{effectiveAnte} GN</p>
                  </div>
                </div>
              )}
            </div>
            {/* Genres */}
            {selectedGenres.length > 0 && (
              <div className="bg-white/5 rounded-xl px-3 py-2.5">
                <div className="flex items-center gap-2 mb-2">
                  <Music className="w-4 h-4 text-primary shrink-0" />
                  <p className="text-[10px] text-muted-foreground uppercase tracking-wide">Genres</p>
                </div>
                <div className="flex flex-wrap gap-1.5">
                  {selectedGenres.map(g => <Badge key={g} variant="outline" className="border-primary/40 text-primary text-xs">{g}</Badge>)}
                </div>
              </div>
            )}
            {/* Decades */}
            {selectedDecades.length > 0 && (
              <div className="bg-white/5 rounded-xl px-3 py-2.5">
                <div className="flex items-center gap-2 mb-2">
                  <Calendar className="w-4 h-4 text-primary shrink-0" />
                  <p className="text-[10px] text-muted-foreground uppercase tracking-wide">Decades</p>
                </div>
                <div className="flex flex-wrap gap-1.5">
                  {selectedDecades.map(d => <Badge key={d} variant="outline" className="border-cyan-400/40 text-cyan-300 text-xs">{d}</Badge>)}
                </div>
              </div>
            )}
            <Button
              className="w-full bg-primary text-primary-foreground hover:bg-primary/90 glow-purple py-6 text-lg font-semibold rounded-xl"
              onClick={handleStart}
              disabled={isCreating || selectedGenres.length === 0 || selectedDecades.length === 0}
            >
              {isCreating ? "Creating Game..." : (
                <>
                  {mode === "solo" ? "Start Game" : mode === "remote_live" ? "Create Live Room" : "Create Room"}
                  <ChevronRight className="w-5 h-5 ml-2" />
                </>
              )}
            </Button>
          </div>
        </motion.div>
      </div>
    </div>
  );
}
