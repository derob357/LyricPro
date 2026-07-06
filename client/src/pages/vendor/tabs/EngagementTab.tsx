// client/src/pages/vendor/tabs/EngagementTab.tsx
import { CartesianGrid, Legend, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { trpc } from "@/lib/trpc";
import { ChartCard, ExportButton, QueryError, StatCard, cellText, cellPercent, chartVal, type VendorRange } from "../lib";

export default function EngagementTab({ range, notes }: { range: VendorRange; notes: Record<string, string> }) {
  const q = trpc.vendor.engagement.useQuery(range);
  const series = q.data?.series ?? [];
  const retention = q.data?.retention ?? [];
  const latest = series[series.length - 1];

  if (q.isLoading) return <p className="text-muted-foreground p-6">Loading…</p>;
  if (q.error) return <QueryError message={q.error.message} />;

  const chartData = series.map((r) => ({
    bucket: r.bucket,
    sessions: chartVal(r.sessions),
    rounds: chartVal(r.rounds),
    avgSeconds: chartVal(r.avgSessionSeconds),
  }));

  return (
    <div className="space-y-4 pt-4">
      <div className="flex justify-end"><ExportButton family="engagement" range={range} /></div>
      <div className="grid grid-cols-2 md:grid-cols-3 gap-4">
        <StatCard label="Sessions (latest)" cell={latest?.sessions} />
        <StatCard label="Rounds / session" cell={latest?.roundsPerSession} digits={2} />
        <StatCard label="Avg session (sec)" cell={latest?.avgSessionSeconds} digits={1} />
      </div>
      <ChartCard title="Sessions & rounds" note={notes.sessions}>
        {chartData.length === 0 ? (
          <p className="text-sm text-muted-foreground py-8 text-center">No data in range.</p>
        ) : (
          <ResponsiveContainer width="100%" height={280}>
            <LineChart data={chartData}>
              <CartesianGrid strokeDasharray="3 3" />
              <XAxis dataKey="bucket" interval="preserveStartEnd" tick={{ fontSize: 11 }} />
              <YAxis />
              <Tooltip />
              <Legend />
              <Line type="monotone" dataKey="sessions" stroke="#3b82f6" name="Sessions" dot={false} connectNulls={false} />
              <Line type="monotone" dataKey="rounds" stroke="#f59e0b" name="Rounds" dot={false} connectNulls={false} />
            </LineChart>
          </ResponsiveContainer>
        )}
      </ChartCard>
      <ChartCard title="Retention cohorts (D1 / D7 / D30)" note={notes.retention}>
        {retention.length === 0 ? (
          <p className="text-sm text-muted-foreground py-8 text-center">No cohorts in range.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b text-left text-muted-foreground">
                  <th className="py-2 pr-4">Cohort</th>
                  <th className="py-2 pr-4">Offset</th>
                  <th className="py-2 pr-4">Cohort size</th>
                  <th className="py-2">Retained rate</th>
                </tr>
              </thead>
              <tbody>
                {retention.map((r) => (
                  <tr key={`${r.cohortDate}-${r.dayOffset}`} className="border-b last:border-0">
                    <td className="py-2 pr-4">{r.cohortDate}</td>
                    <td className="py-2 pr-4">D{r.dayOffset}</td>
                    <td className="py-2 pr-4">{cellText(r.cohortSize)}</td>
                    <td className="py-2">{cellPercent(r.retainedRate)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </ChartCard>
    </div>
  );
}
