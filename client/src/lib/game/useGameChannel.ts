// Subscribes to the private game:{roomId} Supabase Realtime channel and calls
// onEvent(eventName) for each broadcast so the caller can refetch getMatchState.
// Mirrors useChatChannel. No-ops when roomId is null.
import { useEffect } from "react";
import { supabase } from "@/lib/supabase";

export type GameEvent = "round_started" | "player_answered" | "round_revealed" | "match_complete";

export function useGameChannel(roomId: number | null, onEvent: (e: GameEvent) => void): void {
  useEffect(() => {
    if (roomId == null) return;
    const topic = `game:${roomId}`;
    const ch = supabase.channel(topic, { config: { private: true } });
    const events: GameEvent[] = ["round_started", "player_answered", "round_revealed", "match_complete"];
    for (const ev of events) ch.on("broadcast", { event: ev }, () => onEvent(ev));
    ch.subscribe();
    return () => { void supabase.removeChannel(ch); };
  }, [roomId, onEvent]);
}
