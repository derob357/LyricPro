import { useState, useEffect } from "react";
import { useLocation, useSearch } from "wouter";
import { motion } from "framer-motion";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";
import { trpc } from "@/lib/trpc";
import { useAuth } from "@/_core/hooks/useAuth";
import { toast } from "sonner";
import { ArrowLeft, Users, User, UsersRound, Wifi, Clock, Layers, BarChart3, Music, Calendar, Zap, Flame, Trophy, ChevronRight, LogOut } from "lucide-react";
import { getLoginUrl, getSignUpUrl } from "@/const";
import type { GameMode, RankingMode, Difficulty } from "@/contexts/GameContext";

const GENRES = ["Country", "Hip Hop", "R&B", "Pop", "Rock", "Gospel", "Soul", "Jazz", "Blues", "Alternative", "Reggae", "Mixed"];
const DECADES = ["1940–1950", "1950–1960", "1960–1970", "1970–1980", "1980–1990", "1990–2000", "2000–2010", "2010–2020", "2020–Present"];
const TIMERS = [15, 30, 45];
const ROUNDS = [5, 10, 20];

export default function GameSetup() {
  const [, navigate] = useLocation();
  const search = useSearch();
  const params = new URLSearchParams(search);
  const { isAuthenticated, logout, user } = useAuth();

  const [mode, setMode] = useState<GameMode>((params.get("mode") as GameMode) || "solo");
  const [rankingMode, setRankingMode] = useState<RankingMode>("total_points");
  const [selectedGenres, setSelectedGenres] = useState<string[]>([]);
  const [selectedDecades, setSelectedDecades] = useState<string[]>([]);
  const [difficulty, setDifficulty] = useState<Difficulty>("medium");
  const [timerSeconds, setTimerSeconds] = useState(30);
  const [rounds, setRounds] = useState(10);
  const [explicitFilter, setExplicitFilter] = useState(false);
  const [isCreating, setIsCreating] = useState(false);

  // Redirect unauthenticated users to sign in
  useEffect(() => {
    if (!isAuthenticated && user !== undefined) {
      window.location.href = getLoginUrl();
    }
  }, [isAuthenticated, user]);

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
    setIsCreating(true);
    createRoomMutation.mutate({
      mode,
      rankingMode,
      genres: selectedGenres,
      decades: selectedDecades,
      difficulty,
      timerSeconds,
      rounds,
      explicitFilter,
    });
  };

  const modeOptions = [
    { value: "solo", icon: User, label: "Solo", desc: "Play alone" },
    { value: "multiplayer", icon: Users, label: "Multiplayer", desc: "Turn-based" },
    { value: "team", icon: UsersRound, label: "Team Mode", desc: "Team vs team" },
  ];

  const rankingOptions = [
    { value: "total_points", icon: Trophy, label: "Total Points", desc: "Classic scoring" },
    { value: "speed_bonus", icon: Zap, label: "Speed Bonus", desc: "Fast answers score more" },
    { value: "streak_bonus", icon: Flame, label: "Streak Bonus", desc: "Consecutive wins multiply" },
  ];

  const difficultyOptions = [
    { value: "low", label: "Low", desc: "Full lyric shown — name song, artist & year (100 pts max)", color: "text-green-400" },
    { value: "medium", label: "Medium", desc: "Full lyric shown — name song, artist & year (200 pts max)", color: "text-yellow-400" },
    { value: "high", label: "High", desc: "Complete the lyric + name artist & year (450 pts max)", color: "text-red-400" },
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
              {modeOptions.map(({ value, icon: Icon, label, desc }) => (
                <button
                  key={value}
                  onClick={() => setMode(value as GameMode)}
                  className={`glass rounded-xl p-4 text-center transition-all duration-200 border ${
                    mode === value
                      ? "border-primary/60 bg-primary/10 glow-purple"
                      : "border-border/40 hover:border-primary/30"
                  }`}
                >
                  <Icon className={`w-6 h-6 mx-auto mb-2 ${mode === value ? "text-primary" : "text-muted-foreground"}`} />
                  <div className={`font-semibold text-sm ${mode === value ? "text-primary" : "text-foreground"}`}>{label}</div>
                  <div className="text-xs text-muted-foreground mt-0.5">{desc}</div>
                </button>
              ))}
            </div>
          </section>

          {/* Ranking Mode */}
          <section>
            <div className="flex items-center gap-2 mb-4">
              <BarChart3 className="w-4 h-4 text-primary" />
              <h2 className="font-display font-semibold text-lg text-foreground">Ranking Mode</h2>
            </div>
            <div className="grid grid-cols-3 gap-3">
              {rankingOptions.map(({ value, icon: Icon, label, desc }) => (
                <button
                  key={value}
                  onClick={() => setRankingMode(value as RankingMode)}
                  className={`glass rounded-xl p-4 text-center transition-all duration-200 border ${
                    rankingMode === value
                      ? "border-primary/60 bg-primary/10 glow-purple"
                      : "border-border/40 hover:border-primary/30"
                  }`}
                >
                  <Icon className={`w-5 h-5 mx-auto mb-2 ${rankingMode === value ? "text-primary" : "text-muted-foreground"}`} />
                  <div className={`font-semibold text-sm ${rankingMode === value ? "text-primary" : "text-foreground"}`}>{label}</div>
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

          {/* Summary & Start */}
          <div className="glass rounded-2xl p-6 space-y-5">
            <h3 className="font-display font-semibold text-foreground text-lg">Game Summary</h3>
            <div className="grid grid-cols-2 gap-3">
              {/* Game Mode */}
              <div className="flex items-center gap-2.5 bg-white/5 rounded-xl px-3 py-2.5">
                {mode === "solo" ? <User className="w-4 h-4 text-primary shrink-0" /> : mode === "multiplayer" ? <Users className="w-4 h-4 text-primary shrink-0" /> : <UsersRound className="w-4 h-4 text-primary shrink-0" />}
                <div className="min-w-0">
                  <p className="text-[10px] text-muted-foreground uppercase tracking-wide">Mode</p>
                  <p className="text-sm font-medium text-foreground truncate">{mode === "solo" ? "Solo" : mode === "multiplayer" ? "Multiplayer" : "Team Mode"}</p>
                </div>
              </div>
              {/* Ranking Mode */}
              <div className="flex items-center gap-2.5 bg-white/5 rounded-xl px-3 py-2.5">
                {rankingMode === "speed_bonus" ? <Zap className="w-4 h-4 text-yellow-400 shrink-0" /> : rankingMode === "streak_bonus" ? <Flame className="w-4 h-4 text-orange-400 shrink-0" /> : <Trophy className="w-4 h-4 text-yellow-400 shrink-0" />}
                <div className="min-w-0">
                  <p className="text-[10px] text-muted-foreground uppercase tracking-wide">Ranking</p>
                  <p className="text-sm font-medium text-foreground truncate">{rankingMode === "total_points" ? "Total Points" : rankingMode === "speed_bonus" ? "Speed Bonus" : "Streak Bonus"}</p>
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
                  {mode === "solo" ? "Start Game" : "Create Room"}
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
