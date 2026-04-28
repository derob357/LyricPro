import { useEffect } from "react";
import { useLocation, useSearch, Link } from "wouter";
import { getRankTier } from "@/lib/scoring";
import { trpc } from "@/lib/trpc";
import { useAuth } from "@/_core/hooks/useAuth";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { toast } from "sonner";
import { Sparkles, Music, Gift, History, Check, Globe } from "lucide-react";
import { CAN_PURCHASE } from "@/lib/platform";

// The Shop page lets web users buy Golden Notes packs via Stripe Checkout.
// Mobile (Capacitor) builds will render a slimmed "view balance only"
// version of this page — purchases are web-only per App Store policy.

export default function Shop() {
  const [, navigate] = useLocation();
  const search = useSearch();
  const { user, loading, isAuthenticated } = useAuth();

  const balanceQuery = trpc.goldenNotes.getMyBalance.useQuery(undefined, {
    enabled: !loading && isAuthenticated,
  });
  const packsQuery = trpc.goldenNotes.getPacks.useQuery(undefined, {
    enabled: !loading && isAuthenticated,
  });
  const txQuery = trpc.goldenNotes.getTransactions.useQuery({ limit: 10 }, {
    enabled: !loading && isAuthenticated,
  });
  const subscriptionQuery = trpc.monetization.getSubscription.useQuery(undefined, {
    enabled: !loading && isAuthenticated,
  });

  const checkoutMutation = trpc.goldenNotes.createPurchaseCheckout.useMutation({
    onSuccess: (data) => {
      if (data.checkoutUrl) {
        window.location.href = data.checkoutUrl;
      }
    },
    onError: (err) => toast.error(err.message),
  });

  // Handle post-Stripe return: URL like /shop?status=success&pack=pro.
  // The webhook has probably already credited the user by the time they
  // arrive here, but we refetch balance + show a toast either way.
  useEffect(() => {
    const params = new URLSearchParams(search);
    const status = params.get("status");
    if (status === "success") {
      toast.success("Payment received. Golden Notes will appear momentarily.");
      // Allow a beat for the webhook to commit, then refetch.
      setTimeout(() => {
        balanceQuery.refetch();
        txQuery.refetch();
      }, 1500);
      // Strip query params from the URL.
      window.history.replaceState(null, "", "/shop");
    } else if (status === "cancelled") {
      toast.info("Checkout cancelled. No charges applied.");
      window.history.replaceState(null, "", "/shop");
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <div className="w-12 h-12 rounded-full border-2 border-primary border-t-transparent animate-spin" />
      </div>
    );
  }

  if (!isAuthenticated) {
    return (
      <div className="min-h-screen flex items-center justify-center px-4">
        <div className="max-w-md glass rounded-2xl p-8 border border-border/50 text-center">
          <h1 className="font-display font-bold text-xl text-gradient mb-2">
            Sign in to buy Golden Notes
          </h1>
          <p className="text-muted-foreground text-sm mb-6">
            Golden Notes unlock extra daily games, tournament entries, and
            advanced modes. You need an account to keep them.
          </p>
          <Button onClick={() => navigate("/signin")}>Sign in</Button>
        </div>
      </div>
    );
  }

  const balance = balanceQuery.data?.balance ?? 0;
  const packs = packsQuery.data ?? [];
  const transactions = txQuery.data ?? [];

  const lifetimeScore = (user as { lifetimeScore?: number } | null | undefined)?.lifetimeScore ?? 0;
  const rank = getRankTier(lifetimeScore);
  const subscriptionTier = (subscriptionQuery.data as { tier?: string } | undefined)?.tier ?? "free";

  return (
    <div className="min-h-screen relative overflow-hidden">
      <div className="absolute top-0 left-1/4 w-[28rem] h-[28rem] rounded-full bg-primary/20 blur-3xl pointer-events-none" />
      <div className="absolute bottom-0 right-1/4 w-[22rem] h-[22rem] rounded-full bg-accent/15 blur-3xl pointer-events-none" />

      <div className="relative z-10 max-w-5xl mx-auto px-4 pt-24 pb-12">
        {/* Header */}
        <div className="flex items-start justify-between gap-4 mb-8">
          <div>
            <div className="flex items-center gap-2 mb-2">
              <Sparkles className="w-5 h-5 text-yellow-400 neon-gold-sm" />
              <h1 className="font-display font-black text-3xl sm:text-4xl text-gradient">
                Golden Notes Shop
              </h1>
            </div>
            <p className="text-muted-foreground max-w-2xl">
              Golden Notes unlock extra daily games, tournament entries,
              advanced game modes, and gifts to friends. Purchased on the web,
              spendable anywhere — including the LyricPro mobile app.
            </p>
          </div>
          <div className="glass rounded-xl p-4 text-right shrink-0 border border-border/50">
            <div className="text-xs uppercase tracking-wider text-muted-foreground">
              Your balance
            </div>
            <div className="font-display font-black text-3xl text-yellow-400 neon-gold">
              {balance.toLocaleString()}
            </div>
            <div className="text-xs text-muted-foreground mt-1">
              Golden Notes
            </div>
          </div>
        </div>

        {/* Status: subscription tier + rank tier */}
        <div className="glass rounded-2xl p-5 border border-border/50 mb-8">
          <div className="flex flex-wrap items-center gap-x-8 gap-y-3">
            <div>
              <div className="text-xs uppercase tracking-wider text-muted-foreground mb-0.5">Membership</div>
              <div className="font-display font-bold text-foreground">
                {subscriptionTier === "free"
                  ? "Free"
                  : `${subscriptionTier[0].toUpperCase()}${subscriptionTier.slice(1)} plan`}
              </div>
            </div>
            <div>
              <div className="text-xs uppercase tracking-wider text-muted-foreground mb-0.5">Rank</div>
              <div className={`font-display font-bold ${rank.color}`}>
                {rank.tier}{" "}
                <span className="text-muted-foreground font-normal text-xs">
                  · {lifetimeScore.toLocaleString()} pts
                </span>
              </div>
            </div>
            <div className="ml-auto flex gap-3 text-sm">
              <Link href="/profile" className="underline text-muted-foreground hover:text-foreground">
                View profile →
              </Link>
            </div>
          </div>
        </div>

        {/* Native (iOS/Android): no purchase UI per App Store / Play policy.
            Instead, a clear notice directing users to the web to top up.
            App Store §3.1.3(a) says we can't *link* from the app to the
            web purchase page, but we can inform the user it exists. */}
        {!CAN_PURCHASE && (
          <div className="glass rounded-2xl p-5 border border-border/50 mb-12">
            <div className="flex items-start gap-3">
              <Globe className="w-5 h-5 text-accent mt-0.5 shrink-0" />
              <div>
                <h2 className="font-display font-bold text-lg text-foreground mb-1">
                  Top up on the web
                </h2>
                <p className="text-sm text-muted-foreground">
                  Golden Notes are purchased on <strong>LyricPro Ai</strong>'s
                  website. Once added there, your balance syncs automatically
                  here and you can spend them on extra games, tournaments,
                  and advanced modes.
                </p>
              </div>
            </div>
          </div>
        )}

        {/* Packs — web only */}
        {CAN_PURCHASE && (
        <>
        <h2 className="font-display font-bold text-lg text-foreground mb-4 flex items-center gap-2">
          <Music className="w-4 h-4 text-primary" />
          Buy a pack
        </h2>
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4 mb-12">
          {packs.map((pack) => (
            <div
              key={pack.id}
              className={`glass rounded-2xl p-5 border transition ${
                pack.id === "pro"
                  ? "border-primary/60 glow-purple"
                  : "border-border/50 hover:border-primary/40"
              }`}
            >
              <div className="flex items-start justify-between mb-2">
                <div className="font-display font-bold text-foreground text-lg">
                  {pack.label.split("—")[0].trim()}
                </div>
                {pack.id === "pro" && (
                  <Badge className="bg-primary/20 text-primary border-primary/40">
                    Best value
                  </Badge>
                )}
              </div>
              <div className="flex items-baseline gap-2 mb-1">
                <Sparkles className="w-4 h-4 text-yellow-400 neon-gold-sm" />
                <span className="font-display font-black text-2xl text-yellow-400 neon-gold">
                  {pack.notes.toLocaleString()}
                </span>
                <span className="text-sm text-muted-foreground">notes</span>
              </div>
              <div className="text-muted-foreground text-sm mb-4">
                ${pack.priceUsd} USD
              </div>
              <Button
                className="w-full bg-primary text-primary-foreground hover:bg-primary/90"
                onClick={() => checkoutMutation.mutate({ packId: pack.id })}
                disabled={checkoutMutation.isPending}
              >
                {checkoutMutation.isPending ? "Redirecting…" : `Buy ${pack.notes}`}
              </Button>
            </div>
          ))}
        </div>
        <div className="text-center mb-12">
          <Link
            href="/avatars"
            className="inline-flex items-center gap-2 text-sm text-primary hover:underline"
          >
            Looking to unlock avatars? <span className="font-semibold">Visit the Avatar Locker →</span>
          </Link>
        </div>
        </>
        )}

        {/* What you can do with them */}
        <div className="glass rounded-2xl p-5 border border-border/50 mb-12">
          <h2 className="font-display font-bold text-lg text-foreground mb-3 flex items-center gap-2">
            <Gift className="w-4 h-4 text-accent" />
            What Golden Notes unlock
          </h2>
          <ul className="space-y-2 text-sm text-muted-foreground">
            <li className="flex items-start gap-2">
              <Check className="w-4 h-4 text-accent mt-0.5 shrink-0" />
              <span><span className="text-foreground font-semibold">1 note</span> — one extra game after your daily limit</span>
            </li>
            <li className="flex items-start gap-2">
              <Check className="w-4 h-4 text-accent mt-0.5 shrink-0" />
              <span><span className="text-foreground font-semibold">5 notes</span> — a 30-minute advanced mode session, or a small tournament entry</span>
            </li>
            <li className="flex items-start gap-2">
              <Check className="w-4 h-4 text-accent mt-0.5 shrink-0" />
              <span><span className="text-foreground font-semibold">20 notes</span> — full-day advanced mode pass</span>
            </li>
            <li className="flex items-start gap-2">
              <Check className="w-4 h-4 text-accent mt-0.5 shrink-0" />
              <span><span className="text-foreground font-semibold">25+ notes</span> — medium tournament entry</span>
            </li>
            <li className="flex items-start gap-2">
              <Check className="w-4 h-4 text-accent mt-0.5 shrink-0" />
              <span><span className="text-foreground font-semibold">100+ notes</span> — large tournament with bigger prize pool</span>
            </li>
            <li className="flex items-start gap-2">
              <Gift className="w-4 h-4 text-yellow-400 mt-0.5 shrink-0" />
              <span className="text-muted-foreground italic">Gifting to friends — coming soon.</span>
            </li>
          </ul>
        </div>

        {/* Recent activity */}
        {transactions.length > 0 && (
          <>
            <h2 className="font-display font-bold text-lg text-foreground mb-3 flex items-center gap-2">
              <History className="w-4 h-4 text-muted-foreground" />
              Recent activity
            </h2>
            <div className="glass rounded-2xl border border-border/50 divide-y divide-border/50">
              {transactions.map((t) => {
                const isCredit = t.amount > 0;
                return (
                  <div key={t.id} className="flex items-center justify-between p-4">
                    <div>
                      <div className="text-foreground text-sm">
                        {formatKind(t.kind)}
                        {t.reason && <span className="text-muted-foreground ml-2">({t.reason})</span>}
                      </div>
                      <div className="text-xs text-muted-foreground">
                        {new Date(t.createdAt).toLocaleString()}
                      </div>
                    </div>
                    <div className={`font-display font-bold ${isCredit ? "text-yellow-400 neon-gold-sm" : "text-muted-foreground"}`}>
                      {isCredit ? "+" : ""}{t.amount}
                    </div>
                  </div>
                );
              })}
            </div>
          </>
        )}

        <p className="text-xs text-muted-foreground text-center mt-8">
          Payments processed by Stripe. Golden Notes have no cash value and
          are non-refundable except where required by law. See{" "}
          <a href="/terms.html" className="underline">Terms</a>.
        </p>
      </div>
    </div>
  );
}

function formatKind(kind: string): string {
  switch (kind) {
    case "purchase": return "Purchased";
    case "spend_extra_game": return "Played an extra game";
    case "spend_tournament": return "Entered tournament";
    case "spend_advanced_mode": return "Unlocked advanced mode";
    case "gift_sent": return "Sent a gift";
    case "gift_received": return "Received a gift";
    case "refund": return "Refunded";
    case "expiry": return "Expired";
    case "admin_adjustment": return "Admin adjustment";
    default: return kind;
  }
}
