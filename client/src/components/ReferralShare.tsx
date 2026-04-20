import { useState } from "react";
import { trpc } from "@/lib/trpc";
import { Button } from "@/components/ui/button";
import { Copy, Share2 } from "lucide-react";
import { Card } from "@/components/ui/card";

export function ReferralShare() {
  const [copied, setCopied] = useState(false);
  const { data: referralData } = trpc.referral.getOrCreateReferralCode.useQuery();

  const handleCopy = () => {
    if (referralData?.referralUrl) {
      navigator.clipboard.writeText(referralData.referralUrl);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    }
  };

  const handleShare = async () => {
    if (!referralData?.referralUrl) return;

    if (navigator.share) {
      try {
        await navigator.share({
          title: "Join LyricPro Ai",
          text: "Play the ultimate lyric guessing game with me!",
          url: referralData.referralUrl,
        });
      } catch (err) {
        console.error("Share failed:", err);
      }
    } else {
      handleCopy();
    }
  };

  if (!referralData) return null;

  return (
    <Card className="p-6 bg-gradient-to-r from-purple-500/10 to-blue-500/10 border-purple-500/20">
      <div className="flex items-center justify-between">
        <div>
          <h3 className="font-semibold text-lg mb-2">Invite Friends</h3>
          <p className="text-sm text-gray-400 mb-4">Share your referral link and earn rewards</p>
          <code className="bg-background/50 px-3 py-2 rounded text-sm text-purple-300 break-all">
            {referralData.referralCode}
          </code>
        </div>
        <div className="flex gap-2">
          <Button
            variant="outline"
            size="sm"
            onClick={handleCopy}
            className="gap-2"
          >
            <Copy className="w-4 h-4" />
            {copied ? "Copied!" : "Copy"}
          </Button>
          <Button
            size="sm"
            className="gap-2 bg-purple-600 hover:bg-purple-700"
            onClick={handleShare}
          >
            <Share2 className="w-4 h-4" />
            Share
          </Button>
        </div>
      </div>
    </Card>
  );
}
