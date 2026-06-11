import { useLocation } from "wouter";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { Button } from "@/components/ui/button";

export const SONG_NAV_KEY = "lyricpro_admin_song_nav";

export interface SongNavState {
  ids: number[];
  label: string;
}

/** Read the nav state from sessionStorage. Returns null if absent or malformed. */
export function readSongNavState(): SongNavState | null {
  try {
    const raw = sessionStorage.getItem(SONG_NAV_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as unknown;
    if (
      parsed &&
      typeof parsed === "object" &&
      Array.isArray((parsed as SongNavState).ids) &&
      typeof (parsed as SongNavState).label === "string"
    ) {
      return parsed as SongNavState;
    }
    return null;
  } catch {
    return null;
  }
}

interface Props {
  currentId: number;
}

/**
 * Renders a compact Prev / position / Next cluster when the current song id
 * is present in the sessionStorage nav list written by SongsList.
 * Renders nothing if the key is absent or the id is not in the list.
 */
export function SongNavCluster({ currentId }: Props) {
  const [, navigate] = useLocation();
  const nav = readSongNavState();

  if (!nav) return null;

  const idx = nav.ids.indexOf(currentId);
  if (idx === -1) return null;

  const total = nav.ids.length;
  const prevId = idx > 0 ? nav.ids[idx - 1] : null;
  const nextId = idx < total - 1 ? nav.ids[idx + 1] : null;

  function go(id: number) {
    navigate(`/admin/songs/${id}`);
  }

  return (
    <div className="flex items-center gap-2 mb-4" data-testid="song-nav-cluster">
      <Button
        variant="outline"
        size="sm"
        disabled={prevId === null}
        onClick={() => prevId !== null && go(prevId)}
        aria-label="Previous song"
        data-testid="song-nav-prev"
        className="gap-1"
      >
        <ChevronLeft className="w-4 h-4" />
        Prev
      </Button>
      <span className="text-xs text-muted-foreground" data-testid="song-nav-position">
        {idx + 1} of {total}
      </span>
      <Button
        variant="outline"
        size="sm"
        disabled={nextId === null}
        onClick={() => nextId !== null && go(nextId)}
        aria-label="Next song"
        data-testid="song-nav-next"
        className="gap-1"
      >
        Next
        <ChevronRight className="w-4 h-4" />
      </Button>
      {nav.label && (
        <span className="text-xs text-muted-foreground ml-1" data-testid="song-nav-label">
          {nav.label}
        </span>
      )}
    </div>
  );
}
