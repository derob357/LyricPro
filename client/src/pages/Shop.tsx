import { useEffect } from "react";
import { useLocation, useSearch, Link } from "wouter";
import { getRankTier } from "@/lib/scoring";
import { trpc } from "@/lib/trpc";
import { useAuth } from "@/_core/hooks/useAuth";
import { Button } from "@/components/ui/button";
import { toast } from "sonner";
import { Music2, Music, Gift, History, Globe, Trophy } from "lucide-react";
import { CAN_PURCHASE } from "@/lib/platform";
import { SubscriptionTierSelector } from "@/components/SubscriptionTierSelector";

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

  const utils = trpc.useUtils();

  const checkoutMutation = trpc.goldenNotes.createPurchaseCheckout.useMutation({
    onSuccess: (data) => {
      if (data.checkoutUrl) {
        window.location.href = data.checkoutUrl;
      }
    },
    onError: (err) => toast.error(err.message),
  });

  const extraGameMutation = trpc.goldenNotes.purchaseExtraGame.useMutation({
    onSuccess: () => {
      utils.goldenNotes.getMyBalance.invalidate();
      utils.goldenNotes.getTransactions.invalidate();
      toast.success("Extra game added — your next game won't count against today's limit.");
    },
    onError: (err) => toast.error(err.message),
  });

  // Recurring monthly subscription checkout. Server creates a Stripe
  // session in mode='subscription' against the per-tier price IDs in env
  // (STRIPE_PRICE_PLAYER / _PRO / _ELITE). Same-window redirect — keeps
  // mobile webviews from spawning a useless second tab.
  const subscriptionCheckoutMutation = trpc.monetization.createSubscriptionCheckout.useMutation({
    onSuccess: (data) => {
      if (data.checkoutUrl) {
        window.location.href = data.checkoutUrl;
      }
    },
    onError: (err) => toast.error(err.message || "Failed to start subscription checkout"),
  });

  const handleSelectTier = (tier: "free" | "player" | "pro" | "elite") => {
    if (tier === "free") {
      // Free is the default — there's nothing to checkout. Downgrades from
      // a paid tier go through Stripe's customer portal (sent in the
      // billing receipt email) — we don't expose a cancel button here yet.
      toast.info("Free is the default tier. Manage downgrades from your billing email.");
      return;
    }
    subscriptionCheckoutMutation.mutate({ tier });
  };

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
    <div className="min-h-screen relative overflow-hidden bg-background">
      {/* Ambient glow — amber-tinted for the shop */}
      <div className="absolute top-[-10%] left-1/2 -translate-x-1/2 w-[40rem] h-[40rem] rounded-full bg-amber-500/8 blur-[120px] pointer-events-none" />
      <div className="absolute bottom-[-5%] right-1/4 w-[24rem] h-[24rem] rounded-full bg-pink-500/6 blur-[100px] pointer-events-none" />

      <div className="relative z-10 max-w-3xl mx-auto px-4 pt-24 pb-16">
        {/* ── Header ── */}
        <div className="text-center mb-10">
          <div className="inline-flex items-center gap-2.5 mb-3">
            <Music2 className="w-6 h-6 text-amber-400 neon-gold-sm" />
            <h1 className="font-display font-black text-3xl sm:text-4xl text-gradient-gold">
              Golden Notes Shop
            </h1>
          </div>
          <p className="text-muted-foreground text-sm sm:text-base max-w-lg mx-auto">
            Unlock practice packs, extra games, and more
          </p>
        </div>

        {/* ── Balance card ── */}
        <div
          className="glass rounded-2xl border border-border/50 p-6 sm:p-8 text-center mb-12"
          style={{ boxShadow: "0 0 24px rgba(245,158,11,0.15)" }}
        >
          <div className="text-xs uppercase tracking-widest text-muted-foreground mb-2">
            Your Balance
          </div>
          <div
            className="font-display font-black text-5xl sm:text-6xl leading-none mb-1"
            style={{
              background: "linear-gradient(135deg, #f59e0b, #ec4899)",
              WebkitBackgroundClip: "text",
              WebkitTextFillColor: "transparent",
              backgroundClip: "text",
            }}
          >
            {balance.toLocaleString()}
          </div>
          <div className="text-sm text-muted-foreground">Golden Notes</div>
        </div>

        {/* ── Status: subscription + rank ── */}
        <div className="glass rounded-2xl p-5 border border-border/50 mb-10">
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
              <Link href="/profile" className="underline text-muted-foreground hover:text-foreground transition-colors">
                View profile →
              </Link>
            </div>
          </div>
        </div>

        {/* Native (iOS/Android): no purchase UI per App Store / Play policy. */}
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

        {/* ── Subscriptions ── */}
        {CAN_PURCHASE && (
          <div className="mb-12">
            <h2 className="font-display font-bold text-lg text-foreground mb-2 flex items-center gap-2">
              <Globe className="w-4 h-4 text-primary" />
              Monthly subscription
            </h2>
            <p className="text-muted-foreground text-sm mb-2">
              Recurring monthly. Cancel anytime from the receipt email or billing portal.
            </p>
            <SubscriptionTierSelector
              currentTier={subscriptionTier as "free" | "player" | "pro" | "elite"}
              onSelectTier={handleSelectTier}
              loading={subscriptionCheckoutMutation.isPending}
            />
          </div>
        )}

        {/* ── Buy Golden Notes ── */}
        {CAN_PURCHASE && (
        <>
        <h2 className="font-display font-bold text-xl text-foreground mb-5">
          Buy Golden Notes
        </h2>
        <div className="grid grid-cols-2 gap-4 mb-12">
          {packs.map((pack) => {
            const isBestValue = pack.id === "pro";
            return (
              <div
                key={pack.id}
                className="glass rounded-2xl p-5 border border-border/50 relative transition-all duration-300 hover:border-amber-400/40 hover:scale-[1.02] group"
              >
                {isBestValue && (
                  <div
                    className="absolute -top-3 -right-3 px-3 py-1 rounded-full text-xs font-bold text-white"
                    style={{
                      background: "linear-gradient(135deg, #f59e0b, #ec4899)",
                    }}
                  >
                    Best Value
                  </div>
                )}
                <div className="text-center mb-4">
                  <div
                    className="font-display font-black text-3xl sm:text-4xl leading-none mb-1"
                    style={{
                      background: "linear-gradient(135deg, #f59e0b, #ec4899)",
                      WebkitBackgroundClip: "text",
                      WebkitTextFillColor: "transparent",
                      backgroundClip: "text",
                    }}
                  >
                    {pack.notes.toLocaleString()}
                  </div>
                  <div className="text-xs text-muted-foreground uppercase tracking-wider">
                    notes
                  </div>
                </div>
                <Button
                  className="w-full bg-amber-500 text-black font-bold hover:bg-amber-400 transition-colors"
                  onClick={() => checkoutMutation.mutate({ packId: pack.id })}
                  disabled={checkoutMutation.isPending}
                >
                  {checkoutMutation.isPending ? "Redirecting…" : `$${pack.priceUsd}`}
                </Button>
              </div>
            );
          })}
        </div>
        <div className="text-center mb-12">
          <Link
            href="/avatars"
            className="inline-flex items-center gap-2 text-sm text-primary hover:underline transition-colors"
          >
            Looking to unlock avatars? <span className="font-semibold">Visit the Avatar Locker →</span>
          </Link>
        </div>
        </>
        )}

        {/* ── Spend Golden Notes ── */}
        <h2 className="font-display font-bold text-xl text-foreground mb-5">
          Spend Golden Notes
        </h2>
        <div className="space-y-3 mb-12">
          {/* Extra Game — real buy button, 1 GN, widens the daily play limit */}
          <div className="glass rounded-xl border border-border/50 p-4 flex items-center gap-4 transition-all duration-200 hover:border-amber-400/30">
            <div className="w-10 h-10 rounded-lg bg-amber-500/10 border border-amber-500/20 flex items-center justify-center shrink-0">
              <Music className="w-5 h-5 text-amber-400" />
            </div>
            <div className="flex-1 min-w-0">
              <div className="font-display font-semibold text-foreground text-sm">
                Extra Game
              </div>
              <div className="text-xs text-muted-foreground truncate">
                Play one more game after your daily limit — 1 GN
              </div>
              {balance < 1 && (
                <div className="text-xs text-destructive mt-0.5">
                  Not enough Golden Notes
                </div>
              )}
            </div>
            <div className="shrink-0">
              <Button
                size="sm"
                className="bg-amber-500 text-black font-bold hover:bg-amber-400 transition-colors"
                disabled={balance < 1 || extraGameMutation.isPending}
                onClick={() =>
                  extraGameMutation.mutate({
                    idempotencyKey: crypto.randomUUID(),
                  })
                }
              >
                {extraGameMutation.isPending ? "Buying…" : "Buy — 1 GN"}
              </Button>
            </div>
          </div>

          {/* Tournament Entry — navigation card; join + pay flow lives on /tournaments */}
          <div className="glass rounded-xl border border-border/50 p-4 flex items-center gap-4 transition-all duration-200 hover:border-amber-400/30">
            <div className="w-10 h-10 rounded-lg bg-amber-500/10 border border-amber-500/20 flex items-center justify-center shrink-0">
              <Trophy className="w-5 h-5 text-amber-400" />
            </div>
            <div className="flex-1 min-w-0">
              <div className="font-display font-semibold text-foreground text-sm">
                Tournament Entry — 5 to 100 GN
              </div>
              <div className="text-xs text-muted-foreground truncate">
                Join from the Tournaments page — entry cost varies by event
              </div>
            </div>
            <div className="shrink-0">
              <Button
                size="sm"
                variant="outline"
                onClick={() => navigate("/tournaments")}
              >
                Browse Tournaments
              </Button>
            </div>
          </div>

          {/* Gifting — coming soon */}
          <div className="glass rounded-xl border border-border/50 p-4 flex items-center gap-4 transition-all duration-200 hover:border-amber-400/30">
            <div className="w-10 h-10 rounded-lg bg-amber-500/10 border border-amber-500/20 flex items-center justify-center shrink-0">
              <Gift className="w-5 h-5 text-amber-400" />
            </div>
            <div className="flex-1 min-w-0">
              <div className="font-display font-semibold text-foreground text-sm">
                Gift to a Friend
              </div>
              <div className="text-xs text-muted-foreground truncate">
                Send Golden Notes to someone you know
              </div>
            </div>
            <div className="text-right shrink-0">
              <span className="text-xs text-muted-foreground italic">
                Coming soon
              </span>
            </div>
          </div>
        </div>

        {/* ── Recent activity ── */}
        {transactions.length > 0 && (
          <>
            <h2 className="font-display font-bold text-lg text-foreground mb-3 flex items-center gap-2">
              <History className="w-4 h-4 text-muted-foreground" />
              Recent activity
            </h2>
            <div className="glass rounded-2xl border border-border/50 divide-y divide-border/50 mb-12">
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
                    <div className={`font-display font-bold ${isCredit ? "text-amber-400 neon-gold-sm" : "text-muted-foreground"}`}>
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
          <a href="/termsofservice" className="underline hover:text-foreground transition-colors">Terms</a>.
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
