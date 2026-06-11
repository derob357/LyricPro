import { useEffect } from "react";
import { ChatTabs } from "@/components/chat/ChatTabs";
import { useMarkAllReadOnClose } from "@/lib/chat/useMarkAllReadOnClose";

export default function ChatPage() {
  const markAllRead = useMarkAllReadOnClose();

  // Zero the unread badge when the user navigates away from the /chat page.
  useEffect(() => {
    return () => {
      markAllRead();
    };
    // markAllRead is stable (useCallback with no deps in the hook).
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <div className="flex flex-col chat-viewport-height">
      <ChatTabs />
    </div>
  );
}
