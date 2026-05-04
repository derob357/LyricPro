import { useLocation, Link } from "wouter";
import { useState } from "react";
import { motion } from "framer-motion";
import { Button } from "@/components/ui/button";
import { UserAvatar } from "@/components/UserAvatar";
import { Badge } from "@/components/ui/badge";
import { trpc } from "@/lib/trpc";
import { useAuth } from "@/_core/hooks/useAuth";
import { getLoginUrl, getSignUpUrl, getPasswordResetUrl } from "@/const";
import { getRankTier } from "@/lib/scoring";
import { ArrowLeft, Trophy, Star, Zap, Target, Music, Calendar,
  Flame, BarChart3, Play, Crown, TrendingUp, LogOut, Pencil, Check, X
} from "lucide-react";
import { Input } from "@/components/ui/input";
import { toast } from "sonner";
import { WeaknessPackCard } from "@/components/WeaknessPackCard";

export default function Profile() {
  const [, navigate] = useLocation();
  const { user, isAuthenticated, logout, refresh } = useAuth();
  const utils = trpc.useUtils();
  const [editingName, setEditingName] = useState(false);
  const [editFirstName, setEditFirstName] = useState("");
  const [editLastName, setEditLastName] = useState("");

  const updateProfileMutation = trpc.auth.updateProfile.useMutation({
    onSuccess: async () => {
      await utils.auth.me.invalidate();
      await refresh();
      setEditingName(false);
      toast.success("Name updated!");
    },
    onError: (err) => toast.error(err.message || "Failed to update name"),
  });

  const { data: profile, isLoading } = trpc.game.getProfile.useQuery(undefined, {
    enabled: isAuthenticated,
  });

  if (!isAuthenticated) {
    return (
      <div className="min-h-screen flex items-center justify-center px-4">
        <div className="glass rounded-2xl p-8 text-center max-w-md w-full">
          <Trophy className="w-12 h-12 text-primary mx-auto mb-4" />
          <h2 className="font-display text-2xl font-bold mb-2 text-foreground">Sign In to View Profile</h2>
          <p className="text-muted-foreground mb-6">Create an account to track your stats, earn rank tiers, and compete on leaderboards.</p>
          <div className="space-y-3">
            <Button asChild className="w-full bg-primary text-primary-foreground hover:bg-primary/90 glow-purple">
              <a href={getLoginUrl()}>Sign In</a>
            </Button>
            <Button asChild variant="outline" className="w-full border-primary/50 text-primary hover:bg-primary/10">
              <a href={getSignUpUrl()}>Create Account</a>
            </Button>
            <a href={getPasswordResetUrl()} className="block text-center text-sm text-muted-foreground hover:text-foreground transition-colors mt-2">
              Forgot password? Reset it here
            </a>
          </div>
          <button onClick={() => navigate("/")} className="mt-3 text-sm text-muted-foreground hover:text-foreground transition-colors block w-full">
            Back to Home
          </button>
        </div>
      </div>
    );
  }

  if (isLoading) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <div className="text-center">
          <div className="w-12 h-12 rounded-full border-2 border-primary border-t-transparent animate-spin mx-auto mb-4" />
          <p className="text-muted-foreground">Loading profile...</p>
        </div>
      </div>
    );
  }

  const userData = profile?.user;
  const recentGames = profile?.recentGames ?? [];
  const lifetimeScore = userData?.lifetimeScore ?? 0;
  const gamesPlayed = userData?.gamesPlayed ?? 0;
  const totalWins = userData?.totalWins ?? 0;
  const rankInfo = getRankTier(lifetimeScore);
  const winRate = gamesPlayed > 0 ? Math.round((totalWins / gamesPlayed) * 100) : 0;

  const RANK_TIERS = [
    { name: "Rookie", min: 0, max: 249 },
    { name: "Rising Star", min: 250, max: 749 },
    { name: "Pro", min: 750, max: 1999 },
    { name: "Expert", min: 2000, max: 4999 },
    { name: "Master", min: 5000, max: 9999 },
    { name: "Legend", min: 10000, max: Infinity },
  ];

  const currentTierIdx = RANK_TIERS.findIndex(t => t.name === rankInfo.tier);
  const nextTier = RANK_TIERS[currentTierIdx + 1];
  const tierProgress = nextTier && rankInfo.next !== Infinity
    ? Math.min(100, Math.round(((lifetimeScore - (RANK_TIERS[currentTierIdx]?.min ?? 0)) / (rankInfo.next - (RANK_TIERS[currentTierIdx]?.min ?? 0))) * 100))
    : 100;

  return (
    <div className="min-h-screen text-foreground pb-8">
      {/* Header */}
      <div className="glass border-b border-border/50 sticky top-0 z-40">
        <div className="container flex items-center justify-between h-16">
          <button onClick={() => navigate("/")} className="flex items-center gap-2 text-muted-foreground hover:text-foreground transition-colors">
            <ArrowLeft className="w-4 h-4" />
            <span className="text-sm">Back</span>
          </button>
          <h1 className="font-display font-bold text-lg text-gradient">My Profile</h1>
          <button onClick={logout} className="flex items-center gap-2 text-muted-foreground hover:text-red-400 transition-colors text-sm" title="Log Out">
            <LogOut className="w-4 h-4" />
            <span className="hidden sm:inline">Log Out</span>
          </button>
        </div>
      </div>

      <div className="container py-8 max-w-2xl">
        <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} className="space-y-6">

          {/* Profile header */}
          <div className="glass rounded-2xl p-6 relative overflow-hidden">
            <div className="absolute inset-0 bg-gradient-to-br from-primary/10 to-accent/5 pointer-events-none" />
            <div className="relative flex items-center gap-4">
              <UserAvatar size="lg" className="w-16 h-16 rounded-2xl" />
              <div className="flex-1">
                {editingName ? (
                  <div className="space-y-2">
                    <div className="flex gap-2">
                      <Input
                        placeholder="First name"
                        value={editFirstName}
                        onChange={(e) => setEditFirstName(e.target.value)}
                        className="h-8 text-sm bg-input border-border/50"
                        autoFocus
                      />
                      <Input
                        placeholder="Last name"
                        value={editLastName}
                        onChange={(e) => setEditLastName(e.target.value)}
                        className="h-8 text-sm bg-input border-border/50"
                      />
                    </div>
                    <div className="flex gap-2">
                      <Button size="sm" className="h-7 text-xs bg-primary text-primary-foreground"
                        onClick={() => updateProfileMutation.mutate({ firstName: editFirstName.trim(), lastName: editLastName.trim() })}
                        disabled={!editFirstName.trim() || updateProfileMutation.isPending}>
                        <Check className="w-3 h-3 mr-1" /> Save
                      </Button>
                      <Button size="sm" variant="ghost" className="h-7 text-xs" onClick={() => setEditingName(false)}>
                        <X className="w-3 h-3 mr-1" /> Cancel
                      </Button>
                    </div>
                  </div>
                ) : (
                  <div className="flex items-center gap-2">
                    <h2 className="font-display font-bold text-xl text-foreground">
                      {user?.firstName
                        ? `${user.firstName}${user.lastName ? ' ' + user.lastName : ''}`
                        : (userData?.name || user?.name || "Player")}
                    </h2>
                    <button
                      onClick={() => {
                        setEditFirstName(user?.firstName || "");
                        setEditLastName(user?.lastName || "");
                        setEditingName(true);
                      }}
                      className="text-muted-foreground hover:text-foreground transition-colors"
                      title="Edit name"
                    >
                      <Pencil className="w-3.5 h-3.5" />
                    </button>
                  </div>
                )}
                <p className="text-muted-foreground text-sm">{userData?.email || user?.email}</p>
                <div className="flex items-center gap-2 mt-1">
                  <Crown className="w-3.5 h-3.5 text-yellow-400" />
                  <span className={`text-sm font-semibold ${rankInfo.color}`}>{rankInfo.tier}</span>
                </div>
              </div>
              <div className="text-right">
                <div className="font-display font-black text-3xl text-gradient">{lifetimeScore.toLocaleString()}</div>
                <div className="text-muted-foreground text-xs">lifetime pts</div>
              </div>
            </div>

            <div className="mt-3">
              <Button asChild variant="outline" size="sm">
                <Link href="/avatars">Manage avatars</Link>
              </Button>
            </div>

            {/* Rank progress */}
            {nextTier && (
              <div className="mt-4">
                <div className="flex items-center justify-between text-xs text-muted-foreground mb-1.5">
                  <span>{rankInfo.tier}</span>
                  <span>{lifetimeScore.toLocaleString()} / {rankInfo.next.toLocaleString()} pts to {nextTier.name}</span>
                </div>
                <div className="h-2 bg-secondary rounded-full overflow-hidden">
                  <motion.div
                    initial={{ width: 0 }}
                    animate={{ width: `${tierProgress}%` }}
                    transition={{ duration: 1, ease: "easeOut" }}
                    className="h-full bg-gradient-to-r from-primary to-accent rounded-full"
                  />
                </div>
              </div>
            )}
            {!nextTier && (
              <div className="mt-4 text-center">
                <Badge className="bg-yellow-400/20 text-yellow-400 border-yellow-400/30">
                  <Crown className="w-3 h-3 mr-1" /> Maximum Rank Achieved!
                </Badge>
              </div>
            )}
          </div>

          {/* Weakness Pack Card */}
          <WeaknessPackCard />

          {/* Stats grid */}
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
            {[
              { icon: Play, label: "Games Played", value: gamesPlayed, color: "text-primary" },
              { icon: Trophy, label: "Total Wins", value: totalWins, color: "text-yellow-400" },
              { icon: Target, label: "Win Rate", value: `${winRate}%`, color: "text-green-400" },
              { icon: TrendingUp, label: "Avg Score", value: gamesPlayed > 0 ? Math.round(lifetimeScore / gamesPlayed) : 0, color: "text-accent" },
            ].map(({ icon: Icon, label, value, color }) => (
              <div key={label} className="glass rounded-xl p-4 text-center">
                <Icon className={`w-5 h-5 mx-auto mb-2 ${color}`} />
                <div className={`font-display font-bold text-2xl ${color}`}>{value}</div>
                <div className="text-muted-foreground text-xs mt-0.5">{label}</div>
              </div>
            ))}
          </div>

          {/* Rank Tiers */}
          <div className="glass rounded-2xl p-5">
            <h3 className="font-display font-semibold text-lg mb-4 flex items-center gap-2">
              <Star className="w-5 h-5 text-primary" /> Rank Tiers
            </h3>
            <div className="space-y-2">
              {RANK_TIERS.map((tier, idx) => {
                const isCurrentTier = tier.name === rankInfo.tier;
                const isUnlocked = lifetimeScore >= tier.min;
                return (
                  <div
                    key={tier.name}
                    className={`flex items-center justify-between p-3 rounded-xl border transition-all ${
                      isCurrentTier
                        ? "border-primary/50 bg-primary/10"
                        : isUnlocked
                        ? "border-border/30 bg-card/20"
                        : "border-border/20 opacity-50"
                    }`}
                  >
                    <div className="flex items-center gap-3">
                      <div className={`w-8 h-8 rounded-full flex items-center justify-center text-sm ${
                        isCurrentTier ? "bg-primary/20" : isUnlocked ? "bg-secondary" : "bg-card"
                      }`}>
                        {idx === 5 ? "👑" : idx === 4 ? "⭐" : idx === 3 ? "💎" : idx === 2 ? "🥇" : idx === 1 ? "🌟" : "🎵"}
                      </div>
                      <div>
                        <div className={`font-semibold text-sm ${isCurrentTier ? "text-primary" : isUnlocked ? "text-foreground" : "text-muted-foreground"}`}>
                          {tier.name}
                          {isCurrentTier && <span className="text-xs ml-2 text-primary">(current)</span>}
                        </div>
                        <div className="text-muted-foreground text-xs">
                          {tier.max === Infinity ? `${tier.min.toLocaleString()}+ pts` : `${tier.min.toLocaleString()} – ${tier.max.toLocaleString()} pts`}
                        </div>
                      </div>
                    </div>
                    {isUnlocked && <Badge variant="secondary" className="text-xs">Unlocked</Badge>}
                  </div>
                );
              })}
            </div>
          </div>

          {/* Recent Games */}
          {recentGames.length > 0 && (
            <div className="glass rounded-2xl p-5">
              <h3 className="font-display font-semibold text-lg mb-4 flex items-center gap-2">
                <BarChart3 className="w-5 h-5 text-primary" /> Recent Games
              </h3>
              <div className="space-y-2">
                {recentGames.map((game, idx) => (
                  <div key={game.id} className="flex items-center justify-between p-3 rounded-xl bg-card/30 border border-border/30">
                    <div className="flex items-center gap-3">
                      <div className="w-8 h-8 rounded-full bg-secondary flex items-center justify-center text-xs font-bold text-muted-foreground">
                        {idx + 1}
                      </div>
                      <div>
                        <div className="text-sm font-medium text-foreground capitalize">{game.mode} mode</div>
                        <div className="text-xs text-muted-foreground">
                          {game.genre && <span>{game.genre} · </span>}
                          {new Date(game.createdAt).toLocaleDateString()}
                        </div>
                      </div>
                    </div>
                    <div className="text-right">
                      <div className="font-bold text-primary">{game.score}</div>
                      <div className="text-xs text-muted-foreground">pts</div>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* CTA */}
          <Button
            className="w-full bg-primary text-primary-foreground hover:bg-primary/90 glow-purple py-5 font-semibold"
            onClick={() => navigate("/setup")}
          >
            <Play className="w-4 h-4 mr-2" /> Play Another Game
          </Button>

          <button
            type="button"
            onClick={() => navigate("/account/security")}
            className="block w-full text-center text-sm text-muted-foreground hover:text-foreground transition-colors mt-2"
          >
            Account security &amp; password
          </button>
        </motion.div>
      </div>
    </div>
  );
}
