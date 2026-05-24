import { useState, type FormEvent, type KeyboardEvent } from "react";
import { Send } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";

interface Props {
  onSend: (body: string) => Promise<void>;
  disabledReason?: string | null;
}

const MAX_LENGTH = 1000;

export function ChatComposer({ onSend, disabledReason }: Props) {
  const [draft, setDraft] = useState("");
  const [submitting, setSubmitting] = useState(false);

  const trimmed = draft.trim();
  const disabled = submitting || trimmed.length === 0 || disabledReason != null;

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (disabled) return;
    setSubmitting(true);
    try {
      await onSend(trimmed);
      setDraft("");
    } finally {
      setSubmitting(false);
    }
  };

  const handleKeyDown = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      void submit(e as unknown as FormEvent);
    }
  };

  return (
    <form
      onSubmit={submit}
      className="chat-safe-area-bottom flex items-end gap-2 border-t bg-background px-3 py-2"
    >
      <div className="flex-1">
        <Textarea
          value={draft}
          onChange={(e) => setDraft(e.target.value.slice(0, MAX_LENGTH))}
          onKeyDown={handleKeyDown}
          placeholder={disabledReason ?? "Message..."}
          disabled={disabledReason != null || submitting}
          rows={1}
          className="resize-none min-h-9 max-h-32"
        />
        <div className="flex justify-between text-xs text-muted-foreground pt-0.5">
          <span>{disabledReason}</span>
          <span>{draft.length}/{MAX_LENGTH}</span>
        </div>
      </div>
      <Button type="submit" size="icon" disabled={disabled} aria-label="Send">
        <Send className="h-4 w-4" />
      </Button>
    </form>
  );
}
