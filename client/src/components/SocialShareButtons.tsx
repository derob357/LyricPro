import { Button } from "@/components/ui/button";
import {
  Twitter,
  Facebook,
  Linkedin,
  MessageCircle,
  Copy,
  Share2,
  Instagram,
} from "lucide-react";
import {
  generateShareUrls,
  openShareWindow,
  shareToClipboard,
  nativeShare,
  type ShareContent,
} from "@/lib/shareUtils";
import { useState } from "react";
import { toast } from "sonner";

interface SocialShareButtonsProps {
  content: ShareContent;
  compact?: boolean;
  showNativeShare?: boolean;
}

export default function SocialShareButtons({
  content,
  compact = false,
  showNativeShare = true,
}: SocialShareButtonsProps) {
  const [copied, setCopied] = useState(false);
  const urls = generateShareUrls(content);

  const handleShare = async (platform: keyof typeof urls) => {
    const url = urls[platform];
    if (!url) {
      toast.info(`${platform} sharing not available via direct link. Try copying instead.`);
      return;
    }
    try {
      openShareWindow(url, platform);
    } catch (error) {
      console.error(`Failed to open ${platform} share:`, error);
      toast.error(`Failed to open ${platform}. Try copying instead.`);
    }
  };

  const handleCopy = async () => {
    // Include URL in copy if available
    const urlPart = content.url ? `\n${content.url}` : "";
    const text = `${content.text}${urlPart}`;
    const success = await shareToClipboard(text);
    if (success) {
      setCopied(true);
      toast.success("Copied to clipboard!");
      setTimeout(() => setCopied(false), 2000);
    } else {
      toast.error("Failed to copy to clipboard");
    }
  };

  const handleNativeShare = async () => {
    const success = await nativeShare(content);
    if (!success) {
      // Fallback to copy
      handleCopy();
    }
  };

  if (compact) {
    return (
      <div className="flex gap-2 flex-wrap">
        {showNativeShare && (
          <Button
            variant="outline"
            size="sm"
            onClick={handleNativeShare}
            className="border-border/50 text-muted-foreground hover:text-foreground"
            title="Share"
          >
            <Share2 className="w-4 h-4" />
          </Button>
        )}
        <Button
          variant="outline"
          size="sm"
          onClick={() => handleShare("twitter")}
          className="border-border/50 text-muted-foreground hover:text-foreground"
          title="Share on Twitter/X"
        >
          <Twitter className="w-4 h-4" />
        </Button>
        <Button
          variant="outline"
          size="sm"
          onClick={() => handleShare("facebook")}
          className="border-border/50 text-muted-foreground hover:text-foreground"
          title="Share on Facebook"
        >
          <Facebook className="w-4 h-4" />
        </Button>
        <Button
          variant="outline"
          size="sm"
          onClick={() => handleShare("whatsapp")}
          className="border-border/50 text-muted-foreground hover:text-foreground"
          title="Share on WhatsApp"
        >
          <MessageCircle className="w-4 h-4 text-green-500" />
        </Button>
        <Button
          variant="outline"
          size="sm"
          onClick={() => handleShare("instagram")}
          className="border-border/50 text-muted-foreground hover:text-foreground"
          title="Share on Instagram"
        >
          <Instagram className="w-4 h-4 text-pink-500" />
        </Button>
        <Button
          variant="outline"
          size="sm"
          onClick={handleCopy}
          className="border-border/50 text-muted-foreground hover:text-foreground"
          title="Copy to clipboard"
        >
          <Copy className="w-4 h-4" />
        </Button>
      </div>
    );
  }

  return (
    <div className="space-y-3">
      <p className="text-sm font-medium text-foreground">Share on social media:</p>
      <div className="grid grid-cols-2 gap-2">
        {showNativeShare && (
          <Button
            variant="outline"
            onClick={handleNativeShare}
            className="border-border/50 text-muted-foreground hover:text-foreground justify-start"
          >
            <Share2 className="w-4 h-4 mr-2" /> Share
          </Button>
        )}
        <Button
          variant="outline"
          onClick={() => handleShare("twitter")}
          className="border-border/50 text-muted-foreground hover:text-foreground justify-start"
        >
          <Twitter className="w-4 h-4 mr-2" /> Twitter/X
        </Button>
        <Button
          variant="outline"
          onClick={() => handleShare("facebook")}
          className="border-border/50 text-muted-foreground hover:text-foreground justify-start"
        >
          <Facebook className="w-4 h-4 mr-2" /> Facebook
        </Button>
        <Button
          variant="outline"
          onClick={() => handleShare("linkedin")}
          className="border-border/50 text-muted-foreground hover:text-foreground justify-start"
        >
          <Linkedin className="w-4 h-4 mr-2" /> LinkedIn
        </Button>
        <Button
          variant="outline"
          onClick={() => handleShare("whatsapp")}
          className="border-border/50 text-muted-foreground hover:text-foreground justify-start"
        >
          <MessageCircle className="w-4 h-4 mr-2 text-green-500" /> WhatsApp
        </Button>
        <Button
          variant="outline"
          onClick={() => handleShare("instagram")}
          className="border-border/50 text-muted-foreground hover:text-foreground justify-start"
        >
          <Instagram className="w-4 h-4 mr-2 text-pink-500" /> Instagram
        </Button>
        <Button
          variant="outline"
          onClick={handleCopy}
          className="border-border/50 text-muted-foreground hover:text-foreground justify-start"
        >
          <Copy className={`w-4 h-4 mr-2 ${copied ? "text-green-400" : ""}`} />
          {copied ? "Copied!" : "Copy"}
        </Button>
      </div>
    </div>
  );
}
