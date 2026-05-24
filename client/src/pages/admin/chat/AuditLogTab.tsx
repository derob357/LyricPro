import { useState } from "react";
import { trpc } from "@/lib/trpc";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

export function AuditLogTab() {
  const [actorIdInput, setActorIdInput] = useState("");
  const [actionInput, setActionInput] = useState("");
  const [targetIdInput, setTargetIdInput] = useState("");

  const filters = {
    actorId: actorIdInput ? parseInt(actorIdInput, 10) : undefined,
    action: actionInput || undefined,
    targetUserId: targetIdInput ? parseInt(targetIdInput, 10) : undefined,
    limit: 100,
  };

  const log = trpc.chat.admin.auditLog.useQuery(filters);

  return (
    <div className="grid gap-3">
      <div className="grid grid-cols-3 gap-2">
        <div>
          <Label htmlFor="filter-actor">Actor user id</Label>
          <Input id="filter-actor" value={actorIdInput} onChange={(e) => setActorIdInput(e.target.value)} placeholder="any" />
        </div>
        <div>
          <Label htmlFor="filter-action">Action</Label>
          <Input id="filter-action" value={actionInput} onChange={(e) => setActionInput(e.target.value)} placeholder="ban / message_delete / ..." />
        </div>
        <div>
          <Label htmlFor="filter-target">Target user id</Label>
          <Input id="filter-target" value={targetIdInput} onChange={(e) => setTargetIdInput(e.target.value)} placeholder="any" />
        </div>
      </div>
      <h2 className="font-semibold text-sm text-muted-foreground">Audit log (latest 100)</h2>
      {log.isLoading && <p className="text-muted-foreground text-sm">Loading...</p>}
      {log.data && log.data.rows.length === 0 && (
        <p className="text-muted-foreground text-sm">No rows match.</p>
      )}
      {(log.data?.rows ?? []).map((rawRow) => {
        const r = rawRow as Record<string, unknown>;
        return (
          <Card key={String(r.id)} className="p-2 text-xs">
            <div className="flex flex-wrap items-center gap-2">
              <span className="font-mono">#{String(r.id)}</span>
              <span>{new Date(String(r.createdAt ?? r.created_at)).toLocaleString()}</span>
              <span className="font-semibold">{String(r.action)}</span>
              <span>actor #{String(r.actor_id ?? r.actorId)}</span>
              {r.target_user_id != null && <span>target user #{String(r.target_user_id)}</span>}
              {r.target_message_id != null && <span>msg #{String(r.target_message_id)}</span>}
              {r.target_tournament_id != null && <span>tournament #{String(r.target_tournament_id)}</span>}
            </div>
            {r.reason != null && <p className="mt-1">{String(r.reason)}</p>}
            {r.metadata != null && (
              <pre className="mt-1 bg-muted/30 rounded p-1 overflow-x-auto">{JSON.stringify(r.metadata, null, 2)}</pre>
            )}
          </Card>
        );
      })}
    </div>
  );
}
