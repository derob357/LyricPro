import { useState } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { StripeCheckoutButton } from "./StripeCheckoutButton";
import { Loader2 } from "lucide-react";
import { CAN_PURCHASE } from "@/lib/platform";

const ENTRY_FEES = [2.5, 5, 10, 25, 50, 100, 250, 500, 1000];
const TEAM_SIZES = [
  { size: 3, label: "3-Player Team" },
  { size: 5, label: "5-Player Team" },
  { size: 7, label: "7-Player Team" },
];

interface EntryFeeModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  gameType: "solo" | "team3" | "team5" | "team7";
  onEntryFeeSelected: (entryFee: number, gameType: string) => void;
  isCreating?: boolean;
}

export function EntryFeeModal({
  open,
  onOpenChange,
  gameType,
  onEntryFeeSelected,
  isCreating = false,
}: EntryFeeModalProps) {
  // Mobile: entry-fee modal never opens. See EntryFeeSelector for rationale.
  if (!CAN_PURCHASE) return null;
  const [selectedFee, setSelectedFee] = useState<number | null>(null);
  const [showCheckout, setShowCheckout] = useState(false);

  const handleFeeSelect = (fee: number) => {
    setSelectedFee(fee);
    setShowCheckout(true);
  };

  const handleCheckoutSuccess = () => {
    if (selectedFee) {
      onEntryFeeSelected(selectedFee, gameType);
      setShowCheckout(false);
      setSelectedFee(null);
      onOpenChange(false);
    }
  };

  const isSolo = gameType === "solo";
  const teamSize = isSolo ? null : parseInt(gameType.replace("team", ""));

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle>
            {isSolo ? "Solo Game Entry Fee" : `${teamSize}-Player Team Entry Fee`}
          </DialogTitle>
          <DialogDescription>
            Choose an entry fee to play for prizes. Higher entry fees mean larger prize pools.
          </DialogDescription>
        </DialogHeader>

        {!showCheckout ? (
          <div className="space-y-6">
            {/* Prize Pool Info */}
            <div className="bg-gradient-to-r from-purple-500/10 to-blue-500/10 border border-purple-500/20 rounded-lg p-4">
              <p className="text-sm font-semibold text-purple-300 mb-2">Prize Pool Structure</p>
              <p className="text-xs text-gray-400">
                30% of all entry fees go to the prize pool. Winners split: 1st (60%), 2nd (30%), 3rd (10%)
              </p>
            </div>

            {/* Entry Fee Grid */}
            <div className="grid grid-cols-3 gap-3">
              {ENTRY_FEES.map((fee) => (
                <button
                  key={fee}
                  onClick={() => handleFeeSelect(fee)}
                  disabled={isCreating}
                  className="p-4 rounded-lg border border-gray-700 hover:border-purple-500 hover:bg-purple-500/10 transition-all text-center disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  <div className="text-lg font-bold text-white">${fee.toFixed(2)}</div>
                  <div className="text-xs text-gray-400 mt-1">
                    Prize: ${(fee * 0.3).toFixed(2)}
                  </div>
                </button>
              ))}
            </div>

            {/* Free Play Option */}
            <div className="border-t border-gray-700 pt-4">
              <Button
                variant="outline"
                className="w-full"
                onClick={() => {
                  onEntryFeeSelected(0, gameType);
                  onOpenChange(false);
                }}
                disabled={isCreating}
              >
                Play for Free (No Prize)
              </Button>
            </div>
          </div>
        ) : selectedFee !== null ? (
          <div className="space-y-6">
            <div className="bg-gradient-to-r from-green-500/10 to-emerald-500/10 border border-green-500/20 rounded-lg p-4">
              <p className="text-sm font-semibold text-green-300 mb-2">Entry Fee Selected</p>
              <p className="text-2xl font-bold text-white">${selectedFee.toFixed(2)}</p>
              <p className="text-xs text-gray-400 mt-2">
                Prize pool contribution: ${(selectedFee * 0.3).toFixed(2)}
              </p>
            </div>

            <StripeCheckoutButton
              type="entry_fee"
              entryFeeGameId={0} // Will be set after checkout
              entryFeeAmount={selectedFee}
              gameType={gameType}
              onSuccess={handleCheckoutSuccess}
              className="w-full"
            >
              {isCreating ? (
                <>
                  <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                  Processing...
                </>
              ) : (
                `Pay $${selectedFee.toFixed(2)} to Play`
              )}
            </StripeCheckoutButton>

            <Button
              variant="ghost"
              className="w-full"
              onClick={() => setShowCheckout(false)}
              disabled={isCreating}
            >
              Back to Fee Selection
            </Button>
          </div>
        ) : null}
      </DialogContent>
    </Dialog>
  );
}
