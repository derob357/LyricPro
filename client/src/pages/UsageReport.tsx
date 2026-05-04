import { useAuth } from "@/_core/hooks/useAuth";
import { trpc } from "@/lib/trpc";
import { Card } from "@/components/ui/card";

// Plain-table admin view of the song catalogue's display usage.
// Source: server admin.songUsageReport. No charts — text + tables only.
export default function UsageReport() {
  const { user, loading } = useAuth();
  const isAdmin = user?.role === "admin";

  const { data, isLoading, error } = trpc.admin.songUsageReport.useQuery(
    undefined,
    { enabled: isAdmin },
  );

  if (loading) {
    return <div className="p-8 text-center">Loading...</div>;
  }
  if (!isAdmin) {
    return (
      <div className="p-8 text-center">
        <p className="text-red-600 font-semibold">Access Denied: Admin only</p>
      </div>
    );
  }
  if (isLoading) {
    return <div className="p-8 text-center">Loading usage report...</div>;
  }
  if (error || !data) {
    return (
      <div className="p-8 text-center">
        <p className="text-red-600 font-semibold">
          Could not load report: {error?.message ?? "unknown error"}
        </p>
      </div>
    );
  }

  const pct = (n: number, total: number) =>
    total > 0 ? `${((n / total) * 100).toFixed(1)}%` : "—";

  return (
    <div className="min-h-screen bg-background p-4 md:p-8">
      <div className="max-w-7xl mx-auto">
        <div className="mb-8">
          <h1 className="text-3xl font-bold mb-2">Song Usage Report</h1>
          <p className="text-muted-foreground">
            Catalogue-wide display stats sourced from <code>song_displays</code>
            .
          </p>
        </div>

        {/* Totals */}
        <Card className="p-6 mb-6">
          <h2 className="font-semibold mb-4 text-lg">Totals</h2>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
            <Stat label="Total displays" value={data.totals.totalDisplays} />
            <Stat
              label="Distinct songs shown"
              value={data.totals.distinctSongsShown}
              hint={pct(data.totals.distinctSongsShown, data.totals.totalSongs)}
            />
            <Stat
              label="Songs never shown"
              value={data.totals.songsNeverShown}
              hint={pct(data.totals.songsNeverShown, data.totals.totalSongs)}
            />
            <Stat label="Total songs" value={data.totals.totalSongs} />
          </div>
        </Card>

        {/* Last 7 days */}
        <Card className="p-6 mb-6">
          <h2 className="font-semibold mb-4 text-lg">Last 7 days</h2>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <Stat
              label="Rounds played"
              value={data.last7Days.roundsPlayed}
            />
            <Stat
              label="Distinct songs displayed"
              value={data.last7Days.distinctSongsDisplayed}
            />
          </div>
        </Card>

        {/* Distribution */}
        <Card className="p-6 mb-6">
          <h2 className="font-semibold mb-4 text-lg">
            Display-count distribution
          </h2>
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b">
                <th className="text-left py-2">Bucket</th>
                <th className="text-right py-2">Songs</th>
                <th className="text-right py-2">% of catalogue</th>
              </tr>
            </thead>
            <tbody>
              {(["0", "1-5", "6-20", "21-100", "100+"] as const).map(b => (
                <tr key={b} className="border-b last:border-0">
                  <td className="py-2 font-mono">{b}</td>
                  <td className="py-2 text-right">
                    {data.distribution[b] ?? 0}
                  </td>
                  <td className="py-2 text-right text-muted-foreground">
                    {pct(data.distribution[b] ?? 0, data.totals.totalSongs)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </Card>

        {/* By genre */}
        <Card className="p-6 mb-6">
          <h2 className="font-semibold mb-4 text-lg">By genre</h2>
          <Table
            headers={[
              "Genre",
              "Total songs",
              "Never shown",
              "Avg displays",
            ]}
            rows={data.byGenre.map(r => [
              r.genre,
              String(r.totalSongs),
              `${r.neverShown} (${pct(r.neverShown, r.totalSongs)})`,
              r.avgDisplays.toFixed(2),
            ])}
          />
        </Card>

        {/* By decade */}
        <Card className="p-6 mb-6">
          <h2 className="font-semibold mb-4 text-lg">By decade</h2>
          <Table
            headers={[
              "Decade",
              "Total songs",
              "Never shown",
              "Avg displays",
            ]}
            rows={data.byDecade.map(r => [
              r.decade ?? "—",
              String(r.totalSongs),
              `${r.neverShown} (${pct(r.neverShown, r.totalSongs)})`,
              r.avgDisplays.toFixed(2),
            ])}
          />
        </Card>

        {/* Top 20 */}
        <Card className="p-6 mb-6">
          <h2 className="font-semibold mb-4 text-lg">Top 20 most-shown</h2>
          <SongTable rows={data.topShown} showCount />
        </Card>

        {/* Bottom 20 */}
        <Card className="p-6 mb-6">
          <h2 className="font-semibold mb-4 text-lg">
            Bottom 20 (shown ≥ 1 time)
          </h2>
          <SongTable rows={data.bottomShown} showCount />
        </Card>

        {/* Never-shown sample */}
        <Card className="p-6 mb-6">
          <h2 className="font-semibold mb-4 text-lg">
            Sample of never-shown songs (up to 20)
          </h2>
          <SongTable rows={data.neverShownSample} showCount={false} />
        </Card>
      </div>
    </div>
  );
}

function Stat({
  label,
  value,
  hint,
}: {
  label: string;
  value: number;
  hint?: string;
}) {
  return (
    <div>
      <div className="text-xs text-muted-foreground uppercase tracking-wide">
        {label}
      </div>
      <div className="text-2xl font-bold">{value.toLocaleString()}</div>
      {hint && (
        <div className="text-xs text-muted-foreground mt-1">{hint}</div>
      )}
    </div>
  );
}

function Table({
  headers,
  rows,
}: {
  headers: string[];
  rows: string[][];
}) {
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-sm">
        <thead>
          <tr className="border-b">
            {headers.map(h => (
              <th key={h} className="text-left py-2 pr-4">
                {h}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((r, i) => (
            <tr key={i} className="border-b last:border-0">
              {r.map((cell, j) => (
                <td key={j} className="py-2 pr-4">
                  {cell}
                </td>
              ))}
            </tr>
          ))}
          {rows.length === 0 && (
            <tr>
              <td
                colSpan={headers.length}
                className="py-3 text-center text-muted-foreground"
              >
                No rows.
              </td>
            </tr>
          )}
        </tbody>
      </table>
    </div>
  );
}

type SongRow = {
  songId: number;
  title: string;
  artist: string;
  genre: string;
  decade: string | null;
  displayCount?: number;
};

function SongTable({
  rows,
  showCount,
}: {
  rows: SongRow[];
  showCount: boolean;
}) {
  const headers = showCount
    ? ["#", "Title", "Artist", "Genre", "Decade", "Displays"]
    : ["#", "Title", "Artist", "Genre", "Decade"];
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-sm">
        <thead>
          <tr className="border-b">
            {headers.map(h => (
              <th key={h} className="text-left py-2 pr-4">
                {h}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map(r => (
            <tr key={r.songId} className="border-b last:border-0">
              <td className="py-2 pr-4 text-muted-foreground">{r.songId}</td>
              <td className="py-2 pr-4">{r.title}</td>
              <td className="py-2 pr-4">{r.artist}</td>
              <td className="py-2 pr-4">{r.genre}</td>
              <td className="py-2 pr-4">{r.decade ?? "—"}</td>
              {showCount && (
                <td className="py-2 pr-4 font-mono">
                  {r.displayCount ?? 0}
                </td>
              )}
            </tr>
          ))}
          {rows.length === 0 && (
            <tr>
              <td
                colSpan={headers.length}
                className="py-3 text-center text-muted-foreground"
              >
                No rows.
              </td>
            </tr>
          )}
        </tbody>
      </table>
    </div>
  );
}
