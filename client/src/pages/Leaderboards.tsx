import { useState } from "react";
import { useLocation } from "wouter";
import { motion } from "framer-motion";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { trpc } from "@/lib/trpc";
import { useAuth } from "@/_core/hooks/useAuth";
import { getRankTier } from "@/lib/scoring";
import { ArrowLeft, Trophy, Crown, Medal, Clock, Globe, Music, Users, User, UsersRound, Play } from "lucide-react";

const GENRES = ["R&B", "Hip Hop", "Pop", "Rock", "Country", "Gospel", "Soul", "Jazz", "Blues", "Alternative", "Reggae"];
const DECADES = ["1940–1950", "1950–1960", "1960–1970", "1970–1980", "1980–1990", "1990–2000", "2000–2010", "2010–2020", "2020–Present"];

type GameMode = "solo" | "multiplayer" | "team";

export default function Leaderboards() {
  const [, navigate] = useLocation();
  const { user, isAuthenticated } = useAuth();

  const [selectedMode, setSelectedMode] = useState<GameMode | undefined>(undefined);
  const [selectedGenre, setSelectedGenre] = useState<string | undefined>(undefined);
  const [selectedDecade, setSelectedDecade] = useState<string | undefined>(undefined);
  const [timeframe, setTimeframe] = useState<"weekly" | "all_time">("all_time");

  const { data: entries, isLoading } = trpc.game.getLeaderboard.useQuery({
    mode: selectedMode,
    genre: selectedGenre,
    decade: selectedDecade,
    timeframe,
    limit: 50,
  });

  const getRankIcon = (idx: number) => {
    if (idx === 0) return <Crown className="w-5 h-5 text-yellow-400" />;
    if (idx === 1) return <Medal className="w-5 h-5 text-slate-300" />;
    if (idx === 2) return <Medal className="w-5 h-5 text-amber-600" />;
    return <span className="text-muted-foreground text-sm font-bold w-5 text-center">{idx + 1}</span>;
  };

  return (
    <div className="min-h-screen text-foreground pb-8">
      {/* Header */}
      <div className="glass border-b border-border/50 sticky top-0 z-40">
        <div className="container flex items-center justify-between h-16">
          <button onClick={() => navigate("/")} className="flex items-center gap-2 text-muted-foreground hover:text-foreground transition-colors">
            <ArrowLeft className="w-4 h-4" />
            <span className="text-sm">Back</span>
          </button>
          <h1 className="font-display font-bold text-lg text-gradient">Leaderboards</h1>
          <Button size="sm" onClick={() => navigate("/setup")} className="bg-primary text-primary-foreground hover:bg-primary/90">
            <Play className="w-3 h-3 mr-1" /> Play
          </Button>
        </div>
      </div>

      <div className="container py-6 max-w-2xl">
        <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} className="space-y-5">

          {/* Timeframe toggle */}
          <div className="flex gap-2">
            <button
              onClick={() => setTimeframe("all_time")}
              className={`flex-1 flex items-center justify-center gap-2 py-3 rounded-xl border font-medium text-sm transition-all ${
                timeframe === "all_time"
                  ? "border-primary/60 bg-primary/10 text-primary"
                  : "glass border-border/40 text-muted-foreground hover:border-primary/30"
              }`}
            >
              <Globe className="w-4 h-4" /> All Time
            </button>
            <button
              onClick={() => setTimeframe("weekly")}
              className={`flex-1 flex items-center justify-center gap-2 py-3 rounded-xl border font-medium text-sm transition-all ${
                timeframe === "weekly"
                  ? "border-primary/60 bg-primary/10 text-primary"
                  : "glass border-border/40 text-muted-foreground hover:border-primary/30"
              }`}
            >
              <Clock className="w-4 h-4" /> This Week
            </button>
          </div>

          {/* Mode filter */}
          <div>
            <p className="text-muted-foreground text-xs uppercase tracking-wide mb-2">Game Mode</p>
            <div className="flex gap-2">
              {[
                { value: undefined, icon: Globe, label: "All" },
                { value: "solo" as GameMode, icon: User, label: "Solo" },
                { value: "multiplayer" as GameMode, icon: Users, label: "Multi" },
                { value: "team" as GameMode, icon: UsersRound, label: "Team" },
              ].map(({ value, icon: Icon, label }) => (
                <button
                  key={label}
                  onClick={() => setSelectedMode(value)}
                  className={`flex-1 flex items-center justify-center gap-1.5 py-2 rounded-xl border text-sm transition-all ${
                    selectedMode === value
                      ? "border-primary/60 bg-primary/10 text-primary"
                      : "glass border-border/40 text-muted-foreground hover:border-primary/30"
                  }`}
                >
                  <Icon className="w-3.5 h-3.5" /> {label}
                </button>
              ))}
            </div>
          </div>

          {/* Genre filter */}
          <div>
            <p className="text-muted-foreground text-xs uppercase tracking-wide mb-2">Genre</p>
            <div className="flex flex-wrap gap-2">
              <button
                onClick={() => setSelectedGenre(undefined)}
                className={`px-3 py-1.5 rounded-full text-xs font-medium border transition-all ${
                  !selectedGenre ? "border-primary/60 bg-primary/10 text-primary" : "glass border-border/40 text-muted-foreground hover:border-primary/30"
                }`}
              >
                All Genres
              </button>
              {GENRES.map(g => (
                <button
                  key={g}
                  onClick={() => setSelectedGenre(selectedGenre === g ? undefined : g)}
                  className={`px-3 py-1.5 rounded-full text-xs font-medium border transition-all ${
                    selectedGenre === g ? "border-primary/60 bg-primary/10 text-primary" : "glass border-border/40 text-muted-foreground hover:border-primary/30"
                  }`}
                >
                  {g}
                </button>
              ))}
            </div>
          </div>

          {/* Decade filter */}
          <div>
            <p className="text-muted-foreground text-xs uppercase tracking-wide mb-2">Decade</p>
            <div className="flex flex-wrap gap-2">
              <button
                onClick={() => setSelectedDecade(undefined)}
                className={`px-3 py-1.5 rounded-full text-xs font-medium border transition-all ${
                  !selectedDecade ? "border-accent/60 bg-accent/10 text-accent" : "glass border-border/40 text-muted-foreground hover:border-accent/30"
                }`}
              >
                All Decades
              </button>
              {DECADES.map(d => (
                <button
                  key={d}
                  onClick={() => setSelectedDecade(selectedDecade === d ? undefined : d)}
                  className={`px-3 py-1.5 rounded-full text-xs font-medium border transition-all ${
                    selectedDecade === d ? "border-accent/60 bg-accent/10 text-accent" : "glass border-border/40 text-muted-foreground hover:border-accent/30"
                  }`}
                >
                  {d}
                </button>
              ))}
            </div>
          </div>

          {/* Leaderboard table */}
          <div className="glass rounded-2xl overflow-hidden">
            <div className="p-4 border-b border-border/30 flex items-center gap-2">
              <Trophy className="w-4 h-4 text-yellow-400" />
              <h2 className="font-display font-semibold text-foreground">
                {timeframe === "weekly" ? "This Week's" : "All-Time"} Top Players
              </h2>
              {(selectedMode || selectedGenre || selectedDecade) && (
                <div className="flex gap-1 ml-auto">
                  {selectedMode && <Badge variant="secondary" className="text-xs capitalize">{selectedMode}</Badge>}
                  {selectedGenre && <Badge variant="secondary" className="text-xs">{selectedGenre}</Badge>}
                  {selectedDecade && <Badge variant="secondary" className="text-xs">{selectedDecade}</Badge>}
                </div>
              )}
            </div>

            {isLoading ? (
              <div className="p-8 text-center">
                <div className="w-8 h-8 rounded-full border-2 border-primary border-t-transparent animate-spin mx-auto mb-3" />
                <p className="text-muted-foreground text-sm">Loading leaderboard...</p>
              </div>
            ) : !entries || entries.length === 0 ? (
              <div className="p-8 text-center">
                <Music className="w-10 h-10 text-muted-foreground mx-auto mb-3" />
                <p className="text-foreground font-medium mb-1">No entries yet</p>
                <p className="text-muted-foreground text-sm">Be the first to set a score!</p>
                <Button
                  size="sm"
                  className="mt-4 bg-primary text-primary-foreground hover:bg-primary/90"
                  onClick={() => navigate("/setup")}
                >
                  Play Now
                </Button>
              </div>
            ) : (
              <div className="divide-y divide-border/20">
                {entries.map((entry, idx) => {
                  const isMe = isAuthenticated && user && entry.userId === user.id;
                  const name = entry.displayName || entry.guestName || "Anonymous";
                  const rankInfo = getRankTier(entry.score);

                  return (
                    <motion.div
                      key={entry.id}
                      initial={{ opacity: 0 }}
                      animate={{ opacity: 1 }}
                      transition={{ delay: Math.min(idx * 0.03, 0.5) }}
                      className={`flex items-center gap-4 p-4 transition-colors ${
                        idx === 0 ? "bg-yellow-400/5" :
                        isMe ? "bg-primary/5" : "hover:bg-card/30"
                      }`}
                    >
                      <div className="flex items-center justify-center w-6 shrink-0">
                        {getRankIcon(idx)}
                      </div>
                      <div className={`w-9 h-9 rounded-full flex items-center justify-center font-bold text-sm shrink-0 ${
                        idx === 0 ? "bg-yellow-400/20 text-yellow-400" :
                        isMe ? "bg-primary/20 text-primary" :
                        "bg-secondary text-foreground"
                      }`}>
                        {name.charAt(0).toUpperCase()}
                      </div>
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2">
                          <span className={`font-medium text-sm truncate ${isMe ? "text-primary" : "text-foreground"}`}>
                            {name}
                          </span>
                          {isMe && <span className="text-xs text-muted-foreground shrink-0">(you)</span>}
                        </div>
                        <div className="flex items-center gap-2 mt-0.5">
                          <span className={`text-xs ${rankInfo.color}`}>{rankInfo.tier}</span>
                          {entry.genre && <span className="text-muted-foreground text-xs">· {entry.genre}</span>}
                          {entry.mode && <span className="text-muted-foreground text-xs capitalize">· {entry.mode}</span>}
                        </div>
                      </div>
                      <div className="text-right shrink-0">
                        <div className={`font-display font-bold text-lg ${
                          idx === 0 ? "text-yellow-400" : isMe ? "text-primary" : "text-foreground"
                        }`}>
                          {entry.score.toLocaleString()}
                        </div>
                        <div className="text-muted-foreground text-xs">pts</div>
                      </div>
                    </motion.div>
                  );
                })}
              </div>
            )}
          </div>

          {/* Play CTA */}
          <Button
            className="w-full bg-primary text-primary-foreground hover:bg-primary/90 glow-purple py-5 font-semibold"
            onClick={() => navigate("/setup")}
          >
            <Play className="w-4 h-4 mr-2" /> Play to Earn Your Spot
          </Button>
        </motion.div>
      </div>
    </div>
  );
}
