import { useLocation } from "wouter";
import { motion } from "framer-motion";
import { Sparkles, ChevronRight, Music2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { trpc } from "@/lib/trpc";
import { useAuth } from "@/_core/hooks/useAuth";
import { toast } from "sonner";

const PACK_PRICE_GN = 4;

export function WeaknessPackCard() {
  const { isAuthenticated } = useAuth();
  const [, navigate] = useLocation();
  const utils = trpc.useUtils();
  const { data: insight, isLoading } = trpc.insights.getMyWeaknessDiagnosis.useQuery(undefined, {
    enabled: isAuthenticated,
    staleTime: 60 * 60 * 1000,
  });
  const playPack = trpc.insights.playWeaknessPack.useMutation({
    onSuccess: (data) => {
      utils.goldenNotes.getMyBalance.invalidate();
      navigate(`/play/${data.roomCode}`);
    },
    onError: (err) => toast.error(err.message),
  });

  if (!isAuthenticated || isLoading || !insight) return null;

  if (!insight.eligible) {
    const ineligible = insight as { eligible: false; roundsPlayed: number; roundsRequired: number };
    if (typeof ineligible.roundsPlayed === "number") {
      return (
        <div className="glass rounded-2xl p-6 border-border/40">
          <p className="text-sm text-muted-foreground">
            Play {ineligible.roundsRequired - ineligible.roundsPlayed} more rounds to unlock your AI-personalized practice pack.
          </p>
        </div>
      );
    }
    return null;
  }

  const eligible = insight as {
    eligible: true;
    diagnosis: string;
    weakestGenre: string;
    weakestDecade: string;
    weakestCategory: string;
    packSongIds: number[];
    roundsAnalyzed: number;
  };

  return (
    <motion.div
      initial={{ opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      className="glass rounded-2xl p-6 border-primary/30 bg-gradient-to-br from-primary/10 to-accent/5"
    >
      <div className="flex items-center gap-2 mb-3">
        <Sparkles className="w-4 h-4 text-primary" />
        <h3 className="font-display font-semibold text-foreground">Personalized for you</h3>
      </div>
      <p className="text-foreground text-base mb-4">{eligible.diagnosis}</p>
      <div className="flex items-center justify-between gap-3">
        <div className="text-xs text-muted-foreground min-w-0 truncate">
          5-round pack · {eligible.weakestGenre} · {eligible.weakestDecade}
        </div>
        <Button
          className="bg-primary text-primary-foreground hover:bg-primary/90 glow-purple shrink-0"
          onClick={() => playPack.mutate()}
          disabled={playPack.isPending}
        >
          {playPack.isPending ? "Loading..." : (
            <>
              Play Practice Pack
              <span className="ml-2 inline-flex items-center gap-1">
                <Music2 className="w-3.5 h-3.5 text-yellow-400 neon-gold-sm" />
                <span className="text-yellow-400 neon-gold-sm">{PACK_PRICE_GN}</span>
              </span>
              <ChevronRight className="w-4 h-4 ml-1" />
            </>
          )}
        </Button>
      </div>
    </motion.div>
  );
}
