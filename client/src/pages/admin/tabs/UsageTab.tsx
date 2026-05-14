import { useState } from "react";
import { trpc } from "@/lib/trpc";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { Label } from "@/components/ui/label";
import { Download } from "lucide-react";

export default function UsageTab() {
  const { data: periods } = trpc.adminUsage.availablePeriods.useQuery();
  const [period, setPeriod] = useState<string | undefined>();
  const [aggregation, setAggregation] = useState<"song" | "variant">("variant");

  // Default to most recent period
  const activePeriod = period ?? periods?.[0]?.period;

  const { data, isLoading } = trpc.adminUsage.byLyric.useQuery(
    { period: activePeriod!, aggregation },
    { enabled: !!activePeriod },
  );
  const exportCsv = trpc.adminUsage.exportCsv.useMutation();

  function handleExport() {
    if (!activePeriod) return;
    exportCsv.mutate(
      { period: activePeriod, aggregation },
      {
        onSuccess: (r) => {
          const blob = new Blob([r.csv], { type: "text/csv" });
          const url = URL.createObjectURL(blob);
          const a = document.createElement("a");
          a.href = url;
          a.download = `lyricpro-usage-${activePeriod}-${aggregation}.csv`;
          a.click();
          URL.revokeObjectURL(url);
        },
      },
    );
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const rows = (data?.rows ?? []) as any[];
  const totals = rows.reduce(
    (acc, r) => ({
      plays: acc.plays + Number(r.playCount ?? 0),
      duration: acc.duration + Number(r.durationSeconds ?? 0),
      revenue: acc.revenue + Number(r.revenueMicros ?? 0),
    }),
    { plays: 0, duration: 0, revenue: 0 },
  );

  return (
    <div>
      <div className="flex flex-wrap gap-4 mb-4 items-end">
        <div>
          <Label className="text-xs">Period</Label>
          <Select value={activePeriod ?? ""} onValueChange={setPeriod}>
            <SelectTrigger className="w-36"><SelectValue placeholder="Pick period" /></SelectTrigger>
            <SelectContent>
              {(periods ?? []).map((p: { period: string }) => (
                <SelectItem key={p.period} value={p.period}>{p.period}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <div>
          <Label className="text-xs mb-1 block">Aggregate by</Label>
          <RadioGroup
            value={aggregation}
            onValueChange={(v) => setAggregation(v as "song" | "variant")}
            className="flex gap-3"
          >
            <div className="flex items-center gap-2">
              <RadioGroupItem value="song" id="agg-song" />
              <Label htmlFor="agg-song">Song</Label>
            </div>
            <div className="flex items-center gap-2">
              <RadioGroupItem value="variant" id="agg-variant" />
              <Label htmlFor="agg-variant">Lyric variant</Label>
            </div>
          </RadioGroup>
        </div>
        <div className="ml-auto flex gap-2">
          <Button
            variant="outline"
            size="sm"
            onClick={handleExport}
            disabled={!activePeriod || exportCsv.isPending}
            className="gap-2"
          >
            <Download className="w-3 h-3" /> Internal CSV
          </Button>
          {/* DDEX button added in Phase 3 */}
        </div>
      </div>

      {isLoading && <p className="text-muted-foreground text-center py-6">Loading...</p>}

      {data && (
        <Card className="p-0 overflow-hidden">
          <table className="w-full text-sm">
            <thead className="bg-muted/30 text-left">
              <tr>
                <th className="px-4 py-3 font-medium">Title</th>
                <th className="px-4 py-3 font-medium">Artist</th>
                {aggregation === "variant" && (
                  <th className="px-4 py-3 font-medium">Variant</th>
                )}
                <th className="px-4 py-3 font-medium">Plays</th>
                <th className="px-4 py-3 font-medium">Duration (s)</th>
                <th className="px-4 py-3 font-medium">Territories</th>
                <th className="px-4 py-3 font-medium">Revenue (µ)</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr
                  key={`${r.songId}-${r.variantIndex ?? "all"}`}
                  className="border-t"
                >
                  <td className="px-4 py-3 font-medium">{r.title}</td>
                  <td className="px-4 py-3">{r.artist}</td>
                  {aggregation === "variant" && (
                    <td className="px-4 py-3 font-mono">#{r.variantIndex}</td>
                  )}
                  <td className="px-4 py-3">{r.playCount}</td>
                  <td className="px-4 py-3">{r.durationSeconds ?? 0}</td>
                  <td className="px-4 py-3 font-mono text-xs">
                    {(r.territories ?? []).join(", ") || "—"}
                  </td>
                  <td className="px-4 py-3 font-mono">{r.revenueMicros ?? 0}</td>
                </tr>
              ))}
              {rows.length === 0 && !isLoading && (
                <tr>
                  <td
                    colSpan={aggregation === "variant" ? 7 : 6}
                    className="px-4 py-8 text-center text-muted-foreground"
                  >
                    No usage data for this period
                  </td>
                </tr>
              )}
            </tbody>
            {rows.length > 0 && (
              <tfoot className="border-t bg-muted/30 font-semibold">
                <tr>
                  <td colSpan={aggregation === "variant" ? 3 : 2} className="px-4 py-3">
                    Totals
                  </td>
                  <td className="px-4 py-3">{totals.plays}</td>
                  <td className="px-4 py-3">{totals.duration}</td>
                  <td></td>
                  <td className="px-4 py-3 font-mono">{totals.revenue}</td>
                </tr>
              </tfoot>
            )}
          </table>
        </Card>
      )}
    </div>
  );
}
