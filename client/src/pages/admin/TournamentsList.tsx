import { Link } from "wouter";
import { trpc } from "@/lib/trpc";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Plus } from "lucide-react";

export default function TournamentsList() {
  // For Phase 4 v1, we list open tournaments. A future enhancement
  // surfaces draft + completed + cancelled via additional procedures.
  const open = trpc.tournaments.listOpen.useQuery();

  return (
    <div className="container max-w-3xl py-8">
      <div className="flex items-center justify-between mb-4">
        <h1 className="text-2xl font-bold">Tournaments (Admin)</h1>
        <Button asChild>
          <Link to="/admin/tournaments/new">
            <Plus className="w-4 h-4 mr-1" /> New tournament
          </Link>
        </Button>
      </div>
      <div className="grid gap-2">
        {(open.data ?? []).map((t) => (
          <Card key={t.id} className="p-3 flex items-center justify-between">
            <div>
              <Link to={`/admin/tournaments/${t.id}`} className="font-medium hover:underline">
                {t.name}
              </Link>
              <div className="text-xs text-muted-foreground">
                {t.entryCostGn} GN entry - capacity {t.capacity ?? "unlimited"}
              </div>
            </div>
            <Badge>{t.status}</Badge>
          </Card>
        ))}
        {(open.data ?? []).length === 0 && (
          <p className="text-muted-foreground text-sm">No open tournaments. Create one to get started.</p>
        )}
      </div>
    </div>
  );
}
