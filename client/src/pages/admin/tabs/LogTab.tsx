import { useMemo, useState } from "react";
import { trpc } from "@/lib/trpc";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { RefreshCw, Download } from "lucide-react";
import { ActionVerbChip } from "../components/ActionVerbChip";
import { LogDrawer } from "../components/LogDrawer";

const DATE_CHIPS: { label: string; hours: number | null }[] = [
  { label: "24h", hours: 24 },
  { label: "7d", hours: 24 * 7 },
  { label: "30d", hours: 24 * 30 },
  { label: "All", hours: null },
];

export default function LogTab() {
  const [hours, setHours] = useState<number | null>(24 * 7);
  const [actorId, setActorId] = useState<number | undefined>(undefined);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const [openRow, setOpenRow] = useState<any | null>(null);

  const from = useMemo(
    () =>
      hours === null
        ? undefined
        : new Date(Date.now() - hours * 3600 * 1000).toISOString(),
    [hours],
  );

  const { data, isLoading, refetch, isFetching } = trpc.adminActions.list.useQuery({
    limit: 50,
    from,
    actorId,
  });
  const { data: actors } = trpc.adminActions.distinctActors.useQuery();
  const exportCsv = trpc.adminActions.exportCsv.useMutation();

  function handleExport() {
    exportCsv.mutate(
      { from, actorId },
      {
        onSuccess: (r) => {
          const blob = new Blob([r.csv], { type: "text/csv" });
          const url = URL.createObjectURL(blob);
          const a = document.createElement("a");
          a.href = url;
          a.download = `admin-actions-${new Date().toISOString().slice(0, 10)}.csv`;
          a.click();
          URL.revokeObjectURL(url);
        },
      },
    );
  }

  return (
    <div>
      {/* Filter bar */}
      <div className="flex flex-wrap gap-3 mb-4 items-center">
        {DATE_CHIPS.map((c) => (
          <Button
            key={c.label}
            variant={hours === c.hours ? "default" : "outline"}
            size="sm"
            onClick={() => setHours(c.hours)}
          >
            {c.label}
          </Button>
        ))}
        <Select
          value={actorId?.toString() ?? "all"}
          onValueChange={(v) => setActorId(v === "all" ? undefined : Number(v))}
        >
          <SelectTrigger className="w-52"><SelectValue placeholder="Actor" /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All actors</SelectItem>
            {(actors ?? []).map((a) => (
              <SelectItem key={a.actorId!} value={String(a.actorId)}>
                {a.actorEmail ?? `id ${a.actorId}`}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <div className="ml-auto flex gap-2">
          <Button
            variant="outline"
            size="sm"
            onClick={() => refetch()}
            disabled={isFetching}
            className="gap-2"
          >
            <RefreshCw className="w-3 h-3" /> Refresh
          </Button>
          <Button variant="outline" size="sm" onClick={handleExport} className="gap-2">
            <Download className="w-3 h-3" /> Export CSV
          </Button>
        </div>
      </div>

      {/* Table */}
      <Card className="p-0 overflow-hidden">
        <table className="w-full text-sm">
          <thead className="bg-muted/30 text-left">
            <tr>
              <th className="px-4 py-3 font-medium">When</th>
              <th className="px-4 py-3 font-medium">Actor</th>
              <th className="px-4 py-3 font-medium">Action</th>
              <th className="px-4 py-3 font-medium">Target</th>
              <th className="px-4 py-3 font-medium">Source</th>
            </tr>
          </thead>
          <tbody>
            {isLoading && (
              <tr>
                <td colSpan={5} className="px-4 py-8 text-center text-muted-foreground">
                  Loading...
                </td>
              </tr>
            )}
            {(data?.rows ?? []).map((r) => (
              <tr
                key={r.id}
                className="border-t hover:bg-muted/20 cursor-pointer"
                onClick={() => setOpenRow(r)}
              >
                <td
                  className="px-4 py-3 font-mono text-xs"
                  title={new Date(r.occurredAt).toISOString()}
                >
                  {relativeTime(r.occurredAt)}
                </td>
                <td className="px-4 py-3 truncate max-w-[160px]">{r.actorEmail ?? "system"}</td>
                <td className="px-4 py-3"><ActionVerbChip action={r.action} /></td>
                <td className="px-4 py-3">
                  <span className="text-muted-foreground">{r.targetType}:</span> {r.targetId}
                  {r.targetVariantIndex !== null && r.targetVariantIndex !== undefined
                    ? `#${r.targetVariantIndex}`
                    : ""}
                </td>
                <td className="px-4 py-3 font-mono text-xs">{r.ipTruncated ?? "—"}</td>
              </tr>
            ))}
            {data && data.rows.length === 0 && !isLoading && (
              <tr>
                <td colSpan={5} className="px-4 py-8 text-center text-muted-foreground">
                  No actions in this range
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </Card>

      <LogDrawer open={!!openRow} onOpenChange={(v) => !v && setOpenRow(null)} row={openRow} />
    </div>
  );
}

function relativeTime(d: Date | string): string {
  const date = typeof d === "string" ? new Date(d) : d;
  const sec = Math.floor((Date.now() - date.getTime()) / 1000);
  if (sec < 60) return `${sec}s ago`;
  if (sec < 3600) return `${Math.floor(sec / 60)}m ago`;
  if (sec < 86400) return `${Math.floor(sec / 3600)}h ago`;
  return `${Math.floor(sec / 86400)}d ago`;
}
