import { Link, useLocation } from "wouter";
import { useAuth } from "@/_core/hooks/useAuth";
import { trpc } from "@/lib/trpc";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Plus, Rocket } from "lucide-react";
import { useState } from "react";

export default function CuratedSetsList() {
  const { user } = useAuth();
  const [, navigate] = useLocation();
  const { data, isLoading, refetch } = trpc.adminCuratedSets.list.useQuery({}, { enabled: user?.role === "admin" });
  const launch = trpc.adminCuratedSets.launch.useMutation();
  const [launched, setLaunched] = useState<{ code: string; dropped: number } | null>(null);

  if (user?.role !== "admin") return <div className="p-8 text-center text-red-600 font-semibold">Access Denied: Admin only</div>;

  async function onLaunch(id: number) {
    const res = await launch.mutateAsync({ setId: id, mode: "multiplayer" });
    setLaunched({ code: res.roomCode, dropped: res.droppedSongs.length });
  }

  return (
    <div className="container py-8 space-y-4">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold">Curated Games</h1>
        <Link href="/admin/curated-sets/new"><Button className="gap-2"><Plus className="w-4 h-4" /> New set</Button></Link>
      </div>

      {launched && (
        <Card className="p-4 border-green-500/40 bg-green-500/10">
          <p className="font-medium">Contest launched. Share this code: <span className="font-mono text-lg">{launched.code}</span></p>
          {launched.dropped > 0 && <p className="text-sm text-yellow-500">{launched.dropped} song(s) were skipped (no longer active).</p>}
        </Card>
      )}

      {isLoading ? <p>Loading…</p> : (
        <Card className="p-0 overflow-hidden">
          <table className="w-full text-sm">
            <thead className="bg-muted/30 text-left"><tr>
              <th className="px-4 py-3 font-medium">Name</th>
              <th className="px-4 py-3 font-medium">Songs</th>
              <th className="px-4 py-3 font-medium">Status</th>
              <th className="px-4 py-3 font-medium text-right">Actions</th>
            </tr></thead>
            <tbody>
              {data?.map((s) => (
                <tr key={s.id} className="border-t hover:bg-muted/20">
                  <td className="px-4 py-3 font-medium cursor-pointer" onClick={() => navigate(`/admin/curated-sets/${s.id}`)}>{s.name}</td>
                  <td className="px-4 py-3">{s.songCount}</td>
                  <td className="px-4 py-3"><Badge variant={s.status === "active" ? "default" : "secondary"}>{s.status}</Badge></td>
                  <td className="px-4 py-3 text-right">
                    <Button size="sm" variant="outline" className="gap-1" disabled={s.songCount === 0 || launch.isPending} onClick={() => onLaunch(s.id)}>
                      <Rocket className="w-3.5 h-3.5" /> Launch
                    </Button>
                  </td>
                </tr>
              ))}
              {data?.length === 0 && <tr><td colSpan={4} className="px-4 py-8 text-center text-muted-foreground">No sets yet.</td></tr>}
            </tbody>
          </table>
        </Card>
      )}
    </div>
  );
}
