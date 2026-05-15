import { useEffect, useRef } from "react";
import { useLocation } from "wouter";
import { motion } from "framer-motion";
import { trpc } from "@/lib/trpc";
import { Button } from "@/components/ui/button";
import { ChevronRight, Play } from "lucide-react";

export function HeroBanner() {
  const [, navigate] = useLocation();
  const impressionSent = useRef(false);

  const { data: banner, isLoading } = trpc.banners.getActive.useQuery(undefined, {
    refetchOnWindowFocus: false,
    staleTime: 5 * 60_000,
  });

  const trackImpression = trpc.banners.trackImpression.useMutation();
  const trackClick = trpc.banners.trackClick.useMutation();

  useEffect(() => {
    if (banner && !impressionSent.current) {
      impressionSent.current = true;
      trackImpression.mutate({ bannerId: banner.id });
    }
  }, [banner]);

  const handleCtaClick = () => {
    if (banner) {
      trackClick.mutate({ bannerId: banner.id });
      const action = banner.ctaAction;
      if (action.startsWith("http")) {
        window.open(action, "_blank", "noopener");
      } else {
        navigate(action);
      }
    }
  };

  if (isLoading) return null;

  // ── Default promo when no banner is active ──
  if (!banner) {
    return (
      <DefaultBanner onClick={() => navigate("/setup")} />
    );
  }

  const badgeColor = banner.badgeColor ?? "#EF4444";

  // ── Full cinematic partner banner ──
  return (
    <motion.div
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ delay: 0.15, duration: 0.5 }}
      className="relative overflow-hidden rounded-2xl sm:rounded-3xl cursor-pointer group"
      style={{ background: "linear-gradient(135deg, #1a0a2e, #0a1628)" }}
      onClick={handleCtaClick}
    >
      {/* Top gradient accent line */}
      <div
        className="absolute top-0 left-0 right-0 h-[2px]"
        style={{
          background: `linear-gradient(90deg, transparent 5%, #8B5CF6, #F59E0B, ${badgeColor}, transparent 95%)`,
        }}
      />

      {/* Stage lighting from above */}
      <div
        className="absolute top-0 left-0 right-0 h-40 pointer-events-none"
        style={{
          background: "linear-gradient(180deg, rgba(139,92,246,0.06), transparent)",
        }}
      />

      {/* Red ambient bleed from right edge */}
      <div
        className="absolute top-0 right-0 w-1/2 h-full pointer-events-none"
        style={{
          background: `radial-gradient(ellipse at 90% 50%, ${badgeColor}18, transparent 70%)`,
        }}
      />

      {/* Purple ambient from left */}
      <div
        className="absolute bottom-0 left-0 w-1/3 h-full pointer-events-none"
        style={{
          background: "radial-gradient(ellipse at 10% 80%, rgba(139,92,246,0.06), transparent 60%)",
        }}
      />

      <div className="relative p-6 sm:p-8 md:p-10">
        {/* Badge row */}
        <div className="flex items-center gap-3 mb-4">
          <span className="inline-flex items-center gap-2 text-xs font-semibold uppercase tracking-wider">
            <span
              className="w-2.5 h-2.5 rounded-full animate-pulse"
              style={{ backgroundColor: badgeColor, boxShadow: `0 0 8px ${badgeColor}80` }}
            />
            <span style={{ color: badgeColor }}>
              {banner.badgeText ?? "Featured"}
            </span>
          </span>
          {banner.partnerName && (
            <>
              <span className="text-muted-foreground/20">•</span>
              <div className="flex items-center gap-2">
                <div
                  className="w-5 h-5 rounded flex items-center justify-center text-[7px] font-black text-white"
                  style={{ backgroundColor: badgeColor }}
                >
                  iH
                </div>
                <span className="text-xs text-muted-foreground/70 uppercase tracking-widest font-medium">
                  Presented by {banner.partnerName}
                </span>
              </div>
            </>
          )}
        </div>

        {/* Content row */}
        <div className="flex items-center gap-6">
          <div className="flex-1 min-w-0">
            {/* Title */}
            <h2 className="text-2xl sm:text-3xl md:text-4xl font-black text-foreground leading-tight mb-2 font-display">
              {banner.title}
            </h2>

            {/* Subtitle */}
            {banner.subtitle && (
              <p className="text-sm sm:text-base text-muted-foreground leading-relaxed mb-5 max-w-lg">
                {banner.subtitle}
              </p>
            )}

            {/* CTA row */}
            <div className="flex items-center gap-4">
              <Button
                className="bg-gradient-to-r from-purple-500 to-amber-500 text-white font-bold text-sm sm:text-base px-7 py-3 h-auto rounded-xl hover:brightness-110 transition-all shadow-[0_0_30px_rgba(139,92,246,0.25)]"
                onClick={(e) => {
                  e.stopPropagation();
                  handleCtaClick();
                }}
              >
                {banner.ctaText} <ChevronRight className="w-4 h-4 ml-1.5" />
              </Button>
              <button
                className="text-sm text-purple-300/70 hover:text-purple-300 transition-colors hidden sm:inline-flex items-center gap-1"
                onClick={(e) => { e.stopPropagation(); handleCtaClick(); }}
              >
                See Prizes <span className="text-xs">→</span>
              </button>
            </div>
          </div>

          {/* Image emoji — large cinematic */}
          {banner.imageEmoji && (
            <div
              className="w-20 h-20 sm:w-24 sm:h-24 md:w-28 md:h-28 rounded-2xl flex items-center justify-center shrink-0 text-5xl sm:text-6xl md:text-7xl"
              style={{
                background: `linear-gradient(135deg, ${badgeColor}30, ${badgeColor}10)`,
                boxShadow: `0 0 50px ${badgeColor}20`,
              }}
            >
              {banner.imageEmoji}
            </div>
          )}
        </div>
      </div>
    </motion.div>
  );
}

// ── Fallback banner when no partner content is active ──
function DefaultBanner({ onClick }: { onClick: () => void }) {
  return (
    <motion.div
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ delay: 0.15, duration: 0.5 }}
      className="relative overflow-hidden rounded-2xl sm:rounded-3xl cursor-pointer group"
      style={{ background: "linear-gradient(135deg, #1a0a2e, #0a1628)" }}
      onClick={onClick}
    >
      <div
        className="absolute top-0 left-0 right-0 h-[2px]"
        style={{
          background: "linear-gradient(90deg, transparent 10%, #8B5CF6, #F59E0B, transparent 90%)",
        }}
      />
      <div
        className="absolute top-0 left-0 right-0 h-32 pointer-events-none"
        style={{ background: "linear-gradient(180deg, rgba(139,92,246,0.06), transparent)" }}
      />
      <div className="relative p-6 sm:p-8 md:p-10 flex items-center gap-6">
        <div className="flex-1">
          <div className="flex items-center gap-2 mb-3">
            <span className="w-2 h-2 rounded-full bg-primary" />
            <span className="text-xs font-semibold text-primary uppercase tracking-wider">AI-Powered Trivia</span>
          </div>
          <h2 className="text-2xl sm:text-3xl font-black text-foreground leading-tight mb-2 font-display">
            Test Your Music Knowledge
          </h2>
          <p className="text-sm text-muted-foreground leading-relaxed mb-5">
            834 songs across 9 genres and 7 decades. How well do you know your lyrics?
          </p>
          <Button className="bg-gradient-to-r from-purple-500 to-amber-500 text-white font-bold px-7 py-3 h-auto rounded-xl hover:brightness-110 transition-all shadow-[0_0_30px_rgba(139,92,246,0.25)]">
            <Play className="w-4 h-4 mr-2" /> Start Playing <ChevronRight className="w-4 h-4 ml-1" />
          </Button>
        </div>
        <div
          className="w-20 h-20 sm:w-24 sm:h-24 rounded-2xl flex items-center justify-center shrink-0 text-5xl sm:text-6xl"
          style={{ background: "rgba(139,92,246,0.12)" }}
        >
          🎵
        </div>
      </div>
    </motion.div>
  );
}
