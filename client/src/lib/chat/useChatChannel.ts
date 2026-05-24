// Subscribes the local Supabase Realtime client to one chat:* channel and
// dispatches incoming broadcasts into the chatStore. Cleans up on unmount.
// Reconnect-gap fill is the caller's responsibility (use the
// trpc.chat.fetchSince query keyed by lastSeenSeq).
import { useEffect } from "react";
import { supabase } from "@/lib/supabase";
import { upsertMessage, applyMessageUpdate, type ChatMessageShape } from "./chatStore";

type BroadcastPayload = {
  event?: string;
  payload?: { record?: Record<string, unknown>; old_record?: Record<string, unknown> };
};

function rowToShape(row: Record<string, unknown>): ChatMessageShape {
  return {
    id: Number(row.id),
    scope: row.scope as ChatMessageShape["scope"],
    roomId: row.room_id == null ? null : Number(row.room_id),
    authorId: Number(row.author_id),
    body: String(row.body),
    postedWhileShadowBanned: Boolean(row.posted_while_shadow_banned),
    flagStatus: row.flag_status as ChatMessageShape["flagStatus"],
    editedAt: row.edited_at == null ? null : String(row.edited_at),
    deletedAt: row.deleted_at == null ? null : String(row.deleted_at),
    deletedBy: row.deleted_by == null ? null : Number(row.deleted_by),
    deletedReason: row.deleted_reason == null ? null : String(row.deleted_reason),
    createdAt: String(row.createdAt ?? row.created_at),
  };
}

export function useChatChannel(topic: string | null): void {
  useEffect(() => {
    if (!topic) return;

    const ch = supabase.channel(topic, { config: { private: true } });

    ch.on("broadcast", { event: "message_inserted" }, ({ payload }: BroadcastPayload) => {
      const rec = payload?.record;
      if (rec) upsertMessage(topic, rowToShape(rec));
    });
    ch.on("broadcast", { event: "message_updated" }, ({ payload }: BroadcastPayload) => {
      const rec = payload?.record;
      if (rec) applyMessageUpdate(topic, rowToShape(rec));
    });

    ch.subscribe();

    return () => {
      void supabase.removeChannel(ch);
    };
  }, [topic]);
}
