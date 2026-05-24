import { useState } from "react";
import { trpc } from "@/lib/trpc";
import { useAuth } from "@/_core/hooks/useAuth";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Calendar, Users, Coins } from "lucide-react";
import { toast } from "sonner";

export default function TournamentsPage() {
  const { user } = useAuth();
  const utils = trpc.useUtils();
  const open = trpc.tournaments.listOpen.useQuery();
  const myMemberships = trpc.tournaments.myMemberships.useQuery(undefined, {
    enabled: !!user,
  });
  const payMutation = trpc.tournaments.payEntry.useMutation();
  const [busyId, setBusyId] = useState<number | null>(null);

  const joinedIds = new Set((myMemberships.data ?? []).map((m) => m.tournamentId));

  const handleJoin = async (id: number, cost: number) => {
    if (!confirm(`Spend ${cost} GN to join this tournament?`)) return;
    setBusyId(id);
    try {
      await payMutation.mutateAsync({ tournamentId: id });
      void utils.tournaments.listOpen.invalidate();
      void utils.tournaments.myMemberships.invalidate();
      void utils.chat.unreadCounts.invalidate();
      toast.success("Joined tournament");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to join");
    } finally {
      setBusyId(null);
    }
  };

  return (
    <div className="container max-w-3xl py-8">
      <h1 className="text-2xl font-bold mb-4">Tournaments</h1>
      {open.isLoading && <p className="text-muted-foreground">Loading...</p>}
      {open.data && open.data.length === 0 && (
        <p className="text-muted-foreground">No open tournaments right now.</p>
      )}
      <div className="grid gap-3">
        {(open.data ?? []).map((t) => {
          const joined = joinedIds.has(t.id);
          return (
            <Card key={t.id} className="p-4">
              <div className="flex items-start justify-between gap-4">
                <div className="flex-1 min-w-0">
                  <h2 className="font-semibold">{t.name}</h2>
                  {t.description && (
                    <p className="text-sm text-muted-foreground mt-0.5">{t.description}</p>
                  )}
                  <div className="flex flex-wrap gap-3 mt-2 text-xs text-muted-foreground">
                    <span className="flex items-center gap-1">
                      <Calendar className="w-3.5 h-3.5" />
                      {new Date(t.startsAt).toLocaleDateString()} - {new Date(t.endsAt).toLocaleDateString()}
                    </span>
                    {t.capacity != null && (
                      <span className="flex items-center gap-1">
                        <Users className="w-3.5 h-3.5" />
                        Capacity: {t.capacity}
                      </span>
                    )}
                    <span className="flex items-center gap-1">
                      <Coins className="w-3.5 h-3.5" />
                      Entry: {t.entryCostGn} GN
                    </span>
                  </div>
                </div>
                <div className="shrink-0">
                  {joined ? (
                    <Badge variant="secondary">Joined</Badge>
                  ) : (
                    <Button
                      size="sm"
                      onClick={() => handleJoin(t.id, t.entryCostGn)}
                      disabled={!user || busyId === t.id}
                    >
                      Join ({t.entryCostGn} GN)
                    </Button>
                  )}
                </div>
              </div>
            </Card>
          );
        })}
      </div>
    </div>
  );
}
