import { type ChatMessageShape } from "@/lib/chat/chatStore";
import { MoreHorizontal } from "lucide-react";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Button } from "@/components/ui/button";
import { type ModerationAction } from "./ModerationActionModal";

interface Props {
  message: ChatMessageShape;
  viewerId: number | null;
  viewerRole: "user" | "admin" | "vendor" | null;
  onAdminAction?: (action: ModerationAction) => void;
}

export function ChatMessage({
  message,
  viewerId,
  viewerRole,
  onAdminAction,
}: Props) {
  const isMine = viewerId != null && message.authorId === viewerId;
  const isAdmin = viewerRole === "admin";
  const isDeleted = message.deletedAt != null;

  if (isDeleted && !isAdmin && !isMine) {
    return (
      <div className="flex items-center px-3 py-1 text-xs text-muted-foreground italic">
        Message removed by admin.
      </div>
    );
  }

  return (
    <div
      data-message-id={message.id}
      className={`group flex flex-col gap-0.5 px-3 py-1.5 hover:bg-muted/30 ${
        isMine ? "items-end" : "items-start"
      }`}
    >
      <div className="flex items-center gap-2 text-xs text-muted-foreground">
        <span>User #{message.authorId}</span>
        <span>{new Date(message.createdAt).toLocaleTimeString()}</span>
        {message.editedAt && <span>(edited)</span>}
        {isAdmin && (
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button
                variant="ghost"
                size="icon"
                className="h-5 w-5 opacity-0 group-hover:opacity-100"
                aria-label="Admin actions"
              >
                <MoreHorizontal className="h-3.5 w-3.5" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align={isMine ? "end" : "start"}>
              <DropdownMenuItem onClick={() => onAdminAction?.({ kind: "delete", messageId: message.id })}>
                Delete message
              </DropdownMenuItem>
              <DropdownMenuItem onClick={() => onAdminAction?.({ kind: "edit", messageId: message.id, currentBody: message.body })}>
                Edit message
              </DropdownMenuItem>
              <DropdownMenuItem onClick={() => onAdminAction?.({ kind: "mute", userId: message.authorId })}>
                Mute author
              </DropdownMenuItem>
              <DropdownMenuItem
                onClick={() => onAdminAction?.({ kind: "ban", userId: message.authorId })}
                className="text-destructive"
              >
                Ban author
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        )}
      </div>
      <div
        className={`max-w-[80%] rounded-2xl px-3 py-1.5 text-sm ${
          isMine ? "bg-primary text-primary-foreground" : "bg-muted text-foreground"
        } ${isDeleted ? "italic opacity-60" : ""}`}
      >
        {isDeleted ? "[message removed by admin]" : message.body}
      </div>
    </div>
  );
}
