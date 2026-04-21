import { useState } from "react";
import { useLocation } from "wouter";
import { motion } from "framer-motion";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Badge } from "@/components/ui/badge";
import { useAuth } from "@/_core/hooks/useAuth";
import { getLoginUrl, getSignUpUrl } from "@/const";
import SocialShareButtons from "@/components/SocialShareButtons";
import { getHomepageShareContent } from "@/lib/shareUtils";
import {
  Music, Mic, Users, Trophy, Zap, Star, ChevronRight,
  Play, Radio, Clock, Target, ArrowRight, Crown, Flame
} from "lucide-react";

const GENRES = ["R&B", "Hip Hop", "Pop", "Rock", "Country", "Gospel", "Soul", "Jazz"];
const DECADES = ["80s", "90s", "2000s", "2010s", "2020s"];

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
    <div className="min-h-screen text-foreground overflow-x-hidden">
      {/* ── Navigation ── */}
      <nav className="fixed top-0 left-0 right-0 z-50 glass border-b border-border/50">
        <div className="container flex items-center justify-between h-16">
          <div className="flex items-center gap-2">
            <div className="w-8 h-8 rounded-lg bg-primary/20 flex items-center justify-center glow-purple">
              <Music className="w-4 h-4 text-primary" />
            </div>
            <span className="font-display font-bold text-lg text-gradient">LyricPro Ai</span>
          </div>
          <div className="flex items-center gap-3">
            {/* Social sharing icons */}
            <div className="hidden md:flex items-center gap-1">
              <SocialShareButtons content={getHomepageShareContent()} compact showNativeShare={false} />
            </div>
            <Button variant="ghost" size="sm" onClick={() => navigate("/leaderboards")}
              className="text-muted-foreground hover:text-foreground hidden sm:flex">
              <Trophy className="w-4 h-4 mr-1" /> Leaderboards
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
                  className="bg-primary text-primary-foreground hover:bg-primary/90">
                  Play Free
                </Button>
              </div>
            )}
          </div>
        </div>
      </nav>

      {/* ── Hero ── */}
      <section className="relative pt-32 pb-20 px-4 overflow-hidden">
        {/* Background orbs */}
        <div className="absolute top-20 left-1/4 w-96 h-96 rounded-full bg-primary/10 blur-3xl pointer-events-none" />
        <div className="absolute top-40 right-1/4 w-80 h-80 rounded-full bg-accent/10 blur-3xl pointer-events-none" />

        <div className="container relative">
          <motion.div
            className="text-center max-w-4xl mx-auto"
            initial="hidden"
            animate="visible"
            variants={{ visible: { transition: { staggerChildren: 0.15 } } }}
          >
            <motion.div variants={fadeUp} className="mb-4">
              <Badge className="bg-primary/20 text-primary border-primary/30 px-4 py-1 text-sm font-medium">
                <Zap className="w-3 h-3 mr-1" /> AI-Powered Music Trivia
              </Badge>
            </motion.div>

            <motion.h1 variants={fadeUp}
              className="font-display text-5xl sm:text-6xl md:text-7xl font-black leading-tight mb-6">
              <span className="text-gradient">Finish the Lyric.</span>
              <br />
              <span className="text-foreground">Rule the Room.</span>
            </motion.h1>

            <motion.p variants={fadeUp}
              className="text-muted-foreground text-lg sm:text-xl max-w-2xl mx-auto mb-8 leading-relaxed">
              The premium social lyric challenge game. Complete song lyrics, name the artist, guess the year.
              Play solo or battle your friends across every genre and decade.
            </motion.p>

            <motion.div variants={fadeUp} className="flex flex-col sm:flex-row gap-4 justify-center items-center">
              <Button size="lg" onClick={handlePlayNow}
                className="bg-primary text-primary-foreground hover:bg-primary/90 glow-purple px-8 py-6 text-lg font-semibold rounded-xl w-full sm:w-auto">
                <Play className="w-5 h-5 mr-2" /> Play Now — Free to try
              </Button>
              <Button size="lg" variant="outline" onClick={handleHostGame}
                className="border-border/60 hover:border-primary/50 hover:bg-primary/5 px-8 py-6 text-lg font-semibold rounded-xl w-full sm:w-auto">
                <Users className="w-5 h-5 mr-2" /> Host a Game
              </Button>
            </motion.div>

            {/* Social share buttons moved to top nav */}

            {/* Genre pills */}
            <motion.div variants={fadeUp} className="mt-10 flex flex-wrap gap-2 justify-center">
              {GENRES.map((g) => (
                <span key={g}
                  className="px-3 py-1 rounded-full text-sm glass text-muted-foreground border-border/40">
                  {g}
                </span>
              ))}
              <span className="px-3 py-1 rounded-full text-sm glass text-muted-foreground border-border/40">
                + More
              </span>
            </motion.div>
          </motion.div>
        </div>
      </section>

      {/* ── Stats bar ── */}
      <section className="py-8 border-y border-border/30">
        <div className="container">
          <div className="grid grid-cols-2 md:grid-cols-4 gap-6 text-center">
            {[
              { icon: Music, label: "Song Catalog", value: "1,038" },
              { icon: Users, label: "Game Modes", value: "4" },
              { icon: Radio, label: "Genres", value: "9" },
              { icon: Clock, label: "Decades Covered", value: "7" },
            ].map(({ icon: Icon, label, value }) => (
              <div key={label} className="flex flex-col items-center gap-1">
                <Icon className="w-5 h-5 text-primary mb-1" />
                <span className="font-display font-bold text-2xl text-foreground">{value}</span>
                <span className="text-muted-foreground text-sm">{label}</span>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ── How It Works ── */}
      <section className="py-20 px-4">
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
                title: "Complete the Lyric",
                desc: "On Low/Medium: see the full lyric and name the song, artist, and year. On High: complete the missing lyric plus name the artist and year.",
                color: "text-accent",
                glow: "glow-cyan",
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

      {/* ── Scoring breakdown ── */}
      <section className="py-16 px-4">
        <div className="container">
          <div className="glass rounded-3xl p-8 md:p-12 max-w-4xl mx-auto">
            <h2 className="font-display text-3xl font-bold text-center mb-3">
              <span className="text-gradient">Point System</span>
            </h2>
            <p className="text-muted-foreground text-center text-sm mb-10">Points scale with difficulty. Low & Medium show the full lyric — name the song, artist, and year.</p>

            {/* Difficulty table */}
            <div className="space-y-4">
              {[
                { diff: "Low", color: "text-green-400", bg: "bg-green-500/10", border: "border-green-500/30", lyric: null, title: 25, artist: 25, year: 50, total: 100 },
                { diff: "Medium", color: "text-yellow-400", bg: "bg-yellow-500/10", border: "border-yellow-500/30", lyric: null, title: 50, artist: 50, year: 100, total: 200 },
                { diff: "High", color: "text-red-400", bg: "bg-red-500/10", border: "border-red-500/30", lyric: 50, title: 100, artist: 100, year: 200, total: 450 },
              ].map(({ diff, color, bg, border, lyric, title, artist, year, total }) => (
                <div key={diff} className={`rounded-2xl p-5 border ${border} ${bg}`}>
                  <div className="flex items-center justify-between mb-3">
                    <span className={`font-display font-bold text-lg ${color}`}>{diff}</span>
                    <span className="text-muted-foreground text-xs">Max {total} pts/round</span>
                  </div>
                  <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                    {lyric !== null && (
                      <div className="text-center p-3 rounded-xl bg-card/40">
                        <Mic className="w-4 h-4 text-primary mx-auto mb-1" />
                        <div className="font-bold text-foreground">{lyric} pts</div>
                        <div className="text-muted-foreground text-xs">Lyric</div>
                      </div>
                    )}
                    <div className="text-center p-3 rounded-xl bg-card/40">
                      <Music className="w-4 h-4 text-accent mx-auto mb-1" />
                      <div className="font-bold text-foreground">{title} pts</div>
                      <div className="text-muted-foreground text-xs">Title</div>
                    </div>
                    <div className="text-center p-3 rounded-xl bg-card/40">
                      <Star className="w-4 h-4 text-primary mx-auto mb-1" />
                      <div className="font-bold text-foreground">{artist} pts</div>
                      <div className="text-muted-foreground text-xs">Artist</div>
                    </div>
                    <div className="text-center p-3 rounded-xl bg-card/40">
                      <Crown className="w-4 h-4 text-yellow-400 mx-auto mb-1" />
                      <div className="font-bold text-foreground">{year} pts</div>
                      <div className="text-muted-foreground text-xs">Year</div>
                    </div>
                  </div>
                </div>
              ))}
            </div>

            <div className="mt-6 grid sm:grid-cols-2 gap-4 text-sm text-muted-foreground">
              <div className="flex items-center gap-2 p-3 rounded-xl bg-card/30">
                <Flame className="w-4 h-4 text-orange-400 shrink-0" />
                <span>Within ±2 years = <strong className="text-foreground">50% of year pts</strong></span>
              </div>
              <div className="flex items-center gap-2 p-3 rounded-xl bg-card/30">
                <Zap className="w-4 h-4 text-yellow-400 shrink-0" />
                <span>Within ±3 years = <strong className="text-foreground">20% of year pts</strong></span>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* ── Game Modes ── */}
      <section className="py-16 px-4">
        <div className="container">
          <h2 className="font-display text-4xl font-bold text-center mb-12">
            Play Your <span className="text-gradient">Way</span>
          </h2>
          <div className="grid sm:grid-cols-2 lg:grid-cols-4 gap-4">
            {[
              { icon: "🎯", title: "Solo Mode", desc: "Challenge yourself. Beat your personal best.", badge: "Any time" },
              { icon: "🔄", title: "Turn-Based", desc: "Pass the device. Take turns. Battle it out.", badge: "1 device" },
              { icon: "👥", title: "Team Mode", desc: "Form teams. Collaborate. Crush the competition.", badge: "Group play" },
              { icon: "📱", title: "Remote Live", desc: "Join from anywhere. Play over FaceTime or Zoom.", badge: "Any device" },
            ].map(({ icon, title, desc, badge }) => (
              <motion.div
                key={title}
                initial={{ opacity: 0, scale: 0.95 }}
                whileInView={{ opacity: 1, scale: 1 }}
                viewport={{ once: true }}
                className="glass rounded-2xl p-6 text-center hover:border-primary/30 transition-all duration-300 cursor-pointer group"
                onClick={handlePlayNow}
              >
                <div className="text-4xl mb-3">{icon}</div>
                <Badge variant="secondary" className="mb-3 text-xs">{badge}</Badge>
                <h3 className="font-display font-bold text-lg mb-2 text-foreground">{title}</h3>
                <p className="text-muted-foreground text-sm">{desc}</p>
                <ChevronRight className="w-4 h-4 text-primary mx-auto mt-3 group-hover:translate-x-1 transition-transform" />
              </motion.div>
            ))}
          </div>
        </div>
      </section>

      {/* ── CTA ── */}
      <section className="py-20 px-4">
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
      <footer className="border-t border-border/30 py-8 px-4">
        <div className="container flex flex-col sm:flex-row items-center justify-between gap-4">
          <div className="flex items-center gap-2">
            <Music className="w-4 h-4 text-primary" />
            <span className="font-display font-bold text-gradient">LyricPro Ai</span>
          </div>
          <p className="text-muted-foreground text-sm">
            Finish the lyric. Name the artist. Guess the year. Rule the room.
          </p>
          <div className="flex gap-4 text-sm text-muted-foreground">
            <button onClick={() => navigate("/leaderboards")} className="hover:text-foreground transition-colors">Leaderboards</button>
            {isAuthenticated && (
              <button onClick={() => navigate("/profile")} className="hover:text-foreground transition-colors">Profile</button>
            )}
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
