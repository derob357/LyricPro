// client/src/pages/vendor/tabs/MonetizationTab.tsx
import { Bar, BarChart, CartesianGrid, Legend, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { trpc } from "@/lib/trpc";
import { ChartCard, ExportButton, QueryError, StatCard, cellText, chartVal, type VendorRange } from "../lib";

export default function MonetizationTab({ range, notes }: { range: VendorRange; notes: Record<string, string> }) {
  const q = trpc.vendor.monetization.useQuery(range);
  const rows = q.data ?? [];
  const latest = rows[rows.length - 1];

  if (q.isLoading) return <p className="text-muted-foreground p-6">Loading…</p>;
  if (q.error) return <QueryError message={q.error.message} />;

  const revenueSeries = rows.map((r) => ({
    bucket: r.bucket,
    addon: chartVal(r.addonRevenueUsd),
    entryFees: chartVal(r.entryFeeRevenueUsd),
    prizes: chartVal(r.prizesPaidUsd),
  }));
  const arpdauSeries = rows.map((r) => ({ bucket: r.bucket, arpdau: chartVal(r.arpdau), gnPurchased: chartVal(r.gnPurchased) }));
  const tierEntries = Object.entries(latest?.subscriptionsByTier ?? {});
  const kindEntries = Object.entries(latest?.gnSpentByKind ?? {});

  return (
    <div className="space-y-4 pt-4">
      <div className="flex justify-end"><ExportButton family="monetization" range={range} /></div>
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <StatCard label="ARPDAU (latest)" cell={latest?.arpdau} digits={4} />
        <StatCard label="Add-on revenue $ (latest)" cell={latest?.addonRevenueUsd} digits={2} />
        <StatCard label="Entry fees $ (latest)" cell={latest?.entryFeeRevenueUsd} digits={2} />
        <StatCard label="GN purchased (latest)" cell={latest?.gnPurchased} />
      </div>
      <ChartCard title="Revenue (USD, gross)" note={notes.addon_revenue_usd}>
        {revenueSeries.length === 0 ? (
          <p className="text-sm text-muted-foreground py-8 text-center">No data in range.</p>
        ) : (
          <ResponsiveContainer width="100%" height={260}>
            <BarChart data={revenueSeries}>
              <CartesianGrid strokeDasharray="3 3" />
              <XAxis dataKey="bucket" interval="preserveStartEnd" tick={{ fontSize: 11 }} />
              <YAxis />
              <Tooltip />
              <Legend />
              <Bar dataKey="addon" stackId="rev" fill="#3b82f6" name="Add-on purchases" />
              <Bar dataKey="entryFees" stackId="rev" fill="#a855f7" name="Entry fees" />
              <Bar dataKey="prizes" fill="#ef4444" name="Prizes paid" />
            </BarChart>
          </ResponsiveContainer>
        )}
      </ChartCard>
      <ChartCard title="ARPDAU & Golden Notes purchased" note={notes.arpdau}>
        {arpdauSeries.length === 0 ? (
          <p className="text-sm text-muted-foreground py-8 text-center">No data in range.</p>
        ) : (
          <ResponsiveContainer width="100%" height={220}>
            <LineChart data={arpdauSeries}>
              <CartesianGrid strokeDasharray="3 3" />
              <XAxis dataKey="bucket" interval="preserveStartEnd" tick={{ fontSize: 11 }} />
              <YAxis yAxisId="l" />
              <YAxis yAxisId="r" orientation="right" />
              <Tooltip />
              <Legend />
              <Line yAxisId="l" type="monotone" dataKey="arpdau" stroke="#f59e0b" name="ARPDAU ($)" dot={false} connectNulls={false} />
              <Line yAxisId="r" type="monotone" dataKey="gnPurchased" stroke="#3b82f6" name="GN purchased" dot={false} connectNulls={false} />
            </LineChart>
          </ResponsiveContainer>
        )}
      </ChartCard>
      <div className="grid md:grid-cols-2 gap-4">
        <ChartCard title="Active subscriptions by tier (latest)" note={notes.active_subscriptions}>
          {tierEntries.length === 0 ? (
            <p className="text-sm text-muted-foreground py-4 text-center">None in range.</p>
          ) : (
            <ul className="text-sm space-y-1">
              {tierEntries.map(([tier, cell]) => (
                <li key={tier} className="flex justify-between border-b last:border-0 py-1">
                  <span className="capitalize">{tier}</span><span>{cellText(cell)}</span>
                </li>
              ))}
            </ul>
          )}
        </ChartCard>
        <ChartCard title="GN spend by kind (latest)" note={notes.gn_spent}>
          {kindEntries.length === 0 ? (
            <p className="text-sm text-muted-foreground py-4 text-center">None in range.</p>
          ) : (
            <ul className="text-sm space-y-1">
              {kindEntries.map(([kind, cell]) => (
                <li key={kind} className="flex justify-between border-b last:border-0 py-1">
                  <span>{kind.replace(/_/g, " ")}</span><span>{cellText(cell)}</span>
                </li>
              ))}
            </ul>
          )}
        </ChartCard>
      </div>
    </div>
  );
}
