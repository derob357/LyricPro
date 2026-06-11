import { useEffect, useRef, useState } from "react";
import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { ChatTabs } from "./ChatTabs";
import { useMarkAllReadOnClose } from "@/lib/chat/useMarkAllReadOnClose";

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

function useIsMobile(): boolean {
  const [mobile, setMobile] = useState(false);
  useEffect(() => {
    const mq = window.matchMedia("(max-width: 767px)");
    const update = () => setMobile(mq.matches);
    update();
    mq.addEventListener("change", update);
    return () => mq.removeEventListener("change", update);
  }, []);
  return mobile;
}

export function ChatPanel({ open, onOpenChange }: Props) {
  const mobile = useIsMobile();
  const markAllRead = useMarkAllReadOnClose();

  // Detect the open → closed transition so we can zero the unread badge.
  // We track the previous `open` value; when it flips true→false we fire
  // markAllRead (regardless of how the panel was closed: close button,
  // backdrop click, or keyboard Escape).
  const prevOpenRef = useRef(open);
  useEffect(() => {
    const wasOpen = prevOpenRef.current;
    prevOpenRef.current = open;
    if (wasOpen && !open) {
      markAllRead();
    }
  }, [open, markAllRead]);

  if (mobile) {
    // Mobile takes the full-page route at /chat — Panel is desktop-only.
    return null;
  }
  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent side="right" className="w-[440px] max-w-full p-0 flex flex-col">
        <SheetHeader className="border-b px-4 py-3">
          <SheetTitle>Chat</SheetTitle>
        </SheetHeader>
        <div className="flex-1 min-h-0">
          <ChatTabs />
        </div>
      </SheetContent>
    </Sheet>
  );
}
