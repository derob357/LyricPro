// client/src/pages/vendor/tabs/ApiAccessTab.tsx
import { trpc } from "@/lib/trpc";
import { Badge } from "@/components/ui/badge";
import { ChartCard, QueryError } from "../lib";

export default function ApiAccessTab() {
  const q = trpc.vendor.apiAccess.useQuery();
  if (q.isLoading) return <p className="text-muted-foreground p-6">Loading…</p>;
  if (q.error) return <QueryError message={q.error.message} />;
  const d = q.data!;

  const curl = `curl -H "Authorization: Bearer lp_live_YOUR_KEY" \\\n  "${window.location.origin}${d.baseUrl}/metrics/${d.scopes[0] ?? "growth"}?from=2026-06-01&to=2026-07-01&granularity=day"`;

  return (
    <div className="space-y-4 pt-4">
      <ChartCard title="Your API keys" note="Keys are issued and revoked by the LyricPro team. The full key is shown only once at issuance — contact us if you need a new one.">
        {d.keys.length === 0 ? (
          <p className="text-sm text-muted-foreground py-4">No keys issued yet — contact the LyricPro team.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b text-left text-muted-foreground">
                  <th className="py-2 pr-4">Key</th>
                  <th className="py-2 pr-4">Label</th>
                  <th className="py-2 pr-4">Created</th>
                  <th className="py-2 pr-4">Last used</th>
                  <th className="py-2">Status</th>
                </tr>
              </thead>
              <tbody>
                {d.keys.map((k) => (
                  <tr key={k.id} className="border-b last:border-0">
                    <td className="py-2 pr-4 font-mono">{k.keyPrefix}…{k.last4}</td>
                    <td className="py-2 pr-4">{k.label}</td>
                    <td className="py-2 pr-4">{k.createdAt.slice(0, 10)}</td>
                    <td className="py-2 pr-4">{k.lastUsedAt ? k.lastUsedAt.slice(0, 10) : "never"}</td>
                    <td className="py-2">{k.revokedAt ? <Badge variant="destructive">Revoked</Badge> : <Badge>Active</Badge>}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </ChartCard>
      <ChartCard title="REST API" note="Rate limit: 120 requests/minute per key. Data is aggregate-only; cells below the privacy threshold return null with suppressed=true.">
        <div className="text-sm space-y-2">
          <p>Base URL: <code className="bg-muted px-1 rounded">{window.location.origin}{d.baseUrl}</code></p>
          <p>Your scopes: {d.scopes.map((s) => <Badge key={s} variant="outline" className="mr-1">{s}</Badge>)}</p>
          <ul className="list-disc pl-5 space-y-1">
            <li><code>GET /meta</code> — scopes, available date range, metric definitions</li>
            <li><code>GET /metrics/{"{family}"}?from&to&granularity=day|week|month</code> — family ∈ your scopes; <code>&format=csv</code> for CSV</li>
            <li><code>GET /metrics/content?dimension=song|genre|decade&limit=1..200</code></li>
            <li><code>POST /reports</code> — body <code>{"{ reports: [families], from, to, granularity }"}</code></li>
          </ul>
          <pre className="bg-muted p-3 rounded text-xs overflow-x-auto">{curl}</pre>
        </div>
      </ChartCard>
    </div>
  );
}
