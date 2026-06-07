import { useState } from "react";
import { useLocation } from "wouter";
import { motion } from "framer-motion";
import { trpc } from "@/lib/trpc";
import { useAuth } from "@/_core/hooks/useAuth";
import { NoteBackground3D } from "@/components/NoteBackground3D";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Checkbox } from "@/components/ui/checkbox";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { getLoginUrl } from "@/const";
import { Music, Play, LayoutDashboard, ChevronDown, Trophy, ShoppingCart } from "lucide-react";
import { toast } from "sonner";

const GENRES = ["Country", "Hip Hop", "R&B", "Pop", "Rock", "Gospel", "Soul", "Jazz", "Blues", "Alternative", "Reggae", "Mixed"];
const DECADES = ["1940–1950", "1950–1960", "1960–1970", "1970–1980", "1980–1990", "1990–2000", "2000–2010", "2010–2020", "2020–Present"];
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export default function Interstitial() {
  const [, navigate] = useLocation();
  const { isAuthenticated } = useAuth();

  const [email, setEmail] = useState("");
  const [genre, setGenre] = useState<string>("");
  const [decades, setDecades] = useState<string[]>([]);
  const [isStarting, setIsStarting] = useState(false);

  const createGuestSession = trpc.game.createGuestSession.useMutation();
  const createRoom = trpc.game.createRoom.useMutation();

  const emailOk = isAuthenticated || EMAIL_RE.test(email);
  const canStart = emailOk && !!genre && decades.length > 0 && !isStarting;

  const toggleDecade = (d: string) =>
    setDecades((prev) => (prev.includes(d) ? prev.filter((x) => x !== d) : [...prev, d]));

  const handleStart = async () => {
    if (!canStart) return;
    setIsStarting(true);
    try {
      let guestToken: string | undefined;
      if (!isAuthenticated) {
        const guest = await createGuestSession.mutateAsync({ email });
        guestToken = guest.token;
        localStorage.setItem("lyricpro_guest_token", guest.token);
        localStorage.setItem("lyricpro_guest_email", email);
      }
      const room = await createRoom.mutateAsync({
        mode: "solo",
        genres: [genre],
        decades,
        difficulty: "low",
        timerSeconds: 90,
        rounds: 3,
        explicitFilter: false,
        ...(guestToken ? { guestToken } : {}),
      });
      navigate(`/play/${room.roomCode}`);
    } catch (err: any) {
      toast.error(err?.message || "Could not start the game. Try again.");
      setIsStarting(false);
    }
  };

  return (
    <div className="relative min-h-screen text-foreground overflow-hidden">
      <NoteBackground3D />

      {/* Own nav, fixed + z-50 so it COVERS the global PersistentHeader (same pattern the old Home used). */}
      <nav className="fixed top-0 left-0 right-0 z-50 glass border-b border-border/50">
        <div className="container flex items-center justify-between h-16">
          <div className="flex items-center gap-2">
            <div className="w-8 h-8 rounded-lg bg-primary/20 flex items-center justify-center glow-purple">
              <Music className="w-4 h-4 text-primary" />
            </div>
            <span className="font-display font-bold text-lg text-gradient">LyricPro Ai</span>
          </div>
          <div className="flex items-center gap-3 text-sm">
            <button onClick={() => navigate("/leaderboards")} className="text-muted-foreground hover:text-foreground hidden sm:flex items-center gap-1">
              <Trophy className="w-4 h-4" /> Leaderboards
            </button>
            <button onClick={() => navigate("/shop")} className="text-muted-foreground hover:text-foreground flex items-center gap-1">
              <ShoppingCart className="w-4 h-4" /> <span className="hidden sm:inline">Shop</span>
            </button>
            {!isAuthenticated && (
              <a href={getLoginUrl()} className="text-muted-foreground hover:text-foreground">Sign In</a>
            )}
          </div>
        </div>
      </nav>

      <div className="relative z-10 container flex min-h-[calc(100vh-4rem)] items-center">
        <motion.div
          initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }}
          className="grid w-full gap-6 md:grid-cols-[1.6fr_1fr] max-w-5xl mx-auto"
        >
          {/* PLAY NOW (primary) */}
          <div className="glass-strong rounded-2xl p-6 sm:p-8 border border-primary/20">
            <h2 className="font-display text-2xl font-bold mb-1 flex items-center gap-2">
              <Play className="w-5 h-5 text-primary" /> Play Now
            </h2>
            <p className="text-muted-foreground text-sm mb-5">
              {isAuthenticated ? "Pick a genre and decade — straight into the game." : "No sign-up needed. Drop your email, pick a vibe, and play."}
            </p>

            <div className="space-y-4">
              {!isAuthenticated && (
                <div>
                  <label htmlFor="play-email" className="text-xs uppercase tracking-wide text-muted-foreground">Email</label>
                  <Input
                    id="play-email"
                    data-testid="email-input"
                    type="email"
                    inputMode="email"
                    placeholder="your@email.com"
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    className="mt-1"
                  />
                </div>
              )}

              <div className="grid sm:grid-cols-2 gap-4">
                <div>
                  <label htmlFor="play-genre" className="text-xs uppercase tracking-wide text-muted-foreground">Genre</label>
                  <select
                    id="play-genre"
                    data-testid="genre-trigger"
                    value={genre}
                    onChange={(e) => setGenre(e.target.value)}
                    className="mt-1 w-full glass rounded-md border border-border/40 px-3 py-2 text-sm text-foreground"
                  >
                    <option value="" disabled>Choose a genre</option>
                    {GENRES.map((g) => <option key={g} value={g} data-testid={`genre-opt-${g}`}>{g}</option>)}
                  </select>
                </div>

                <div>
                  <span className="text-xs uppercase tracking-wide text-muted-foreground">Decade(s)</span>
                  <Popover>
                    <PopoverTrigger asChild>
                      <Button data-testid="decade-trigger" variant="outline" className="mt-1 w-full justify-between font-normal">
                        <span className="truncate">
                          {decades.length === 0 ? "Choose decade(s)" : `${decades.length} selected`}
                        </span>
                        <ChevronDown className="w-4 h-4 opacity-60" />
                      </Button>
                    </PopoverTrigger>
                    <PopoverContent className="w-56 p-2">
                      <div className="max-h-64 overflow-auto space-y-1">
                        {DECADES.map((d) => (
                          <label key={d} className="flex items-center gap-2 rounded-md px-2 py-1.5 hover:bg-white/5 cursor-pointer">
                            <Checkbox
                              data-testid={`decade-opt-${d}`}
                              checked={decades.includes(d)}
                              onCheckedChange={() => toggleDecade(d)}
                            />
                            <span className="text-sm">{d}</span>
                          </label>
                        ))}
                      </div>
                    </PopoverContent>
                  </Popover>
                </div>
              </div>

              <Button
                data-testid="play-start"
                disabled={!canStart}
                onClick={handleStart}
                className="w-full bg-primary text-primary-foreground hover:bg-primary/90 glow-purple py-6 text-lg font-semibold rounded-xl"
              >
                {isStarting ? "Starting…" : (<><Play className="w-5 h-5 mr-2" /> Start playing</>)}
              </Button>
            </div>
          </div>

          {/* MY DASHBOARD (secondary) */}
          <div className="glass rounded-2xl p-6 sm:p-8 border border-border/40 flex flex-col">
            <h2 className="font-display text-xl font-bold mb-1 flex items-center gap-2">
              <LayoutDashboard className="w-5 h-5 text-accent" /> MyDashboard
            </h2>
            <p className="text-muted-foreground text-sm mb-6">
              Already have an account? Jump to your stats, progress, and leaderboards.
            </p>
            <div className="flex-1" />
            <Button
              data-testid="mydashboard-btn"
              variant="outline"
              onClick={() => navigate("/welcome")}
              className="w-full border-border/60 hover:border-primary/50 py-5 rounded-xl"
            >
              Go to Dashboard →
            </Button>
          </div>
        </motion.div>
      </div>
    </div>
  );
}
