import { Button } from "@/components/ui/button";
import { trpc } from "@/lib/trpc";
import { toast } from "sonner";
import { Loader2 } from "lucide-react";

interface StripeCheckoutButtonProps {
  type: "subscription" | "entry_fee" | "add_on";
  tier?: "player" | "pro" | "elite";
  entryFeeGameId?: number;
  entryFeeAmount?: number;
  gameType?: "solo" | "team3" | "team5" | "team7";
  quantity?: number;
  children: React.ReactNode;
  className?: string;
  onSuccess?: () => void;
}

export function StripeCheckoutButton({
  type,
  tier,
  entryFeeGameId,
  entryFeeAmount,
  gameType,
  quantity,
  children,
  className,
  onSuccess,
}: StripeCheckoutButtonProps) {
  const subscriptionCheckout = trpc.monetization.createSubscriptionCheckout.useMutation({
    onSuccess: (data) => {
      if (data.checkoutUrl) {
        window.open(data.checkoutUrl, "_blank");
        toast.success("Redirecting to Stripe Checkout...");
        onSuccess?.();
      }
    },
    onError: (err) => {
      toast.error(err.message || "Failed to create checkout session");
    },
  });

  const entryFeeCheckout = trpc.monetization.createEntryFeeCheckout.useMutation({
    onSuccess: (data) => {
      if (data.checkoutUrl) {
        window.open(data.checkoutUrl, "_blank");
        toast.success("Redirecting to Stripe Checkout...");
        onSuccess?.();
      }
    },
    onError: (err) => {
      toast.error(err.message || "Failed to create checkout session");
    },
  });

  const addOnCheckout = trpc.monetization.createAddOnGamesCheckout.useMutation({
    onSuccess: (data) => {
      if (data.checkoutUrl) {
        window.open(data.checkoutUrl, "_blank");
        toast.success("Redirecting to Stripe Checkout...");
        onSuccess?.();
      }
    },
    onError: (err) => {
      toast.error(err.message || "Failed to create checkout session");
    },
  });

  const handleClick = () => {
    if (type === "subscription" && tier) {
      subscriptionCheckout.mutate({ tier });
    } else if (type === "entry_fee" && entryFeeGameId && entryFeeAmount && gameType) {
      entryFeeCheckout.mutate({
        entryFeeGameId,
        entryFeeAmount,
        gameType,
      });
    } else if (type === "add_on" && quantity) {
      addOnCheckout.mutate({ quantity });
    }
  };

  const isLoading =
    subscriptionCheckout.isPending ||
    entryFeeCheckout.isPending ||
    addOnCheckout.isPending;

  return (
    <Button
      onClick={handleClick}
      disabled={isLoading}
      className={className}
    >
      {isLoading && <Loader2 className="w-4 h-4 mr-2 animate-spin" />}
      {children}
    </Button>
  );
}
