import type { Participant } from "livekit-client";
import { VideoTile } from "./VideoTile";

interface VideoGridProps {
  participants: Participant[];
}

/**
 * 2×4 max grid (CSS Grid auto-fit), one tile per participant.
 * Empty state shows when no one has joined yet (defensive — the local
 * participant should always be present once connected).
 */
export function VideoGrid({ participants }: VideoGridProps) {
  if (participants.length === 0) {
    return (
      <div className="rounded-lg border border-dashed border-slate-700 p-8 text-center text-slate-400">
        Waiting for players to join…
      </div>
    );
  }

  return (
    <div className="grid gap-3 grid-cols-2 sm:grid-cols-3 md:grid-cols-4">
      {participants.map((p) => (
        <VideoTile key={p.identity} participant={p} />
      ))}
    </div>
  );
}
