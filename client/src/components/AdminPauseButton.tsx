// Admin-only floating Pause/Play button. Renders nothing for non-admins.
// When toggled on, sets a global flag that pauses CSS animations everywhere
// (via index.css [data-paused="true"] rule) and tells the gameplay timer to
// skip ticks. Persists across reloads via lib/pauseState.

import { Pause, Play } from "lucide-react";
import { useAuth } from "@/_core/hooks/useAuth";
import { setPaused, usePaused } from "@/lib/pauseState";

export function AdminPauseButton() {
  const { user } = useAuth();
  const paused = usePaused();

  if (user?.role !== "admin") return null;

  return (
    <button
      type="button"
      onClick={() => setPaused(!paused)}
      title={paused ? "Resume — admin freeze active" : "Pause — freeze animations and game timer (admin)"}
      aria-label={paused ? "Resume admin freeze" : "Pause admin freeze"}
      className="fixed bottom-4 right-4 z-[60] w-12 h-12 rounded-full border border-border bg-card shadow-lg hover:bg-primary/10 flex items-center justify-center text-foreground transition-colors"
    >
      {paused ? <Play className="w-5 h-5" /> : <Pause className="w-5 h-5" />}
    </button>
  );
}
