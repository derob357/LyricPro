import { useParams } from "wouter";
import { trpc } from "@/lib/trpc";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { toast } from "sonner";

export default function TournamentEdit() {
  const params = useParams<{ id: string }>();
  const id = parseInt(params.id, 10);
  const utils = trpc.useUtils();
  const tournament = trpc.tournaments.getById.useQuery({ id });
  const openMut = trpc.tournaments.admin.openTournament.useMutation();
  const startMut = trpc.tournaments.admin.startTournament.useMutation();
  const completeMut = trpc.tournaments.admin.completeTournament.useMutation();
  const cancelMut = trpc.tournaments.admin.cancelTournament.useMutation();

  if (!tournament.data) return <div className="p-8">Loading...</div>;
  const t = tournament.data.tournament;

  const run = async (fn: () => Promise<unknown>, label: string) => {
    try {
      await fn();
      void utils.tournaments.getById.invalidate({ id });
      void utils.tournaments.listOpen.invalidate();
      toast.success(`${label} complete`);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : `${label} failed`);
    }
  };

  return (
    <div className="container max-w-xl py-8">
      <div className="flex items-center justify-between mb-4">
        <h1 className="text-2xl font-bold">{t.name}</h1>
        <Badge>{t.status}</Badge>
      </div>
      <Card className="p-4 space-y-2">
        <div className="text-sm"><strong>Entry cost:</strong> {t.entryCostGn} GN</div>
        <div className="text-sm"><strong>Capacity:</strong> {t.capacity ?? "unlimited"}</div>
        <div className="text-sm"><strong>Roster size:</strong> {tournament.data.rosterSize}</div>
        <div className="text-sm">
          <strong>Window:</strong>{" "}
          {new Date(t.startsAt).toLocaleString()} - {new Date(t.endsAt).toLocaleString()}
        </div>
        {t.description && <div className="text-sm whitespace-pre-line">{t.description}</div>}
      </Card>

      <div className="mt-4 flex flex-wrap gap-2">
        {t.status === "draft" && (
          <Button onClick={() => run(() => openMut.mutateAsync({ id }), "Open")} disabled={openMut.isPending}>
            Open tournament
          </Button>
        )}
        {t.status === "open" && (
          <Button onClick={() => run(() => startMut.mutateAsync({ id }), "Start")} disabled={startMut.isPending}>
            Start tournament (lock roster)
          </Button>
        )}
        {t.status === "in_progress" && (
          <Button onClick={() => run(() => completeMut.mutateAsync({ id }), "Complete")} disabled={completeMut.isPending}>
            Complete tournament
          </Button>
        )}
        {(t.status === "draft" || t.status === "open" || t.status === "in_progress") && (
          <Button
            variant="destructive"
            onClick={() => {
              const reason = prompt("Cancellation reason?");
              if (!reason) return;
              void run(() => cancelMut.mutateAsync({ id, reason }), "Cancel");
            }}
            disabled={cancelMut.isPending}
          >
            Cancel tournament (refund all paid)
          </Button>
        )}
      </div>
    </div>
  );
}
