import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Check } from "lucide-react";

interface TierOption {
  tier: "free" | "player" | "pro" | "elite";
  name: string;
  price: number;
  period: string;
  dailyGames: string;
  maxEntryFee: string;
  features: string[];
  recommended?: boolean;
}

const TIERS: TierOption[] = [
  {
    tier: "free",
    name: "Free",
    price: 0,
    period: "Forever",
    dailyGames: "2 trial games",
    maxEntryFee: "None",
    features: [
      "2 trial games total",
      "Basic gameplay",
      "No prizes",
      "No leaderboards",
    ],
  },
  {
    tier: "player",
    name: "Player",
    price: 6.99,
    period: "/month",
    dailyGames: "1 game every 2 days",
    maxEntryFee: "$25",
    features: [
      "1 game every 2 days",
      "$0.99 add-on games",
      "Daily challenges",
      "Leaderboards",
      "Stats & themes",
    ],
  },
  {
    tier: "pro",
    name: "Pro",
    price: 9.99,
    period: "/month",
    dailyGames: "1 game per day",
    maxEntryFee: "$100",
    features: [
      "1 game per day",
      "$0.99 add-on games",
      "Entry fees up to $100",
      "Competitive leaderboards",
      "Team play access",
      "Tournaments",
    ],
    recommended: true,
  },
  {
    tier: "elite",
    name: "Elite",
    price: 19.99,
    period: "/month",
    dailyGames: "1 game per day",
    maxEntryFee: "$1,000",
    features: [
      "1 game per day",
      "$0.99 add-on games",
      "Entry fees up to $1,000",
      "VIP tournaments",
      "Monthly $50 bonus",
      "Priority support",
    ],
  },
];

interface SubscriptionTierSelectorProps {
  currentTier?: "free" | "player" | "pro" | "elite";
  onSelectTier: (tier: "free" | "player" | "pro" | "elite") => void;
  loading?: boolean;
}

export function SubscriptionTierSelector({
  currentTier = "free",
  onSelectTier,
  loading = false,
}: SubscriptionTierSelectorProps) {
  return (
    <div className="w-full max-w-6xl mx-auto px-4 py-8">
      <div className="text-center mb-12">
        <h2 className="text-3xl font-bold mb-2">Choose Your Tier</h2>
        <p className="text-muted-foreground">
          Play daily games or compete for prizes
        </p>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6">
        {TIERS.map((tier) => (
          <Card
            key={tier.tier}
            className={`relative flex flex-col p-6 transition-all ${
              tier.recommended ? "ring-2 ring-accent md:scale-105" : ""
            } ${currentTier === tier.tier ? "ring-2 ring-primary" : ""}`}
          >
            {tier.recommended && (
              <div className="absolute -top-3 left-1/2 -translate-x-1/2 bg-accent text-accent-foreground px-3 py-1 rounded-full text-sm font-semibold">
                Recommended
              </div>
            )}

            <div className="mb-6">
              <h3 className="text-2xl font-bold mb-2">{tier.name}</h3>
              <div className="flex items-baseline gap-1">
                <span className="text-3xl font-bold">${tier.price}</span>
                <span className="text-muted-foreground text-sm">{tier.period}</span>
              </div>
            </div>

            <div className="space-y-3 mb-6 flex-1">
              <div className="text-sm">
                <span className="font-semibold">Daily Games:</span> {tier.dailyGames}
              </div>
              <div className="text-sm">
                <span className="font-semibold">Max Entry Fee:</span> {tier.maxEntryFee}
              </div>
            </div>

            <div className="space-y-2 mb-6">
              {tier.features.map((feature) => (
                <div key={feature} className="flex items-start gap-2 text-sm">
                  <Check className="w-4 h-4 text-green-500 flex-shrink-0 mt-0.5" />
                  <span>{feature}</span>
                </div>
              ))}
            </div>

            <Button
              onClick={() => onSelectTier(tier.tier)}
              disabled={loading || currentTier === tier.tier}
              variant={currentTier === tier.tier ? "secondary" : "default"}
              className="w-full"
            >
              {currentTier === tier.tier ? "Current Plan" : "Select"}
            </Button>
          </Card>
        ))}
      </div>

      <div className="mt-12 p-6 bg-muted rounded-lg">
        <h3 className="font-semibold mb-2">Need more games?</h3>
        <p className="text-sm text-muted-foreground mb-3">
          Purchase additional games anytime for $0.99 each, or upgrade to a higher tier for unlimited daily games.
        </p>
      </div>
    </div>
  );
}
