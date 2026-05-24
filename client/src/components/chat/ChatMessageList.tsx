import { useEffect, useRef, useState } from "react";
import { StickToBottom } from "use-stick-to-bottom";
import { ChatMessage } from "./ChatMessage";
import { type ChatMessageShape } from "@/lib/chat/chatStore";
import { Button } from "@/components/ui/button";

interface Props {
  messages: ChatMessageShape[];
  viewerId: number | null;
  viewerRole: "user" | "admin" | null;
  onLoadOlder?: () => void;
  hasMoreOlder?: boolean;
  onAdminAction?: (action: import("./ModerationActionModal").ModerationAction) => void;
}

export function ChatMessageList({
  messages,
  viewerId,
  viewerRole,
  onLoadOlder,
  hasMoreOlder,
  onAdminAction,
}: Props) {
  const scrollableRef = useRef<HTMLDivElement | null>(null);
  const [showNewPill, setShowNewPill] = useState(false);
  const [unseenCount, setUnseenCount] = useState(0);
  const lastSeenIdRef = useRef<number>(0);

  useEffect(() => {
    if (messages.length === 0) return;
    const latestId = messages[messages.length - 1].id;
    if (lastSeenIdRef.current === 0) {
      lastSeenIdRef.current = latestId;
      return;
    }
    if (latestId > lastSeenIdRef.current) {
      const delta = messages.filter((m) => m.id > lastSeenIdRef.current).length;
      setUnseenCount((c) => c + delta);
      setShowNewPill(true);
      lastSeenIdRef.current = latestId;
    }
  }, [messages]);

  const handleScrollToBottom = () => {
    const el = scrollableRef.current;
    if (el) el.scrollTo({ top: el.scrollHeight, behavior: "smooth" });
    setShowNewPill(false);
    setUnseenCount(0);
  };

  return (
    <div className="relative flex-1 min-h-0">
      <StickToBottom className="h-full" resize="smooth" initial="smooth">
        <StickToBottom.Content
          className="flex flex-col py-2"
          // @ts-expect-error — `ref` is passed through to the scroll container
          ref={scrollableRef}
        >
          {hasMoreOlder && (
            <div className="flex justify-center py-2">
              <Button variant="outline" size="sm" onClick={onLoadOlder}>
                Load older messages
              </Button>
            </div>
          )}
          {messages.map((m) => (
            <ChatMessage
              key={m.id}
              message={m}
              viewerId={viewerId}
              viewerRole={viewerRole}
              onAdminAction={onAdminAction}
            />
          ))}
        </StickToBottom.Content>
      </StickToBottom>

      {showNewPill && (
        <button
          onClick={handleScrollToBottom}
          className="absolute bottom-3 left-1/2 -translate-x-1/2 rounded-full bg-primary px-4 py-1.5 text-sm text-primary-foreground shadow-md hover:bg-primary/90"
        >
          {unseenCount} new message{unseenCount === 1 ? "" : "s"} - jump to bottom
        </button>
      )}
    </div>
  );
}
