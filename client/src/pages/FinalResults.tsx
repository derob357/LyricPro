import { useEffect } from "react";
import { useLocation, useParams } from "wouter";
import { motion } from "framer-motion";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { trpc } from "@/lib/trpc";
import { useAuth } from "@/_core/hooks/useAuth";
import { getLoginUrl } from "@/const";
import SocialShareButtons from "@/components/SocialShareButtons";
import { getScoreShareContent } from "@/lib/shareUtils";
import { Trophy, Crown, Medal, Star, RotateCcw, Home, User, Music, Share2 } from "lucide-react";
import { getRankTier } from "@/lib/scoring";
import { useState } from "react";

export default function FinalResults() {
  const { roomCode } = useParams<{ roomCode: string }>();
  const [, navigate] = useLocation();
  const { user, isAuthenticated } = useAuth();
  const guestToken = localStorage.getItem("lyricpro_guest_token");

  const { data: results, isLoading } = trpc.game.getFinalResults.useQuery(
    { roomCode: roomCode ?? "" },
    { enabled: !!roomCode }
  );

  const handleRematch = () => {
    navigate("/setup");
  };

  const handleShare = () => {
    const winner = results?.players?.[0];
    const text = winner
      ? `I just played LyricPro Ai! ${winner.guestName || "Someone"} won with ${winner.currentScore} points! 🎵 Can you beat that?`
      : "I just played LyricPro Ai! 🎵";
    if (navigator.share) {
      navigator.share({ title: "LyricPro Ai Results", text, url: window.location.origin });
    } else {
      navigator.clipboard.writeText(text);
    }
  };

  if (isLoading || !results) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <div className="text-center">
          <div className="w-12 h-12 rounded-full border-2 border-primary border-t-transparent animate-spin mx-auto mb-4" />
          <p className="text-muted-foreground">Loading final results...</p>
        </div>
      </div>
    );
  }

  const { players, room } = results;
  const winner = players[0];
  const isMyWin = winner && (
    (isAuthenticated && user && winner.userId === user.id) ||
    (guestToken && winner.guestToken === guestToken)
  );

  const myPlayer = players.find(p =>
    (isAuthenticated && user && p.userId === user.id) ||
    (guestToken && p.guestToken === guestToken)
  );

  const rankTier = myPlayer ? getRankTier(myPlayer.currentScore) : null;

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
        <div className="container flex items-center justify-between h-14">
          <button onClick={() => navigate("/")} className="flex items-center gap-2 text-muted-foreground hover:text-foreground transition-colors">
            <Home className="w-4 h-4" />
            <span className="text-sm">Home</span>
          </button>
          <div className="flex items-center gap-2">
            <Music className="w-4 h-4 text-primary" />
            <span className="font-display font-bold text-sm text-gradient">LyricPro Ai</span>
          </div>
          <button onClick={handleShare} className="flex items-center gap-2 text-muted-foreground hover:text-foreground transition-colors">
            <Share2 className="w-4 h-4" />
            <span className="text-sm">Share</span>
          </button>
        </div>
      </div>

      <div className="container py-6 max-w-2xl">
        <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} className="space-y-5">

          {/* Winner announcement */}
          <div className="glass rounded-3xl p-8 text-center relative overflow-hidden">
            <div className="absolute inset-0 bg-gradient-to-br from-yellow-400/10 to-primary/5 pointer-events-none" />
            <div className="relative">
              <motion.div
                initial={{ scale: 0, rotate: -10 }}
                animate={{ scale: 1, rotate: 0 }}
                transition={{ type: "spring", stiffness: 200, delay: 0.2 }}
                className="text-6xl mb-4"
              >
                {isMyWin ? "🏆" : "🎵"}
              </motion.div>
              <h1 className="font-display text-3xl font-black mb-2">
                {isMyWin ? (
                  <span className="text-gradient-gold">You Won!</span>
                ) : (
                  <span className="text-gradient">Game Over!</span>
                )}
              </h1>
              {winner && (
                <p className="text-muted-foreground">
                  <span className="text-foreground font-semibold">
                    {winner.guestName || (winner.userId ? "Player" : "Unknown")}
                  </span>
                  {" "}wins with{" "}
                  <span className="text-primary font-bold">{winner.currentScore} points</span>
                </p>
              )}
            </div>
          </div>

          {/* Final Rankings */}
          <div className="glass rounded-2xl p-5">
            <h2 className="font-display font-semibold text-lg mb-4 flex items-center gap-2">
              <Trophy className="w-5 h-5 text-yellow-400" /> Final Rankings
            </h2>
            <div className="space-y-3">
              {players.map((player, idx) => {
                const isMe = (isAuthenticated && user && player.userId === user.id) ||
                  (guestToken && player.guestToken === guestToken);
                const name = player.guestName || (player.userId ? "Player" : "Unknown");

                return (
                  <div key={player.id}>
                    <motion.div
                      initial={{ opacity: 0, x: -20 }}
                      animate={{ opacity: 1, x: 0 }}
                      transition={{ delay: idx * 0.1 }}
                      className={`flex items-center gap-4 p-4 rounded-xl border ${
                        idx === 0
                          ? "border-yellow-400/40 bg-yellow-400/5"
                          : isMe
                          ? "border-primary/40 bg-primary/5"
                          : "border-border/30 bg-card/30"
                      }`}
                    >
                      <div className="flex items-center justify-center w-6">
                        {getRankIcon(idx)}
                      </div>
                      <div className={`w-10 h-10 rounded-full flex items-center justify-center font-bold text-sm ${
                        idx === 0 ? "bg-yellow-400/20 text-yellow-400" :
                        isMe ? "bg-primary/20 text-primary" :
                        "bg-secondary text-foreground"
                      }`}>
                        {name.charAt(0).toUpperCase()}
                      </div>
                      <div className="flex-1">
                        <div className="flex items-center gap-2">
                          <span className={`font-semibold ${isMe ? "text-primary" : "text-foreground"}`}>{name}</span>
                          {isMe && <span className="text-xs text-muted-foreground">(you)</span>}
                        </div>
                      </div>
                      <div className="text-right">
                        <div className={`font-display font-bold text-xl ${
                          idx === 0 ? "text-yellow-400" : isMe ? "text-primary" : "text-foreground"
                        }`}>
                          {player.currentScore}
                        </div>
                        <div className="text-muted-foreground text-xs">pts</div>
                      </div>
                    </motion.div>
                    {isMe && (
                      <div className="mt-2 pl-4">
                        <SocialShareButtons
                          content={getScoreShareContent(name, player.currentScore, room.difficulty, room.roundsTotal, window.location.href)}
                          compact
                        />
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          </div>

          {/* Game summary */}
          <div className="glass rounded-xl p-4">
            <div className="grid grid-cols-3 gap-4 text-center">
              <div>
                <div className="text-2xl font-bold text-foreground">{room.roundsTotal}</div>
                <div className="text-muted-foreground text-xs">Rounds</div>
              </div>
              <div>
                <div className="text-2xl font-bold text-foreground capitalize">{room.mode}</div>
                <div className="text-muted-foreground text-xs">Mode</div>
              </div>
              <div>
                <div className="text-2xl font-bold text-foreground capitalize">{room.difficulty}</div>
                <div className="text-muted-foreground text-xs">Difficulty</div>
              </div>
            </div>
          </div>

          {/* Guest conversion prompt */}
          {!isAuthenticated && (
            <motion.div
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: 0.5 }}
              className="glass rounded-2xl p-5 border border-primary/30"
            >
              <div className="flex items-start gap-3">
                <div className="w-10 h-10 rounded-xl bg-primary/20 flex items-center justify-center shrink-0">
                  <Star className="w-5 h-5 text-primary" />
                </div>
                <div className="flex-1">
                  <h3 className="font-display font-semibold text-foreground mb-1">Save Your Score!</h3>
                  <p className="text-muted-foreground text-sm mb-3">
                    Create a free account to save your stats, track your progress, and climb the leaderboards.
                  </p>
                  <Button asChild className="bg-primary text-primary-foreground hover:bg-primary/90 w-full">
                    <a href={getLoginUrl()}>
                      <User className="w-4 h-4 mr-2" /> Create Free Account
                    </a>
                  </Button>
                </div>
              </div>
            </motion.div>
          )}

          {/* Action buttons */}
          <div className="flex gap-3">
            <Button
              variant="outline"
              className="flex-1 border-border/50 py-5"
              onClick={() => navigate("/")}
            >
              <Home className="w-4 h-4 mr-2" /> Home
            </Button>
            <Button
              className="flex-[2] bg-primary text-primary-foreground hover:bg-primary/90 glow-purple py-5 font-semibold"
              onClick={handleRematch}
            >
              <RotateCcw className="w-4 h-4 mr-2" /> Play Again
            </Button>
          </div>

          {/* Leaderboard CTA */}
          <button
            onClick={() => navigate("/leaderboards")}
            className="w-full text-center text-sm text-muted-foreground hover:text-primary transition-colors py-2"
          >
            View Global Leaderboards →
          </button>
        </motion.div>
      </div>
    </div>
  );
}
