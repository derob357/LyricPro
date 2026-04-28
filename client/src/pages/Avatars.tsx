import { useState } from "react";
import { Link, useLocation } from "wouter";
import { trpc } from "@/lib/trpc";
import { useAuth } from "@/_core/hooks/useAuth";
import { Button } from "@/components/ui/button";
import { toast } from "sonner";
import { Sparkles, Check, Lock } from "lucide-react";
import { UserAvatar } from "@/components/UserAvatar";
import { CAN_PURCHASE } from "@/lib/platform";

export default function Avatars() {
  const [, navigate] = useLocation();
  const { loading, isAuthenticated } = useAuth();
  const balanceQuery = trpc.goldenNotes.getMyBalance.useQuery(undefined, {
    enabled: !loading && isAuthenticated,
  });
  const listQuery = trpc.avatars.list.useQuery(undefined, {
    enabled: !loading && isAuthenticated,
  });
  const utils = trpc.useUtils();

  const equipMutation = trpc.avatars.equip.useMutation({
    onSuccess: async () => {
      await utils.avatars.list.invalidate();
      toast.success("Equipped.");
    },
    onError: (err) => toast.error(err.message),
  });

  const unlockMutation = trpc.avatars.unlock.useMutation({
    onSuccess: async () => {
      await Promise.all([
        utils.avatars.list.invalidate(),
        utils.goldenNotes.getMyBalance.invalidate(),
        utils.goldenNotes.getTransactions.invalidate(),
      ]);
      toast.success("Unlocked and equipped.");
      setConfirming(null);
    },
    onError: (err) => {
      toast.error(err.message);
      setConfirming(null);
    },
  });

  const [confirming, setConfirming] = useState<{ id: number; name: string; price: number } | null>(null);

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
          <h1 className="font-display font-bold text-xl text-gradient mb-2">Sign in to manage avatars</h1>
          <Button onClick={() => navigate("/signin")}>Sign in</Button>
        </div>
      </div>
    );
  }

  const balance = balanceQuery.data?.balance ?? 0;
  const catalog = listQuery.data?.catalog ?? [];
  const equippedId = listQuery.data?.equippedAvatarId ?? null;
  const owned = catalog.filter((a) => a.owned);
  const locked = catalog.filter((a) => !a.owned);

  return (
    <div className="min-h-screen relative overflow-hidden">
      <div className="absolute top-0 left-1/4 w-[28rem] h-[28rem] rounded-full bg-primary/20 blur-3xl pointer-events-none" />
      <div className="relative z-10 max-w-5xl mx-auto px-4 pt-24 pb-12">
        <div className="flex items-start justify-between gap-4 mb-8">
          <div>
            <h1 className="font-display font-black text-3xl sm:text-4xl text-gradient mb-2">Avatar Locker</h1>
            <p className="text-muted-foreground max-w-2xl">
              Unlock new avatars with Golden Notes. Once unlocked, an avatar is yours forever
              and shows up in your profile, on leaderboards, and in-game.
            </p>
          </div>
          <div className="glass rounded-xl p-4 text-right shrink-0 border border-border/50">
            <div className="text-xs uppercase tracking-wider text-muted-foreground">Your balance</div>
            <div className="font-display font-black text-3xl text-yellow-400 neon-gold">
              {balance.toLocaleString()}
            </div>
            <div className="text-xs text-muted-foreground mt-1">Golden Notes</div>
          </div>
        </div>

        <h2 className="font-display font-bold text-lg text-foreground mb-3">Owned ({owned.length})</h2>
        <div className="grid grid-cols-3 sm:grid-cols-4 lg:grid-cols-6 gap-3 mb-10">
          {owned.map((a) => (
            <button
              key={a.id}
              onClick={() => equipMutation.mutate({ avatarId: a.id })}
              disabled={equipMutation.isPending}
              className={`glass rounded-2xl p-3 border transition flex flex-col items-center ${
                a.id === equippedId ? "border-primary glow-purple" : "border-border/50 hover:border-primary/40"
              }`}
              title={a.id === equippedId ? "Equipped" : "Click to equip"}
            >
              <UserAvatar slug={a.slug} size="md" />
              <div className="text-xs mt-2 text-foreground font-medium truncate w-full text-center">{a.name}</div>
              {a.id === equippedId && (
                <div className="flex items-center gap-1 text-[10px] text-primary mt-1">
                  <Check className="w-3 h-3" /> Equipped
                </div>
              )}
            </button>
          ))}
        </div>

        {locked.length > 0 && (
          <>
            <h2 className="font-display font-bold text-lg text-foreground mb-3">
              Available to unlock ({locked.length})
            </h2>
            {!CAN_PURCHASE ? (
              <div className="glass rounded-2xl p-5 border border-border/50">
                <p className="text-sm text-muted-foreground">
                  Unlock new avatars on the LyricPro Ai website. Once unlocked, they sync here automatically.
                </p>
              </div>
            ) : (
              <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-4">
                {locked.map((a) => {
                  const canAfford = balance >= a.priceGn;
                  return (
                    <div key={a.id} className="glass rounded-2xl p-4 border border-border/50 flex flex-col items-center">
                      <div className="relative">
                        <UserAvatar slug={a.slug} size="lg" className="opacity-70" />
                        <Lock className="w-5 h-5 absolute bottom-0 right-0 text-muted-foreground bg-background rounded-full p-1" />
                      </div>
                      <div className="text-sm mt-3 text-foreground font-semibold">{a.name}</div>
                      <div className="flex items-center gap-1 text-yellow-400 neon-gold-sm text-sm font-bold mb-3">
                        <Sparkles className="w-3 h-3" /> {a.priceGn}
                      </div>
                      {canAfford ? (
                        <Button
                          size="sm"
                          className="w-full"
                          onClick={() => setConfirming({ id: a.id, name: a.name, price: a.priceGn })}
                          disabled={unlockMutation.isPending}
                        >
                          Unlock
                        </Button>
                      ) : (
                        <Button asChild size="sm" variant="outline" className="w-full">
                          <Link href="/shop">Get more</Link>
                        </Button>
                      )}
                    </div>
                  );
                })}
              </div>
            )}
          </>
        )}

        <p className="text-xs text-muted-foreground text-center mt-8">
          Need more Golden Notes?{" "}
          <Link href="/shop" className="underline">Visit the Shop</Link>.
        </p>
      </div>

      {confirming && (
        <div className="fixed inset-0 z-50 bg-black/60 flex items-center justify-center px-4">
          <div className="glass rounded-2xl p-6 border border-border/50 max-w-sm w-full">
            <h2 className="font-display font-bold text-lg mb-2">Unlock {confirming.name}?</h2>
            <p className="text-sm text-muted-foreground mb-4">
              Cost: <span className="text-yellow-400 font-bold">{confirming.price} ✨</span>
              <br />
              Balance after: <span className="text-foreground font-semibold">
                {(balance - confirming.price).toLocaleString()}
              </span>
              <br />
              <span className="text-xs">
                Once unlocked, the avatar is yours forever and will be auto-equipped.
              </span>
            </p>
            <div className="flex gap-2">
              <Button variant="outline" className="flex-1" onClick={() => setConfirming(null)}>
                Cancel
              </Button>
              <Button
                className="flex-1"
                onClick={() => unlockMutation.mutate({ avatarId: confirming.id })}
                disabled={unlockMutation.isPending}
              >
                {unlockMutation.isPending ? "Unlocking…" : `Unlock for ${confirming.price} ✨`}
              </Button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
