import { trpc } from "@/lib/trpc";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { toast } from "sonner";

export function BansTab() {
  const utils = trpc.useUtils();
  const bans = trpc.chat.admin.recentBans.useQuery({ limit: 100 });
  const revokeMut = trpc.chat.admin.revokeBan.useMutation();

  const handleRevoke = async (banId: number) => {
    const reason = prompt("Reason for revoking?");
    if (!reason) return;
    try {
      await revokeMut.mutateAsync({ banId, reason });
      void utils.chat.admin.recentBans.invalidate();
      toast.success("Ban revoked");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Revoke failed");
    }
  };

  return (
    <div className="grid gap-2">
      <h2 className="font-semibold text-sm text-muted-foreground">Active bans &amp; mutes</h2>
      {bans.isLoading && <p className="text-muted-foreground text-sm">Loading...</p>}
      {bans.data && bans.data.length === 0 && (
        <p className="text-muted-foreground text-sm">No active bans or mutes.</p>
      )}
      {(bans.data ?? []).map((b) => {
        const expired = b.expiresAt != null && new Date(b.expiresAt as unknown as string) < new Date();
        return (
          <Card key={b.id} className="p-3">
            <div className="flex items-start justify-between gap-3">
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2 text-xs text-muted-foreground">
                  <span>id #{b.id}</span>
                  <span>user #{b.userId}</span>
                  <Badge variant={b.action === "ban" ? "destructive" : "secondary"}>{b.action}</Badge>
                  <Badge variant="outline">{b.scope}{b.roomId ? ` room=${b.roomId}` : ""}</Badge>
                  {expired && <Badge variant="outline">expired</Badge>}
                  <span>by #{b.createdBy}</span>
                  <span>{new Date(b.createdAt as unknown as string).toLocaleString()}</span>
                </div>
                <p className="text-sm mt-1">{b.reason}</p>
                {b.expiresAt && (
                  <p className="text-xs text-muted-foreground">
                    Expires: {new Date(b.expiresAt as unknown as string).toLocaleString()}
                  </p>
                )}
              </div>
              <Button size="sm" variant="outline" onClick={() => handleRevoke(b.id)}>
                Revoke
              </Button>
            </div>
          </Card>
        );
      })}
    </div>
  );
}
