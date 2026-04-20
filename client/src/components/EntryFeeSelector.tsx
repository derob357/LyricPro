import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Trophy } from "lucide-react";
import { CAN_PURCHASE } from "@/lib/platform";

interface EntryFeeOption {
  amount: number;
  prizePool: number;
  tier: number;
}

const SOLO_ENTRY_FEES: EntryFeeOption[] = [
  { amount: 2.5, prizePool: 0.75, tier: 1 },
  { amount: 5, prizePool: 1.5, tier: 2 },
  { amount: 10, prizePool: 3, tier: 3 },
  { amount: 25, prizePool: 7.5, tier: 4 },
  { amount: 50, prizePool: 15, tier: 5 },
  { amount: 100, prizePool: 30, tier: 6 },
  { amount: 250, prizePool: 75, tier: 7 },
  { amount: 500, prizePool: 150, tier: 8 },
];

const TEAM_ENTRY_FEES: Record<number, EntryFeeOption[]> = {
  3: [
    { amount: 1.5, prizePool: 1.35, tier: 1 },
    { amount: 2.5, prizePool: 2.25, tier: 2 },
    { amount: 5, prizePool: 4.5, tier: 3 },
    { amount: 10, prizePool: 9, tier: 4 },
    { amount: 25, prizePool: 22.5, tier: 5 },
    { amount: 50, prizePool: 45, tier: 6 },
  ],
  5: [
    { amount: 1, prizePool: 1.5, tier: 1 },
    { amount: 1.5, prizePool: 2.25, tier: 2 },
    { amount: 2.5, prizePool: 3.75, tier: 3 },
    { amount: 5, prizePool: 7.5, tier: 4 },
    { amount: 10, prizePool: 15, tier: 5 },
    { amount: 25, prizePool: 37.5, tier: 6 },
  ],
  7: [
    { amount: 0.75, prizePool: 1.575, tier: 1 },
    { amount: 1, prizePool: 2.1, tier: 2 },
    { amount: 1.5, prizePool: 3.15, tier: 3 },
    { amount: 2.5, prizePool: 5.25, tier: 4 },
    { amount: 5, prizePool: 10.5, tier: 5 },
    { amount: 10, prizePool: 21, tier: 6 },
  ],
};

interface EntryFeeSelectorProps {
  gameType: "solo" | "team3" | "team5" | "team7";
  selectedFee?: number;
  onSelectFee: (amount: number) => void;
  loading?: boolean;
  maxEntryFee?: number;
}

export function EntryFeeSelector({
  gameType,
  selectedFee,
  onSelectFee,
  loading = false,
  maxEntryFee = 1000,
}: EntryFeeSelectorProps) {
  // Mobile: entry-fee games fall under App Store §5.3 (gambling / real-
  // money contests) with per-jurisdiction licensing requirements. Hide
  // the selector on native — these stay web-only.
  if (!CAN_PURCHASE) return null;
  const isSolo = gameType === "solo";
  const teamSize = isSolo ? 1 : parseInt(gameType.replace("team", ""));
  const fees = isSolo ? SOLO_ENTRY_FEES : TEAM_ENTRY_FEES[teamSize] || [];
  const filteredFees = fees.filter((f) => f.amount <= maxEntryFee);

  const gameTypeLabel = isSolo
    ? "Solo Game"
    : `${teamSize}-Player Team`;

  return (
    <div className="w-full max-w-4xl mx-auto px-4 py-8">
      <div className="mb-8">
        <h2 className="text-2xl font-bold mb-2">Select Entry Fee</h2>
        <p className="text-muted-foreground">
          {gameTypeLabel} • 30% of entry fees go to prize pool
        </p>
      </div>

      <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-4">
        {filteredFees.map((fee) => (
          <Card
            key={fee.tier}
            className={`p-4 cursor-pointer transition-all ${
              selectedFee === fee.amount
                ? "ring-2 ring-primary bg-primary/5"
                : "hover:border-primary"
            }`}
            onClick={() => onSelectFee(fee.amount)}
          >
            <div className="text-center">
              <div className="text-2xl font-bold mb-1">${fee.amount}</div>
              <div className="text-xs text-muted-foreground mb-3">Entry Fee</div>

              <div className="flex items-center justify-center gap-1 mb-2">
                <Trophy className="w-3 h-3 text-yellow-500" />
                <span className="text-sm font-semibold">${fee.prizePool}</span>
              </div>
              <div className="text-xs text-muted-foreground">Prize Pool</div>

              <Button
                size="sm"
                variant={selectedFee === fee.amount ? "default" : "outline"}
                className="w-full mt-3"
                disabled={loading}
              >
                {selectedFee === fee.amount ? "Selected" : "Select"}
              </Button>
            </div>
          </Card>
        ))}
      </div>

      {selectedFee && (
        <div className="mt-8 p-4 bg-accent/10 border border-accent rounded-lg">
          <div className="grid grid-cols-3 gap-4 text-center">
            <div>
              <div className="text-sm text-muted-foreground">Entry Fee</div>
              <div className="text-2xl font-bold">${selectedFee}</div>
            </div>
            <div>
              <div className="text-sm text-muted-foreground">Prize Pool</div>
              <div className="text-2xl font-bold">
                ${(selectedFee * 0.3 * (isSolo ? 1 : teamSize)).toFixed(2)}
              </div>
            </div>
            <div>
              <div className="text-sm text-muted-foreground">LyricPro Take</div>
              <div className="text-2xl font-bold">
                ${(selectedFee * 0.7 * (isSolo ? 1 : teamSize)).toFixed(2)}
              </div>
            </div>
          </div>
        </div>
      )}

      <div className="mt-8 p-4 bg-muted rounded-lg text-sm">
        <p className="font-semibold mb-2">Prize Distribution (Top 3):</p>
        <ul className="space-y-1 text-muted-foreground">
          <li>🥇 1st Place: 60% of prize pool</li>
          <li>🥈 2nd Place: 30% of prize pool</li>
          <li>🥉 3rd Place: 10% of prize pool</li>
        </ul>
      </div>
    </div>
  );
}
