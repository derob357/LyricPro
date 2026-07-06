// client/src/pages/vendor/tabs/GrowthTab.tsx
import { CartesianGrid, Legend, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { trpc } from "@/lib/trpc";
import { ChartCard, ExportButton, QueryError, StatCard, chartVal, type VendorRange } from "../lib";

export default function GrowthTab({ range, notes }: { range: VendorRange; notes: Record<string, string> }) {
  const q = trpc.vendor.growth.useQuery(range);
  const rows = q.data ?? [];
  const latest = rows[rows.length - 1];
  const series = rows.map((r) => ({
    bucket: r.bucket,
    dau: chartVal(r.dau),
    wau: chartVal(r.wau),
    mau: chartVal(r.mau),
    newUsers: chartVal(r.newUsers),
  }));

  if (q.isLoading) return <p className="text-muted-foreground p-6">Loading…</p>;
  if (q.error) return <QueryError message={q.error.message} />;

  return (
    <div className="space-y-4 pt-4">
      <div className="flex justify-end"><ExportButton family="growth" range={range} /></div>
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <StatCard label="DAU (latest)" cell={latest?.dau} />
        <StatCard label="MAU (latest)" cell={latest?.mau} />
        <StatCard label="Stickiness" cell={latest?.stickiness} digits={3} />
        <StatCard label="New users (latest)" cell={latest?.newUsers} />
      </div>
      <ChartCard title="Active users" note={notes.dau}>
        {series.length === 0 ? (
          <p className="text-sm text-muted-foreground py-8 text-center">No data in range.</p>
        ) : (
          <ResponsiveContainer width="100%" height={280}>
            <LineChart data={series}>
              <CartesianGrid strokeDasharray="3 3" />
              <XAxis dataKey="bucket" interval="preserveStartEnd" tick={{ fontSize: 11 }} />
              <YAxis />
              <Tooltip />
              <Legend />
              <Line type="monotone" dataKey="dau" stroke="#3b82f6" name="DAU" dot={false} connectNulls={false} />
              <Line type="monotone" dataKey="wau" stroke="#a855f7" name="WAU" dot={false} connectNulls={false} />
              <Line type="monotone" dataKey="mau" stroke="#f59e0b" name="MAU" dot={false} connectNulls={false} />
            </LineChart>
          </ResponsiveContainer>
        )}
      </ChartCard>
      <ChartCard title="New users & guest conversions" note={notes.guest_conversions}>
        {series.length === 0 ? (
          <p className="text-sm text-muted-foreground py-8 text-center">No data in range.</p>
        ) : (
          <ResponsiveContainer width="100%" height={220}>
            <LineChart data={rows.map((r) => ({ bucket: r.bucket, newUsers: chartVal(r.newUsers), newGuests: chartVal(r.newGuests), conversions: chartVal(r.guestConversions) }))}>
              <CartesianGrid strokeDasharray="3 3" />
              <XAxis dataKey="bucket" interval="preserveStartEnd" tick={{ fontSize: 11 }} />
              <YAxis />
              <Tooltip />
              <Legend />
              <Line type="monotone" dataKey="newUsers" stroke="#3b82f6" name="New users" dot={false} connectNulls={false} />
              <Line type="monotone" dataKey="newGuests" stroke="#ef4444" name="New guests" dot={false} connectNulls={false} />
              <Line type="monotone" dataKey="conversions" stroke="#a855f7" name="Guest conversions" dot={false} connectNulls={false} />
            </LineChart>
          </ResponsiveContainer>
        )}
      </ChartCard>
    </div>
  );
}
