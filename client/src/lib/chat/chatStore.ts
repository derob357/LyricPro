// Minimal in-memory cache of messages per channel topic. Indexed by message
// id so realtime echoes can be deduped against optimistic inserts. NOT a
// React-Query cache — that lives separately for the initial / older fetch
// queries; this store only holds live-streamed messages within a session.
import { useSyncExternalStore } from "react";

export interface ChatMessageShape {
  id: number;
  scope: "global" | "tournament" | "friends";
  roomId: number | null;
  authorId: number;
  body: string;
  postedWhileShadowBanned: boolean;
  flagStatus: "clean" | "flagged" | "flagged_high_confidence" | "reviewed_clean";
  editedAt: string | null;
  deletedAt: string | null;
  deletedBy: number | null;
  deletedReason: string | null;
  createdAt: string;
}

type Topic = string;

const subscribers = new Map<Topic, Set<() => void>>();
const messages = new Map<Topic, Map<number, ChatMessageShape>>();

function notify(topic: Topic): void {
  const subs = subscribers.get(topic);
  if (!subs) return;
  subs.forEach((cb) => cb());
}

export function upsertMessage(topic: Topic, msg: ChatMessageShape): void {
  if (!messages.has(topic)) messages.set(topic, new Map());
  messages.get(topic)!.set(msg.id, msg);
  notify(topic);
}

export function applyMessageUpdate(topic: Topic, msg: ChatMessageShape): void {
  upsertMessage(topic, msg);
}

export function getMessages(topic: Topic): ChatMessageShape[] {
  const m = messages.get(topic);
  if (!m) return [];
  return Array.from(m.values()).sort((a, b) => a.id - b.id);
}

export function subscribe(topic: Topic, cb: () => void): () => void {
  if (!subscribers.has(topic)) subscribers.set(topic, new Set());
  subscribers.get(topic)!.add(cb);
  return () => {
    subscribers.get(topic)?.delete(cb);
  };
}

export function useChatMessages(topic: Topic): ChatMessageShape[] {
  return useSyncExternalStore(
    (cb) => subscribe(topic, cb),
    () => getMessages(topic),
    () => getMessages(topic),
  );
}

export function clearTopic(topic: Topic): void {
  messages.delete(topic);
  notify(topic);
}
