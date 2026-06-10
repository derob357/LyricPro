/**
 * AnimatedGnBalance — tweens a Golden Notes balance number between values
 * and shows a floating +N/−N delta indicator.
 *
 * Tween implementation: setInterval (not rAF) — chosen for fake-timer
 * compatibility. vi.useFakeTimers() stubs setInterval so tests can drive
 * the tween synchronously with vi.advanceTimersByTime(). rAF is NOT
 * stubbed by vi.useFakeTimers in jsdom, which would make the tween
 * untestable without a separate rAF stub setup in every test.
 */
import { useEffect, useRef, useState } from "react";

interface Props {
  value: number;
  className?: string;
}

function prefersReducedMotion(): boolean {
  if (typeof window === "undefined" || typeof window.matchMedia !== "function") return false;
  return window.matchMedia("(prefers-reduced-motion: reduce)").matches;
}

export default function AnimatedGnBalance({ value, className }: Props) {
  const [displayed, setDisplayed] = useState(value);
  const [delta, setDelta] = useState<number | null>(null);
  const prevRef = useRef(value);
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const deltaTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    const from = prevRef.current;
    const diff = value - from;
    if (diff === 0) return;

    // Update prevRef immediately so back-to-back value changes delta
    // correctly from the last *intended* value (not the tween position).
    prevRef.current = value;

    // Update delta indicator
    setDelta(diff);

    // Clear any existing delta-unmount timer so back-to-back changes
    // keep the most-recent delta visible.
    if (deltaTimerRef.current !== null) clearTimeout(deltaTimerRef.current);
    deltaTimerRef.current = setTimeout(() => setDelta(null), 1200);

    if (prefersReducedMotion()) {
      // Instant jump; delta still shown above.
      setDisplayed(value);
      return;
    }

    // Clear any in-progress tween before starting a new one.
    if (intervalRef.current !== null) clearInterval(intervalRef.current);

    const DURATION = 800; // ms
    const TICK = 16;      // ~60 fps
    const steps = Math.max(1, Math.round(DURATION / TICK));
    let step = 0;

    intervalRef.current = setInterval(() => {
      step++;
      const progress = step / steps;
      const tweened = Math.round(from + diff * Math.min(progress, 1));
      setDisplayed(tweened);
      if (step >= steps) {
        clearInterval(intervalRef.current!);
        intervalRef.current = null;
        setDisplayed(value);
      }
    }, TICK);

    return () => {
      if (intervalRef.current !== null) {
        clearInterval(intervalRef.current);
        intervalRef.current = null;
      }
      if (deltaTimerRef.current !== null) {
        clearTimeout(deltaTimerRef.current);
        deltaTimerRef.current = null;
      }
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [value]);

  const deltaPositive = delta !== null && delta > 0;
  const deltaNegative = delta !== null && delta < 0;

  return (
    <span className={`relative inline-flex items-center${className ? ` ${className}` : ""}`}>
      <span data-testid="gn-balance">{displayed}</span>
      {delta !== null && (
        <span
          data-testid="gn-delta"
          className={[
            "absolute -top-4 left-1/2 -translate-x-1/2 text-xs font-semibold pointer-events-none select-none",
            "animate-[fadeUpOut_1.2s_ease-out_forwards]",
            deltaPositive ? "text-green-400" : deltaNegative ? "text-orange-400" : "text-muted-foreground",
          ].join(" ")}
        >
          {deltaPositive ? `+${delta}` : `${delta}`}
        </span>
      )}
    </span>
  );
}
