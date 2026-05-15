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

  // Default promo card when no banner is active
  if (!banner) {
    return (
      <motion.div
        initial={{ opacity: 0, y: 16 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ delay: 0.2 }}
        className="relative overflow-hidden rounded-2xl cursor-pointer group"
        style={{ background: "linear-gradient(135deg, #12082a, #0c1424)" }}
        onClick={() => navigate("/setup")}
      >
        {/* Top glow line */}
        <div className="card-glow-line-partner" />

        {/* Red ambient bleed */}
        <div
          className="absolute inset-0 pointer-events-none"
          style={{
            background:
              "radial-gradient(ellipse at 90% 50%, rgba(198,0,43,0.1), transparent 70%)",
          }}
        />

        <div className="relative p-5 flex items-center gap-4">
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2 mb-1.5">
              <span className="inline-flex items-center gap-1.5 text-xs font-medium text-purple-300/80">
                <span
                  className="w-1.5 h-1.5 rounded-full"
                  style={{ backgroundColor: "#8B5CF6" }}
                />
                Featured
              </span>
            </div>
            <h3 className="text-lg font-bold text-foreground leading-snug mb-0.5">
              Play LyricPro
            </h3>
            <p className="text-xs text-muted-foreground line-clamp-1">
              Test your music knowledge across every genre and decade.
            </p>
            <Button
              size="sm"
              className="mt-3 bg-gradient-to-r from-purple-500 to-amber-500 text-white font-semibold text-xs px-4 py-1.5 h-auto rounded-lg hover:brightness-110 transition-all"
            >
              Play Now <ChevronRight className="w-3.5 h-3.5 ml-1" />
            </Button>
          </div>
          <div
            className="w-14 h-14 rounded-xl flex items-center justify-center text-3xl shrink-0"
            style={{ backgroundColor: "rgba(139, 92, 246, 0.15)" }}
          >
            <Play className="w-7 h-7 text-primary" />
          </div>
        </div>
      </motion.div>
    );
  }

  return (
    <motion.div
      initial={{ opacity: 0, y: 16 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ delay: 0.2 }}
      className="relative overflow-hidden rounded-2xl cursor-pointer group"
      style={{ background: "linear-gradient(135deg, #12082a, #0c1424)" }}
      onClick={handleCtaClick}
    >
      {/* Top glow line */}
      <div className="card-glow-line-partner" />

      {/* Red ambient bleed */}
      <div
        className="absolute inset-0 pointer-events-none"
        style={{
          background:
            "radial-gradient(ellipse at 90% 50%, rgba(198,0,43,0.1), transparent 70%)",
        }}
      />

      <div className="relative p-6 sm:p-8 flex items-center gap-5">
        <div className="flex-1 min-w-0">
          {/* Badge + Partner */}
          <div className="flex items-center gap-3 mb-3">
            <span className="inline-flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wider">
              <span
                className="w-2 h-2 rounded-full animate-pulse"
                style={{ backgroundColor: banner.badgeColor ?? "#EF4444" }}
              />
              <span style={{ color: banner.badgeColor ?? "#EF4444" }}>
                {banner.badgeText ?? "Featured"}
              </span>
            </span>
            {banner.partnerName && (
              <>
                <span className="text-muted-foreground/30">•</span>
                <span className="text-xs text-muted-foreground/60 uppercase tracking-widest">
                  Presented by {banner.partnerName}
                </span>
              </>
            )}
          </div>

          {/* Title */}
          <h3 className="text-xl sm:text-2xl font-extrabold text-foreground leading-snug mb-2">
            {banner.title}
          </h3>

          {/* Subtitle */}
          {banner.subtitle && (
            <p className="text-sm text-muted-foreground line-clamp-2 leading-relaxed mb-4">
              {banner.subtitle}
            </p>
          )}

          {/* CTA buttons */}
          <div className="flex items-center gap-3">
            <Button
              className="bg-gradient-to-r from-purple-500 to-amber-500 text-white font-semibold text-sm px-6 py-2.5 h-auto rounded-xl hover:brightness-110 transition-all shadow-[0_0_24px_rgba(139,92,246,0.2)]"
              onClick={(e) => {
                e.stopPropagation();
                handleCtaClick();
              }}
            >
              {banner.ctaText} <ChevronRight className="w-4 h-4 ml-1.5" />
            </Button>
            <span className="text-xs text-muted-foreground/50 hidden sm:inline">
              Click anywhere on this banner
            </span>
          </div>
        </div>

        {/* Image emoji or placeholder */}
        {banner.imageEmoji && (
          <div
            className="w-16 h-16 sm:w-20 sm:h-20 rounded-2xl flex items-center justify-center text-4xl sm:text-5xl shrink-0"
            style={{
              backgroundColor: `${banner.badgeColor ?? "#EF4444"}22`,
              boxShadow: `0 0 40px ${banner.badgeColor ?? "#EF4444"}15`,
            }}
          >
            {banner.imageEmoji}
          </div>
        )}
      </div>
    </motion.div>
  );
}
