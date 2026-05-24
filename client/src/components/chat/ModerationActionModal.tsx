import { useState, useEffect, type FormEvent } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";

export type ModerationAction =
  | { kind: "delete"; messageId: number }
  | { kind: "edit"; messageId: number; currentBody: string }
  | { kind: "ban"; userId: number }
  | { kind: "mute"; userId: number };

export type ModerationActionResult =
  | { kind: "delete"; messageId: number; reason: string }
  | { kind: "edit"; messageId: number; newBody: string; reason: string }
  | { kind: "ban"; userId: number; scope: "global" | "room"; roomId?: number; expiresAt?: string; reason: string }
  | { kind: "mute"; userId: number; scope: "global" | "room"; roomId?: number; flavor: "visible" | "shadow"; expiresAt?: string; reason: string };

interface Props {
  action: ModerationAction | null;
  contextRoomId?: number;  // current chat room — defaults the per-room scope
  onClose: () => void;
  onSubmit: (result: ModerationActionResult) => Promise<void>;
}

export function ModerationActionModal({ action, contextRoomId, onClose, onSubmit }: Props) {
  const [reason, setReason] = useState("");
  const [newBody, setNewBody] = useState("");
  const [scope, setScope] = useState<"global" | "room">("global");
  const [flavor, setFlavor] = useState<"visible" | "shadow">("visible");
  const [expiresAt, setExpiresAt] = useState("");
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    if (action == null) return;
    setReason("");
    setNewBody(action.kind === "edit" ? action.currentBody : "");
    setScope("global");
    setFlavor("visible");
    setExpiresAt("");
    setSubmitting(false);
  }, [action]);

  if (action == null) return null;

  const title =
    action.kind === "delete" ? "Delete message"
    : action.kind === "edit" ? "Edit message"
    : action.kind === "ban" ? "Ban author"
    : "Mute author";

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();
    if (!reason.trim()) return;
    setSubmitting(true);
    try {
      const expiresIso = expiresAt ? new Date(expiresAt).toISOString() : undefined;
      const roomId = scope === "room" ? contextRoomId : undefined;
      if (action.kind === "delete") {
        await onSubmit({ kind: "delete", messageId: action.messageId, reason });
      } else if (action.kind === "edit") {
        await onSubmit({ kind: "edit", messageId: action.messageId, newBody, reason });
      } else if (action.kind === "ban") {
        await onSubmit({ kind: "ban", userId: action.userId, scope, roomId, expiresAt: expiresIso, reason });
      } else {
        await onSubmit({ kind: "mute", userId: action.userId, scope, roomId, flavor, expiresAt: expiresIso, reason });
      }
      onClose();
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
        </DialogHeader>
        <form onSubmit={handleSubmit} className="space-y-3">
          {action.kind === "edit" && (
            <div>
              <Label htmlFor="mod-body">New body</Label>
              <Textarea id="mod-body" value={newBody} onChange={(e) => setNewBody(e.target.value)} rows={3} required maxLength={1000} />
            </div>
          )}
          {(action.kind === "ban" || action.kind === "mute") && (
            <>
              <div>
                <Label htmlFor="mod-scope">Scope</Label>
                <Select value={scope} onValueChange={(v) => setScope(v as "global" | "room")}>
                  <SelectTrigger id="mod-scope">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="global">Global (all chat)</SelectItem>
                    {contextRoomId != null && (
                      <SelectItem value="room">This room only</SelectItem>
                    )}
                  </SelectContent>
                </Select>
              </div>
              {action.kind === "mute" && (
                <div>
                  <Label htmlFor="mod-flavor">Flavor</Label>
                  <Select value={flavor} onValueChange={(v) => setFlavor(v as "visible" | "shadow")}>
                    <SelectTrigger id="mod-flavor">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="visible">Visible (user sees they can't post)</SelectItem>
                      <SelectItem value="shadow">Shadow (user thinks they posted; no one else sees it)</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
              )}
              <div>
                <Label htmlFor="mod-expires">Expires at (optional)</Label>
                <Input id="mod-expires" type="datetime-local" value={expiresAt} onChange={(e) => setExpiresAt(e.target.value)} />
              </div>
            </>
          )}
          <div>
            <Label htmlFor="mod-reason">Reason (required)</Label>
            <Textarea id="mod-reason" value={reason} onChange={(e) => setReason(e.target.value)} rows={2} required minLength={1} />
          </div>
          <DialogFooter>
            <Button type="button" variant="ghost" onClick={onClose} disabled={submitting}>
              Cancel
            </Button>
            <Button type="submit" disabled={submitting || !reason.trim()}>
              {submitting ? "Working..." : "Confirm"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
