// Formats a whole-second count as m:ss (e.g. 90 -> "1:30", 5 -> "0:05").
// Used by the gameplay countdown so timers above 59s read correctly.
export function formatMMSS(totalSeconds: number): string {
  const s = Math.max(0, Math.floor(totalSeconds));
  const m = Math.floor(s / 60);
  const rem = s % 60;
  return `${m}:${String(rem).padStart(2, "0")}`;
}
