import { useState } from "react";
import { useLocation } from "wouter";
import { motion } from "framer-motion";
import { trpc } from "@/lib/trpc";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { useAuth } from "@/_core/hooks/useAuth";
import { getLoginUrl, getSignUpUrl } from "@/const";
import SocialShareButtons from "@/components/SocialShareButtons";
import { getHomepageShareContent } from "@/lib/shareUtils";
import { WeaknessPackCard } from "@/components/WeaknessPackCard";
import { SuggestionCard } from "@/components/SuggestionCard";
import { HeroBanner } from "@/components/HeroBanner";
import {
  Music, Mic, Users, Trophy, Zap, ChevronRight,
  Play, Radio, Clock, Target, ArrowRight, ShoppingCart,
} from "lucide-react";

export default function Home() {
  const [, navigate] = useLocation();
  const { user, isAuthenticated } = useAuth();
  const [authOpen, setAuthOpen] = useState(false);

  const handlePlayNow = () => {
    if (isAuthenticated) {
      navigate("/setup");
    } else {
      setAuthOpen(true);
    }
  };

  const handleHostGame = () => {
    if (isAuthenticated) {
      navigate("/setup?mode=multiplayer");
    } else {
      setAuthOpen(true);
    }
  };

  const fadeUp = {
    hidden: { opacity: 0, y: 30 },
    visible: { opacity: 1, y: 0 },
  };

  return (
    <div className="min-h-screen text-foreground overflow-x-hidden relative">
      {/* ── Ambient Orbs (fixed behind content) ── */}
      <div className="fixed inset-0 pointer-events-none overflow-hidden z-0">
        <div
          className="ambient-orb ambient-orb-purple w-80 h-56"
          style={{ top: "-60px", left: "50%", transform: "translateX(-50%)" }}
        />
        <div
          className="ambient-orb ambient-orb-red w-60 h-60"
          style={{ top: "200px", right: "-60px" }}
        />
        <div
          className="ambient-orb ambient-orb-amber w-48 h-48"
          style={{ bottom: "100px", left: "-40px" }}
        />
      </div>

      {/* ── Navigation ── */}
      <nav className="fixed top-0 left-0 right-0 z-50 glass border-b border-border/50">
        <div className="container flex items-center justify-between h-16">
          <div className="flex items-center gap-2">
            <span
              className="font-display font-bold text-xl"
              style={{
                background: "linear-gradient(90deg, #8B5CF6, #F59E0B)",
                WebkitBackgroundClip: "text",
                WebkitTextFillColor: "transparent",
                backgroundClip: "text",
              }}
            >
              LyricPro
            </span>
          </div>
          <div className="flex items-center gap-3">
            {/* Social sharing icons */}
            <div className="hidden md:flex items-center gap-1">
              <SocialShareButtons content={getHomepageShareContent()} compact showNativeShare={false} />
            </div>
            <Button variant="ghost" size="sm" onClick={() => navigate("/events")}
              className="text-muted-foreground hover:text-foreground hidden sm:flex">
              Events
            </Button>
            <Button variant="ghost" size="sm" onClick={() => navigate("/leaderboards")}
              className="text-muted-foreground hover:text-foreground hidden sm:flex">
              <Trophy className="w-4 h-4 mr-1" /> Leaderboards
            </Button>
            <Button variant="ghost" size="sm" onClick={() => navigate("/shop")}
              className="text-muted-foreground hover:text-foreground"
              title="Shop">
              <ShoppingCart className="w-4 h-4 sm:mr-1" />
              <span className="hidden sm:inline">Shop</span>
            </Button>
            {isAuthenticated ? (
              <div className="flex items-center gap-2">
                <Button variant="ghost" size="sm" onClick={() => navigate("/profile")}
                  className="text-muted-foreground hover:text-foreground">
                  {user?.firstName || user?.name?.split(" ")[0] || "Profile"}
                </Button>
                <Button size="sm" onClick={() => navigate("/setup")}
                  className="bg-primary text-primary-foreground hover:bg-primary/90 glow-purple">
                  Play Now
                </Button>
              </div>
            ) : (
              <div className="flex items-center gap-2">
                <Button variant="ghost" size="sm" asChild
                  className="text-muted-foreground hover:text-foreground">
                  <a href={getLoginUrl()}>Sign In</a>
                </Button>
                <Button variant="outline" size="sm" asChild
                  className="border-primary/50 text-primary hover:bg-primary/10 hidden sm:flex">
                  <a href={getSignUpUrl()}>Sign Up</a>
                </Button>
                <Button size="sm" onClick={handlePlayNow}
                  className="bg-primary text-primary-foreground hover:bg-primary/90 glow-purple">
                  Play Now
                </Button>
              </div>
            )}
          </div>
        </div>
      </nav>

      {/* ── Hero Headline ── */}
      <section className="relative pt-32 pb-8 px-4 z-10">
        <div className="container relative">
          <motion.div
            className="text-center max-w-3xl mx-auto"
            initial="hidden"
            animate="visible"
            variants={{ visible: { transition: { staggerChildren: 0.15 } } }}
          >
            <motion.h1
              variants={fadeUp}
              className="font-display text-4xl sm:text-5xl font-black leading-tight mb-4"
            >
              Finish the Lyric.
              <br />
              <span className="text-gradient">Win the Night.</span>
            </motion.h1>

            <motion.p
              variants={fadeUp}
              className="text-muted-foreground text-base sm:text-lg max-w-xl mx-auto mb-8"
            >
              <StatsLine /> across every genre and decade.
            </motion.p>

            <motion.div variants={fadeUp} className="flex flex-col sm:flex-row gap-4 justify-center items-center">
              <Button size="lg" onClick={handlePlayNow}
                className="bg-primary text-primary-foreground hover:bg-primary/90 glow-purple px-8 py-6 text-lg font-semibold rounded-xl w-full sm:w-auto">
                <Play className="w-5 h-5 mr-2" /> Play Now
              </Button>
              <Button size="lg" variant="outline" onClick={handleHostGame}
                className="border-border/60 hover:border-primary/50 hover:bg-primary/5 px-8 py-6 text-lg font-semibold rounded-xl w-full sm:w-auto">
                <Users className="w-5 h-5 mr-2" /> Host a Game
              </Button>
            </motion.div>
          </motion.div>
        </div>
      </section>

      {/* ── Hero Banner ── */}
      <section className="py-4 px-4 z-10 relative">
        <div className="container max-w-2xl">
          <HeroBanner />
        </div>
      </section>

      {/* ── Mode Cards ── */}
      <section className="py-8 px-4 z-10 relative">
        <div className="container max-w-2xl">
          <div className="grid grid-cols-2 gap-4">
            {/* Solo Mode */}
            <motion.div
              initial={{ opacity: 0, y: 16 }}
              whileInView={{ opacity: 1, y: 0 }}
              viewport={{ once: true }}
              className="relative overflow-hidden rounded-2xl p-6 border border-primary/15 bg-primary/[0.04] cursor-pointer group hover:border-primary/30 transition-all duration-300"
              onClick={handlePlayNow}
            >
              <div className="ambient-orb ambient-orb-purple w-24 h-24" style={{ top: "-12px", right: "-12px" }} />
              <div className="relative">
                <div className="w-10 h-10 rounded-xl bg-primary/10 flex items-center justify-center mb-3 glow-purple">
                  <Target className="w-5 h-5 text-primary" />
                </div>
                <h3 className="font-display font-bold text-lg text-foreground mb-1">Solo</h3>
                <p className="text-xs text-muted-foreground leading-relaxed">
                  Challenge yourself. Beat your personal best.
                </p>
                <ChevronRight className="w-4 h-4 text-primary mt-3 group-hover:translate-x-1 transition-transform" />
              </div>
            </motion.div>

            {/* Challenge Mode */}
            <motion.div
              initial={{ opacity: 0, y: 16 }}
              whileInView={{ opacity: 1, y: 0 }}
              viewport={{ once: true }}
              transition={{ delay: 0.05 }}
              className="relative overflow-hidden rounded-2xl p-6 border border-amber-500/15 bg-amber-500/[0.04] cursor-pointer group hover:border-amber-500/30 transition-all duration-300"
              onClick={handleHostGame}
            >
              <div className="ambient-orb ambient-orb-amber w-24 h-24" style={{ top: "-12px", right: "-12px" }} />
              <div className="relative">
                <div className="w-10 h-10 rounded-xl bg-amber-500/10 flex items-center justify-center mb-3 glow-amber">
                  <Users className="w-5 h-5 text-amber-400" />
                </div>
                <h3 className="font-display font-bold text-lg text-foreground mb-1">Challenge</h3>
                <p className="text-xs text-muted-foreground leading-relaxed">
                  Battle friends. Host a multiplayer game.
                </p>
                <ChevronRight className="w-4 h-4 text-amber-400 mt-3 group-hover:translate-x-1 transition-transform" />
              </div>
            </motion.div>
          </div>
        </div>
      </section>

      {/* ── AI Suggestions + Weakness Pack (authenticated users only) ── */}
      {isAuthenticated && (
        <section className="py-4 px-4 z-10 relative">
          <div className="container max-w-2xl space-y-4">
            <SuggestionCard />
            <WeaknessPackCard />
          </div>
        </section>
      )}

      {/* ── Stats Strip ── */}
      <StatsStrip />

      {/* ── How It Works ── */}
      <section className="py-20 px-4 z-10 relative">
        <div className="container">
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            whileInView={{ opacity: 1, y: 0 }}
            viewport={{ once: true }}
            className="text-center mb-14"
          >
            <h2 className="font-display text-4xl font-bold mb-4">
              How It <span className="text-gradient">Works</span>
            </h2>
            <p className="text-muted-foreground text-lg max-w-xl mx-auto">
              Customize your game and start playing!
            </p>
          </motion.div>

          <div className="grid md:grid-cols-3 gap-6">
            {[
              {
                step: "01",
                icon: Target,
                title: "Set Up Your Game",
                desc: "Choose your genre, decade, difficulty, timer, and how many rounds. Solo, multiplayer, or team mode.",
                color: "text-primary",
                glow: "glow-purple",
              },
              {
                step: "02",
                icon: Mic,
                title: "Read the Lyric",
                desc: "On Low/Medium: see the full lyric and name the song, artist, and year. On High: complete the missing lyric plus name the artist and year.",
                color: "text-accent",
                glow: "glow-amber",
              },
              {
                step: "03",
                icon: Trophy,
                title: "Score & Compete",
                desc: "Points scale with difficulty: Low (100 max), Medium (200 max), High (450 max). Streak bonuses multiply your score. See who rules the room.",
                color: "text-yellow-400",
                glow: "glow-gold",
              },
            ].map(({ step, icon: Icon, title, desc, color, glow }) => (
              <motion.div
                key={step}
                initial={{ opacity: 0, y: 20 }}
                whileInView={{ opacity: 1, y: 0 }}
                viewport={{ once: true }}
                transition={{ delay: parseInt(step) * 0.1 }}
                className="glass rounded-2xl p-8 relative overflow-hidden group hover:border-primary/30 transition-all duration-300"
              >
                <div className="absolute top-4 right-4 font-display text-5xl font-black text-foreground/40">
                  {step}
                </div>
                <div className={`w-12 h-12 rounded-xl bg-card flex items-center justify-center mb-4 ${glow}`}>
                  <Icon className={`w-6 h-6 ${color}`} />
                </div>
                <h3 className="font-display font-bold text-xl mb-3 text-foreground">{title}</h3>
                <p className="text-muted-foreground leading-relaxed">{desc}</p>
              </motion.div>
            ))}
          </div>
        </div>
      </section>

      {/* ── CTA ── */}
      <section className="py-20 px-4 z-10 relative">
        <div className="container">
          <div className="relative glass rounded-3xl p-10 md:p-16 text-center overflow-hidden max-w-3xl mx-auto">
            <div className="absolute inset-0 bg-gradient-to-br from-primary/10 to-accent/5 pointer-events-none rounded-3xl" />
            <div className="relative">
              <h2 className="font-display text-4xl md:text-5xl font-black mb-4">
                Ready to <span className="text-gradient">Rule the Room?</span>
              </h2>
              <p className="text-muted-foreground text-lg mb-8 max-w-xl mx-auto">
                Join thousands of music lovers testing their knowledge. Free to play. No download required.
              </p>
              <div className="flex flex-col sm:flex-row gap-4 justify-center">
                <Button size="lg" onClick={handlePlayNow}
                  className="bg-primary text-primary-foreground hover:bg-primary/90 glow-purple px-10 py-6 text-lg font-semibold rounded-xl">
                  <Play className="w-5 h-5 mr-2" /> Start Playing Free
                </Button>
                {!isAuthenticated && (
                  <Button size="lg" variant="outline" asChild
                    className="border-border/60 hover:border-primary/50 px-10 py-6 text-lg rounded-xl">
                    <a href={getLoginUrl()}>
                      Create Account <ArrowRight className="w-4 h-4 ml-2" />
                    </a>
                  </Button>
                )}
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* ── Footer ── */}
      <footer className="border-t border-border/30 py-8 px-4 z-10 relative">
        <div className="container flex flex-col sm:flex-row items-center justify-between gap-4">
          <div className="flex items-center gap-2">
            <Music className="w-4 h-4 text-primary" />
            <span className="font-display font-bold text-gradient">LyricPro</span>
          </div>
          <p className="text-muted-foreground text-sm">
            Finish the lyric. Name the artist. Guess the year. Rule the room.
          </p>
          <div className="flex flex-wrap gap-4 text-sm text-muted-foreground">
            <button onClick={() => navigate("/leaderboards")} className="hover:text-foreground transition-colors">Leaderboards</button>
            {isAuthenticated && (
              <button onClick={() => navigate("/profile")} className="hover:text-foreground transition-colors">Profile</button>
            )}
            <a href="/privacy" className="hover:text-foreground transition-colors">Privacy</a>
            <a href="/termsofservice" className="hover:text-foreground transition-colors">Terms</a>
          </div>
        </div>
      </footer>

      {/* ── Auth Gate Dialog ── */}
      <Dialog open={authOpen} onOpenChange={setAuthOpen}>
        <DialogContent className="glass-strong border-border/50 max-w-md">
          <DialogHeader>
            <DialogTitle className="font-display text-2xl text-center">
              <span className="text-gradient">Ready to Play?</span>
            </DialogTitle>
          </DialogHeader>
          <div className="space-y-4 pt-2">
            <p className="text-sm text-muted-foreground text-center">
              Sign in or create a free account to save scores, climb leaderboards, and track your stats.
            </p>
            <div className="grid grid-cols-2 gap-3">
              <a href={getLoginUrl()} className="block">
                <Button variant="outline" className="w-full border-primary/50 text-primary hover:bg-primary/10 py-5 text-base font-semibold">
                  Sign In
                </Button>
              </a>
              <a href={getSignUpUrl()} className="block">
                <Button className="w-full bg-primary text-primary-foreground hover:bg-primary/90 glow-purple py-5 text-base font-semibold">
                  Sign Up Free
                </Button>
              </a>
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}

// Inline stats for the hero subtitle line
function StatsLine() {
  const { data } = trpc.system.libraryStats.useQuery(undefined, {
    refetchOnWindowFocus: false,
    staleTime: 5 * 60_000,
  });
  const songCount = (data?.totalSongs ?? 0).toLocaleString();
  return (
    <>
      <span className="text-primary font-semibold">{songCount || "800+"} songs</span>
      {" "}
    </>
  );
}

// Stats strip between sections
function StatsStrip() {
  const { data } = trpc.system.libraryStats.useQuery(undefined, {
    refetchOnWindowFocus: false,
    staleTime: 5 * 60_000,
  });
  const songCount = (data?.totalSongs ?? 0).toLocaleString();

  return (
    <section className="py-6 border-t border-b border-border/30 z-10 relative">
      <div className="container">
        <div className="flex justify-around items-center">
          <div className="text-center">
            <span className="font-display font-bold text-2xl text-primary">{songCount || "834"}</span>
            <span className="block text-xs text-muted-foreground mt-0.5">Songs</span>
          </div>
          <div className="text-center">
            <span className="font-display font-bold text-2xl text-amber-400">7</span>
            <span className="block text-xs text-muted-foreground mt-0.5">Decades</span>
          </div>
          <div className="text-center">
            <span className="font-display font-bold text-2xl text-foreground">9</span>
            <span className="block text-xs text-muted-foreground mt-0.5">Genres</span>
          </div>
          <div className="text-center">
            <span className="font-display font-bold text-2xl text-foreground">4</span>
            <span className="block text-xs text-muted-foreground mt-0.5">Modes</span>
          </div>
        </div>
      </div>
    </section>
  );
}
