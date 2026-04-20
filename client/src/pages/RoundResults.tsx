import { useEffect, useState } from "react";
import { useLocation, useParams } from "wouter";
import { motion } from "framer-motion";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { trpc } from "@/lib/trpc";
import { useAuth } from "@/_core/hooks/useAuth";
import { toast } from "sonner";
import {
  Check, X, ChevronRight, ExternalLink, Music, Instagram,
  Facebook, Youtube, Globe, Trophy, Flame, Zap, SkipForward, Home,
  Play
} from "lucide-react";
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

type RoundResult = {
  lyricCorrect: boolean;
  artistCorrect: boolean;
  titleCorrect?: boolean;
  lyricPoints: number;
  artistPoints: number;
  titlePoints?: number;
  yearPoints: number;
  speedBonus: number;
  streakBonus: number;
  total: number;
  newScore: number;
  newStreak: number;
  correctLyric: string;
  correctArtist: string;
  correctYear: number;
  difficulty?: string;
  song: {
    id: number;
    title: string;
    artistName: string;
    lyricPrompt: string;
    genre: string;
    decade: string;
    artistMetadata?: Record<string, string | null> | null;
  };
};

export default function RoundResults() {
  const { roomCode } = useParams<{ roomCode: string }>();
  const [, navigate] = useLocation();
  const { user, isAuthenticated } = useAuth();
  const guestToken = localStorage.getItem("lyricpro_guest_token");
  const [result, setResult] = useState<RoundResult | null>(null);
  const [isAdvancing, setIsAdvancing] = useState(false);

  const { data: room } = trpc.game.getRoom.useQuery(
    { roomCode: roomCode ?? "" },
    { enabled: !!roomCode }
  );

  const nextRoundMutation = trpc.game.nextRound.useMutation({
    onSuccess: (data) => {
      if (data.isGameOver) {
        navigate(`/results/final/${roomCode}`);
      } else {
        // Include ?round= param so GameplayWithKey remounts the component with fresh state
        navigate(`/play/${roomCode}?round=${data.nextRound}`);
      }
    },
    onError: (e) => { toast.error(e.message); setIsAdvancing(false); },
  });

  useEffect(() => {
    const stored = sessionStorage.getItem(`lyricpro_round_result_${roomCode}`);
    if (stored) {
      try {
        setResult(JSON.parse(stored));
      } catch {}
    }
  }, [roomCode]);

  const handleNext = () => {
    setIsAdvancing(true);
    nextRoundMutation.mutate({ roomCode: roomCode ?? "" });
  };

  if (!result) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <div className="text-center">
          <div className="w-12 h-12 rounded-full border-2 border-primary border-t-transparent animate-spin mx-auto mb-4" />
          <p className="text-muted-foreground">Loading results...</p>
        </div>
      </div>
    );
  }

  const isLastRound = room && room.currentRound >= room.roundsTotal;
  const passedRound = result.total === 0 && result.lyricPoints === 0 && !result.titlePoints && !result.artistPoints;
  const diff = result.difficulty || room?.difficulty || "medium";
  const isHighDiff = diff === "high";
  const maxArtist = isHighDiff ? 100 : diff === "medium" ? 50 : 25;
  const maxTitle = isHighDiff ? 100 : diff === "medium" ? 50 : 25;
  const maxYear = isHighDiff ? 200 : diff === "medium" ? 100 : 50;

  // Always generate dynamic links from artist name + song title
  const artistQ = encodeURIComponent(result.correctArtist);
  const videoQ = encodeURIComponent(`${result.correctArtist} ${result.song.title} official music video`);
  const spotifyQ = encodeURIComponent(result.correctArtist);
  const appleMusicQ = encodeURIComponent(result.correctArtist);
  const googleQ = encodeURIComponent(`${result.correctArtist} official website`);

  // Use stored metadata URLs if available, otherwise fall back to search URLs
  const meta = result.song.artistMetadata ?? {};
  const artistLinks = [
    {
      icon: Play,
      label: "Music Video",
      url: `https://www.youtube.com/results?search_query=${videoQ}`,
      color: "text-red-400",
      highlight: true,
    },
    {
      icon: Youtube,
      label: "YouTube",
      url: (meta as Record<string, string | null>).youtubeUrl ?? `https://www.youtube.com/results?search_query=${artistQ}`,
      color: "text-red-400",
    },
    {
      icon: null,
      label: "Spotify",
      url: (meta as Record<string, string | null>).spotifyUrl ?? `https://open.spotify.com/search/${spotifyQ}`,
      color: "text-green-400",
    },
    {
      icon: null,
      label: "Apple Music",
      url: (meta as Record<string, string | null>).appleMusicUrl ?? `https://music.apple.com/us/search?term=${appleMusicQ}`,
      color: "text-pink-500",
    },
    {
      icon: Instagram,
      label: "Instagram",
      url: (meta as Record<string, string | null>).instagramUrl ?? `https://www.instagram.com/${result.correctArtist.toLowerCase().replace(/[^a-z0-9]/g, '')}/`,
      color: "text-pink-400",
    },
    {
      icon: Globe,
      label: "Official Site",
      url: (meta as Record<string, string | null>).officialWebsite ?? `https://www.google.com/search?q=${googleQ}`,
      color: "text-blue-400",
    },
  ];

  return (
    <div className="min-h-screen text-foreground pb-8">
      {/* Header */}
      <div className="glass border-b border-border/50 sticky top-0 z-40">
        <div className="container flex items-center justify-between h-14">
          {/* Left: Home/Quit + Round */}
          <div className="flex items-center gap-2">
            <AlertDialog>
              <AlertDialogTrigger asChild>
                <Button
                  variant="ghost"
                  size="icon"
                  className="text-muted-foreground hover:text-red-400 transition-colors"
                  title="Exit to home"
                >
                  <Home className="w-4 h-4" />
                </Button>
              </AlertDialogTrigger>
              <AlertDialogContent>
                <AlertDialogHeader>
                  <AlertDialogTitle>Exit to home?</AlertDialogTitle>
                  <AlertDialogDescription>
                    You'll leave the current game and return to the home screen.
                  </AlertDialogDescription>
                </AlertDialogHeader>
                <AlertDialogFooter>
                  <AlertDialogCancel>Stay</AlertDialogCancel>
                  <AlertDialogAction
                    className="bg-red-600 hover:bg-red-700 text-white"
                    onClick={() => navigate("/")}
                  >
                    Exit to Home
                  </AlertDialogAction>
                </AlertDialogFooter>
              </AlertDialogContent>
            </AlertDialog>
            <Badge variant="secondary" className="font-mono">
              Round {room?.currentRound}/{room?.roundsTotal}
            </Badge>
          </div>
          {/* Center: Logo */}
          <div className="flex items-center gap-2">
            <Music className="w-4 h-4 text-primary" />
            <span className="font-display font-bold text-sm text-gradient">LyricPro Ai</span>
          </div>
          {/* Right: Score */}
          <div className="flex items-center gap-2">
            <Trophy className="w-4 h-4 text-yellow-400" />
            <span className="font-semibold">{result.newScore}</span>
          </div>
        </div>
      </div>

      <div className="container py-6 max-w-2xl">
        <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} className="space-y-5">

          {/* Score summary */}
          <div className={`glass rounded-2xl p-6 text-center relative overflow-hidden ${
            result.total > 0 ? "border-primary/40" : "border-border/40"
          }`}>
            <div className={`absolute inset-0 bg-gradient-to-br ${
              result.total >= 30 ? "from-primary/10 to-accent/5" :
              result.total > 0 ? "from-primary/5 to-transparent" :
              "from-transparent to-transparent"
            } pointer-events-none`} />
            <div className="relative">
              {passedRound ? (
                <>
                  <SkipForward className="w-10 h-10 text-muted-foreground mx-auto mb-2" />
                  <p className="text-muted-foreground font-medium">Round Passed</p>
                </>
              ) : (
                <>
                  <motion.div
                    initial={{ scale: 0 }}
                    animate={{ scale: 1 }}
                    transition={{ type: "spring", stiffness: 200, damping: 15 }}
                    className="font-display text-6xl font-black text-gradient mb-1"
                  >
                    +{result.total}
                  </motion.div>
                  <p className="text-muted-foreground text-sm">points this round</p>
                  {result.newStreak >= 2 && (
                    <div className="flex items-center justify-center gap-1 mt-2">
                      <Flame className="w-4 h-4 text-orange-400" />
                      <span className="text-orange-400 font-medium text-sm">{result.newStreak}x Streak!</span>
                    </div>
                  )}
                </>
              )}
            </div>
          </div>

          {/* Score breakdown */}
          <div className="glass rounded-2xl p-5">
            <h3 className="font-display font-semibold mb-4 text-foreground">Score Breakdown</h3>
            <div className="space-y-3">
              {isHighDiff && (
                <ScoreRow
                  label="Lyric"
                  correct={result.lyricCorrect}
                  points={result.lyricPoints}
                  maxPoints={50}
                />
              )}
              <ScoreRow
                label="Song Title"
                correct={!!(result.titleCorrect)}
                points={result.titlePoints ?? 0}
                maxPoints={maxTitle}
              />
              <ScoreRow
                label="Artist"
                correct={result.artistCorrect}
                points={result.artistPoints}
                maxPoints={maxArtist}
              />
              <ScoreRow
                label="Release Year"
                correct={result.yearPoints > 0}
                points={result.yearPoints}
                maxPoints={maxYear}
                partial={result.yearPoints > 0 && result.yearPoints < maxYear}
              />
              {result.speedBonus > 0 && (
                <div className="flex items-center justify-between py-2 border-t border-border/30">
                  <div className="flex items-center gap-2">
                    <Zap className="w-4 h-4 text-yellow-400" />
                    <span className="text-sm text-muted-foreground">Speed Bonus</span>
                  </div>
                  <span className="font-semibold text-yellow-400">+{result.speedBonus}</span>
                </div>
              )}
              {result.streakBonus > 0 && (
                <div className="flex items-center justify-between py-2 border-t border-border/30">
                  <div className="flex items-center gap-2">
                    <Flame className="w-4 h-4 text-orange-400" />
                    <span className="text-sm text-muted-foreground">Streak Bonus</span>
                  </div>
                  <span className="font-semibold text-orange-400">+{result.streakBonus}</span>
                </div>
              )}
              <div className="flex items-center justify-between py-2 border-t border-border/40">
                <span className="font-semibold text-foreground">Total Score</span>
                <span className="font-display font-bold text-xl text-primary">{result.newScore}</span>
              </div>
            </div>
          </div>

          {/* Correct Answer Reveal */}
          <div className="glass rounded-2xl p-5">
            <h3 className="font-display font-semibold mb-4 text-foreground flex items-center gap-2">
              <Music className="w-4 h-4 text-primary" /> The Answer
            </h3>
            <div className="space-y-3">
              <div>
                <p className="text-muted-foreground text-xs uppercase tracking-wide mb-1">Full Lyric</p>
                <p className="text-foreground font-medium">
                  "{result.song.lyricPrompt} <span className="text-primary">{result.correctLyric}</span>"
                </p>
              </div>
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <p className="text-muted-foreground text-xs uppercase tracking-wide mb-1">Artist</p>
                  <p className="text-foreground font-semibold">{result.correctArtist}</p>
                </div>
                <div>
                  <p className="text-muted-foreground text-xs uppercase tracking-wide mb-1">Release Year</p>
                  <p className="text-foreground font-semibold">{result.correctYear}</p>
                </div>
              </div>
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <p className="text-muted-foreground text-xs uppercase tracking-wide mb-1">Song Title</p>
                  <p className="text-foreground text-sm">{result.song.title}</p>
                </div>
                <div>
                  <p className="text-muted-foreground text-xs uppercase tracking-wide mb-1">Genre</p>
                  <Badge variant="secondary" className="text-xs">{result.song.genre}</Badge>
                </div>
              </div>
            </div>
          </div>

          {/* Artist Discovery Links — always shown */}
          <div className="glass rounded-2xl p-5">
            <h3 className="font-display font-semibold mb-1 text-foreground flex items-center gap-2">
              <ExternalLink className="w-4 h-4 text-accent" /> Check out {result.correctArtist}
            </h3>
            <p className="text-muted-foreground text-xs mb-3">Explore the artist and watch the official music video</p>
            {/* Music Video — featured link */}
            <a
              href={`https://www.youtube.com/results?search_query=${videoQ}`}
              target="_blank"
              rel="noopener noreferrer"
              className="flex items-center gap-3 w-full px-4 py-3 mb-3 rounded-xl bg-green-500/10 border border-green-500/30 hover:border-green-500/60 hover:bg-green-500/20 transition-all group"
            >
              <div className="w-8 h-8 rounded-full bg-green-500/20 flex items-center justify-center flex-shrink-0">
                <Play className="w-4 h-4 text-green-400" />
              </div>
              <div className="flex-1 min-w-0">
                <p className="text-sm font-semibold text-green-400">Watch Official Music Video</p>
                <p className="text-xs text-muted-foreground truncate">{result.correctArtist} — {result.song.title}</p>
              </div>
              <ExternalLink className="w-4 h-4 text-green-400/60 group-hover:text-green-400 transition-colors flex-shrink-0" />
            </a>
            {/* Social / streaming links */}
            <div className="flex flex-wrap gap-2">
              {artistLinks.slice(1).map(({ icon: Icon, label, url, color }) => (
                <a
                  key={label}
                  href={url!}
                  target="_blank"
                  rel="noopener noreferrer"
                  className={`flex items-center gap-1.5 px-3 py-1.5 rounded-full glass border border-border/40 text-sm hover:border-primary/40 transition-colors ${color}`}
                >
                  {Icon && <Icon className="w-3.5 h-3.5" />}
                  {label}
                  <ExternalLink className="w-2.5 h-2.5 opacity-60" />
                </a>
              ))}
            </div>
          </div>

          {/* Next Round Button */}
          <Button
            className="w-full bg-primary text-primary-foreground hover:bg-primary/90 glow-purple py-6 text-lg font-semibold rounded-xl"
            onClick={handleNext}
            disabled={isAdvancing}
          >
            {isAdvancing ? "Loading..." : isLastRound ? (
              <>See Final Results <Trophy className="w-5 h-5 ml-2" /></>
            ) : (
              <>Next Round <ChevronRight className="w-5 h-5 ml-2" /></>
            )}
          </Button>
        </motion.div>
      </div>
    </div>
  );
}

function ScoreRow({ label, correct, points, maxPoints, partial }: {
  label: string;
  correct: boolean;
  points: number;
  maxPoints: number;
  partial?: boolean;
}) {
  return (
    <div className="flex items-center justify-between py-2">
      <div className="flex items-center gap-3">
        <div className={`w-6 h-6 rounded-full flex items-center justify-center ${
          correct ? "bg-green-500/20" : "bg-red-500/20"
        }`}>
          {correct ? <Check className="w-3.5 h-3.5 text-green-400" /> : <X className="w-3.5 h-3.5 text-red-400" />}
        </div>
        <span className="text-sm text-muted-foreground">{label}</span>
        {partial && <Badge variant="secondary" className="text-xs">Partial</Badge>}
      </div>
      <div className="flex items-center gap-2">
        <span className={`font-semibold ${correct ? "text-green-400" : "text-muted-foreground"}`}>
          {points > 0 ? `+${points}` : "0"}
        </span>
        <span className="text-muted-foreground text-xs">/ {maxPoints}</span>
      </div>
    </div>
  );
}
