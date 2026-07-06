// client/src/pages/vendor/tabs/ContentTab.tsx
import { useState } from "react";
import { Bar, BarChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { trpc } from "@/lib/trpc";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { ChartCard, ExportButton, QueryError, cellText, cellPercent, chartVal, type VendorRange } from "../lib";

export default function ContentTab({ range, notes }: { range: VendorRange; notes: Record<string, string> }) {
  const [dimension, setDimension] = useState<"song" | "genre" | "decade">("song");
  const q = trpc.vendor.content.useQuery({ ...range, dimension, limit: 50 });
  const rows = q.data ?? [];
  const top = rows.slice(0, 15).map((r) => ({ key: r.key, displays: chartVal(r.displays) }));

  if (q.isLoading) return <p className="text-muted-foreground p-6">Loading…</p>;
  if (q.error) return <QueryError message={q.error.message} />;

  return (
    <div className="space-y-4 pt-4">
      <div className="flex items-center justify-between">
        <Select value={dimension} onValueChange={(v) => setDimension(v as typeof dimension)}>
          <SelectTrigger className="w-36"><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="song">By song</SelectItem>
            <SelectItem value="genre">By genre</SelectItem>
            <SelectItem value="decade">By decade</SelectItem>
          </SelectContent>
        </Select>
        <ExportButton family="content" range={range} dimension={dimension} limit={50} />
      </div>
      <ChartCard title={`Top ${dimension}s by displays`} note={notes.displays}>
        {top.length === 0 ? (
          <p className="text-sm text-muted-foreground py-8 text-center">No data in range{dimension !== "song" ? " (genre/decade views are unavailable when a catalog filter is set)" : ""}.</p>
        ) : (
          <ResponsiveContainer width="100%" height={300}>
            <BarChart data={top} layout="vertical" margin={{ left: 120 }}>
              <CartesianGrid strokeDasharray="3 3" />
              <XAxis type="number" />
              <YAxis type="category" dataKey="key" width={120} tick={{ fontSize: 11 }} />
              <Tooltip />
              <Bar dataKey="displays" fill="#3b82f6" name="Displays" />
            </BarChart>
          </ResponsiveContainer>
        )}
      </ChartCard>
      <ChartCard title="Detail" note={notes.correct_rate}>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b text-left text-muted-foreground">
                <th className="py-2 pr-4">{dimension === "song" ? "Song — Artist" : dimension === "genre" ? "Genre" : "Decade"}</th>
                <th className="py-2 pr-4">Displays</th>
                <th className="py-2 pr-4">Rounds</th>
                <th className="py-2 pr-4">Correct rate</th>
                <th className="py-2">Avg response (s)</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.key} className="border-b last:border-0">
                  <td className="py-2 pr-4">{r.key}</td>
                  <td className="py-2 pr-4">{cellText(r.displays)}</td>
                  <td className="py-2 pr-4">{cellText(r.roundsPlayed)}</td>
                  <td className="py-2 pr-4">{cellPercent(r.correctRate)}</td>
                  <td className="py-2">{cellText(r.avgResponseSeconds, 1)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </ChartCard>
    </div>
  );
}
