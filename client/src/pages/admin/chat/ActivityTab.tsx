import { trpc } from "@/lib/trpc";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { toast } from "sonner";

export function ActivityTab() {
  const utils = trpc.useUtils();
  const flagged = trpc.chat.admin.flaggedMessages.useQuery({ limit: 100 });
  const reviewMut = trpc.chat.admin.markFlaggedReviewed.useMutation();

  const handleReview = async (messageId: number, outcome: "clean" | "delete") => {
    const reason = prompt(`Reason for marking ${outcome}?`);
    if (!reason) return;
    try {
      await reviewMut.mutateAsync({ messageId, outcome, reason });
      void utils.chat.admin.flaggedMessages.invalidate();
      toast.success(`Marked ${outcome}`);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Review failed");
    }
  };

  return (
    <div className="grid gap-2">
      <h2 className="font-semibold text-sm text-muted-foreground">Flagged messages awaiting review</h2>
      {flagged.isLoading && <p className="text-muted-foreground text-sm">Loading...</p>}
      {flagged.data && flagged.data.length === 0 && (
        <p className="text-muted-foreground text-sm">Nothing flagged. Quiet day.</p>
      )}
      {(flagged.data ?? []).map((m) => (
        <Card key={m.id} className="p-3">
          <div className="flex items-start justify-between gap-3">
            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-2 text-xs text-muted-foreground">
                <span>id #{m.id}</span>
                <span>author #{m.authorId}</span>
                <span>{m.scope}</span>
                <Badge variant="secondary">{m.flagStatus}</Badge>
                <span>{new Date(m.createdAt as unknown as string).toLocaleString()}</span>
              </div>
              <p className="text-sm mt-1 break-words">{m.body}</p>
              {m.flagReason && <p className="text-xs text-muted-foreground italic mt-0.5">{m.flagReason}</p>}
            </div>
            <div className="flex flex-col gap-1 shrink-0">
              <Button size="sm" variant="outline" onClick={() => handleReview(m.id, "clean")}>
                Mark clean
              </Button>
              <Button size="sm" variant="destructive" onClick={() => handleReview(m.id, "delete")}>
                Delete
              </Button>
            </div>
          </div>
        </Card>
      ))}
    </div>
  );
}
