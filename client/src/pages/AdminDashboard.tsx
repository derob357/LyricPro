import { useAuth } from "@/_core/hooks/useAuth";
import { trpc } from "@/lib/trpc";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer, PieChart, Pie, Cell } from "recharts";
import { TrendingUp, Users, DollarSign, Trophy, ListMusic, Rocket, Music } from "lucide-react";
import { Link, useSearch } from "wouter";
import SongsTab from "./admin/tabs/SongsTab";
import LogTab from "./admin/tabs/LogTab";
import UserActivityTab from "./admin/tabs/UserActivityTab";
import UsageTab from "./admin/tabs/UsageTab";
import SuggestionsTab from "./admin/tabs/SuggestionsTab";
import CommentaryTab from "./admin/tabs/CommentaryTab";
import GenresTab from "./admin/tabs/GenresTab";
import BannersTab from "./admin/tabs/BannersTab";
import VendorsTab from "./admin/tabs/VendorsTab";

const formatCurrency = (amount: number) => {
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: 'USD',
  }).format(amount);
};

const formatPct = (r: number) => `${(r * 100).toFixed(1)}%`;

function downloadCsv(text: string, filename: string) {
  const blob = new Blob([text], { type: "text/csv" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

const VALID_TABS = ["overview", "users", "revenue", "payouts", "analytics", "activity", "songs", "genres", "log", "usage", "suggestions", "commentary", "banners", "vendors"] as const;
type TabValue = typeof VALID_TABS[number];

export function AdminDashboard() {
  const { user } = useAuth();
  const { data: metrics, isLoading } = trpc.monetization.getAdminMetrics.useQuery();

  const enabled = user?.role === "admin";

  // Admin analytics queries — gated so they don't fire for non-admins
  const { data: payoutPipeline } = trpc.adminAnalytics.payoutPipeline.useQuery(undefined, { enabled });
  const { data: retention } = trpc.adminAnalytics.retention.useQuery({}, { enabled });
  const { data: songAccuracy } = trpc.adminAnalytics.songAccuracy.useQuery({}, { enabled });
  const { data: gnEconData } = trpc.adminAnalytics.gnEconomy.useQuery(undefined, { enabled });
  const { data: tfData } = trpc.adminAnalytics.tournamentFinancials.useQuery(undefined, { enabled });
  const { data: guestFunnel } = trpc.adminAnalytics.guestFunnel.useQuery({}, { enabled });

  // CSV export mutations
  const exportUsersMut = trpc.adminAnalytics.exportUsers.useMutation();
  const exportPayoutsMut = trpc.adminAnalytics.exportPayoutHistory.useMutation();

  const handleExportUsers = async () => {
    const res = await exportUsersMut.mutateAsync();
    downloadCsv(res.csv, "users.csv");
  };
  const handleExportPayouts = async () => {
    const res = await exportPayoutsMut.mutateAsync();
    downloadCsv(res.csv, "payout-history.csv");
  };

  // Read ?tab= from URL so /admin?tab=usage deep-links to the Usage tab.
  const search = useSearch();
  const tabParam = new URLSearchParams(search).get("tab");
  const defaultTab: TabValue =
    tabParam && (VALID_TABS as readonly string[]).includes(tabParam)
      ? (tabParam as TabValue)
      : "overview";

  // Redirect if not admin
  if (user?.role !== "admin") {
    return (
      <div className="p-8 text-center">
        <p className="text-red-600 font-semibold">Access Denied: Admin only</p>
      </div>
    );
  }

  if (isLoading) {
    return <div className="p-8 text-center">Loading analytics...</div>;
  }

  // Prepare chart data
  const tierData = Object.entries(metrics?.tierStats || {}).map(([tier, count]) => ({
    name: tier.charAt(0).toUpperCase() + tier.slice(1),
    value: count,
  }));

  const COLORS = ["#ef4444", "#3b82f6", "#a855f7", "#f59e0b"];

  // Payout pipeline: combine prizePayouts + payoutRequests by status
  const allPayoutRows = (payoutPipeline?.prizePayouts ?? []).concat(payoutPipeline?.payoutRequests ?? []);
  const byStatus: Record<string, { count: number; totalAmount: number }> = {};
  for (const r of allPayoutRows) {
    if (!byStatus[r.status]) byStatus[r.status] = { count: 0, totalAmount: 0 };
    byStatus[r.status].count += r.count;
    byStatus[r.status].totalAmount += r.totalAmount;
  }
  const STATUS_ORDER = ["pending", "processing", "completed", "failed"];
  const pipelineRows = STATUS_ORDER.map((s) => byStatus[s] ?? { count: 0, totalAmount: 0 }).map((v, i) => ({ status: STATUS_ORDER[i], ...v }));

  // Retention chart data
  const retentionSeries = retention?.roundsSeries ?? [];

  return (
    <div className="min-h-screen bg-background p-4 md:p-8">
      <div className="max-w-7xl mx-auto">
        {/* Header */}
        <div className="mb-8 flex items-start justify-between gap-4 flex-wrap">
          <div>
            <h1 className="text-3xl font-bold mb-2">Admin Dashboard</h1>
            <p className="text-muted-foreground">
              LyricPro Ai Analytics & Management
            </p>
          </div>
          <div className="flex gap-2 flex-wrap">
            <Link href="/admin/usage">
              <Button variant="outline" className="gap-2">
                <ListMusic className="w-4 h-4" />
                Song Usage Report
              </Button>
            </Link>
            <Link href="/admin/curated-sets">
              <Button variant="outline" className="gap-2">
                <Rocket className="w-4 h-4" />
                Curated Games
              </Button>
            </Link>
            <Link href="/admin/songs">
              <Button variant="outline" className="gap-2">
                <Music className="w-4 h-4" />
                Edit Songs
              </Button>
            </Link>
          </div>
        </div>

        {/* Key Metrics */}
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6 mb-8">
          <Card className="p-6">
            <div className="flex items-center justify-between mb-4">
              <h3 className="font-semibold text-sm">Total Users</h3>
              <Users className="w-5 h-5 text-muted-foreground" />
            </div>
            <div className="text-3xl font-bold">{metrics?.totalUsers || 0}</div>
            <p className="text-xs text-muted-foreground mt-2">
              {metrics?.activeSubscriptions || 0} active subscriptions
            </p>
          </Card>

          <Card className="p-6">
            <div className="flex items-center justify-between mb-4">
              <h3 className="font-semibold text-sm">Total Revenue</h3>
              <DollarSign className="w-5 h-5 text-muted-foreground" />
            </div>
            <div className="text-3xl font-bold text-green-600">
              {formatCurrency(metrics?.totalRevenue || 0)}
            </div>
            <p className="text-xs text-muted-foreground mt-2">
              Entry-fee revenue
            </p>
          </Card>

          <Card className="p-6">
            <div className="flex items-center justify-between mb-4">
              <h3 className="font-semibold text-sm">Total Payouts</h3>
              <Trophy className="w-5 h-5 text-muted-foreground" />
            </div>
            <div className="text-3xl font-bold text-blue-600">
              {formatCurrency(metrics?.totalPayouts || 0)}
            </div>
            <p className="text-xs text-muted-foreground mt-2">
              Prize distributions
            </p>
          </Card>

          <Card className="p-6">
            <div className="flex items-center justify-between mb-4">
              <h3 className="font-semibold text-sm">Profit Margin</h3>
              <TrendingUp className="w-5 h-5 text-muted-foreground" />
            </div>
            <div className="text-3xl font-bold text-purple-600">
              {((1 - (metrics?.totalPayouts || 0) / (metrics?.totalRevenue || 1)) * 100).toFixed(1)}%
            </div>
            <p className="text-xs text-muted-foreground mt-2">
              After payouts
            </p>
          </Card>
        </div>

        {/* Tabs */}
        <Tabs defaultValue={defaultTab} className="w-full">
          <TabsList className="flex flex-wrap gap-1">
            <TabsTrigger value="overview">Overview</TabsTrigger>
            <TabsTrigger value="users">Users</TabsTrigger>
            <TabsTrigger value="revenue">Revenue</TabsTrigger>
            <TabsTrigger value="payouts">Payouts</TabsTrigger>
            <TabsTrigger value="analytics">Analytics</TabsTrigger>
            <TabsTrigger value="activity">User Activity</TabsTrigger>
            <TabsTrigger value="songs">Songs</TabsTrigger>
            <TabsTrigger value="genres">Genres</TabsTrigger>
            <TabsTrigger value="log">Log</TabsTrigger>
            <TabsTrigger value="usage">Usage</TabsTrigger>
            <TabsTrigger value="suggestions">Suggestions</TabsTrigger>
            <TabsTrigger value="commentary">Commentary</TabsTrigger>
            <TabsTrigger value="banners">Banners</TabsTrigger>
            <TabsTrigger value="vendors">Vendors</TabsTrigger>
          </TabsList>

          {/* Overview Tab */}
          <TabsContent value="overview" className="space-y-4">
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
              <Card className="p-6">
                <h3 className="font-semibold mb-4">Users by Tier</h3>
                <ResponsiveContainer width="100%" height={300}>
                  <PieChart>
                    <Pie
                      data={tierData}
                      cx="50%"
                      cy="50%"
                      labelLine={false}
                      label={({ name, value }: any) => `${name}: ${value}`}
                      outerRadius={80}
                      fill="#8884d8"
                      dataKey="value"
                    >
                      {tierData.map((entry, index) => (
                        <Cell key={`cell-${index}`} fill={COLORS[index % COLORS.length]} />
                      ))}
                    </Pie>
                    <Tooltip />
                  </PieChart>
                </ResponsiveContainer>
              </Card>

              <Card className="p-6">
                <h3 className="font-semibold mb-4">Subscription Distribution</h3>
                <div className="space-y-3">
                  {tierData.map((tier, idx) => (
                    <div key={tier.name} className="flex items-center justify-between">
                      <div className="flex items-center gap-2">
                        <div
                          className="w-3 h-3 rounded-full"
                          style={{ backgroundColor: COLORS[idx % COLORS.length] }}
                        />
                        <span className="text-sm">{tier.name}</span>
                      </div>
                      <span className="font-semibold">{String(tier.value)} users</span>
                    </div>
                  ))}
                </div>
              </Card>
            </div>
          </TabsContent>

          {/* Users Tab */}
          <TabsContent value="users" className="space-y-4">
            <Card className="p-6">
              <h3 className="font-semibold mb-4">User Metrics</h3>
              <div className="space-y-3">
                <div className="flex justify-between">
                  <span className="text-muted-foreground">Total Users</span>
                  <span className="font-semibold">{metrics?.totalUsers || 0}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-muted-foreground">Active Subscriptions</span>
                  <span className="font-semibold">{metrics?.activeSubscriptions || 0}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-muted-foreground">Conversion Rate</span>
                  <span className="font-semibold">
                    {((metrics?.activeSubscriptions || 0) / (metrics?.totalUsers || 1) * 100).toFixed(1)}%
                  </span>
                </div>
              </div>
              <Button
                className="w-full mt-6"
                onClick={handleExportUsers}
                disabled={exportUsersMut.isPending}
              >
                {exportUsersMut.isPending ? "Exporting…" : "Export User Data"}
              </Button>
            </Card>
          </TabsContent>

          {/* Revenue Tab */}
          <TabsContent value="revenue" className="space-y-4">
            <Card className="p-6">
              <h3 className="font-semibold mb-4">Revenue Trend</h3>
              <div className="text-center text-muted-foreground py-12">
                <DollarSign className="w-10 h-10 mx-auto mb-3 opacity-40" />
                <p className="text-sm">Revenue trend arrives in the revenue release (SP2).</p>
              </div>
            </Card>
          </TabsContent>

          {/* Payouts Tab */}
          <TabsContent value="payouts" className="space-y-4">
            <Card className="p-6">
              <h3 className="font-semibold mb-4">Payout Summary</h3>
              <div className="space-y-3">
                <div className="flex justify-between">
                  <span className="text-muted-foreground">Total Payouts</span>
                  <span className="font-semibold text-blue-600">
                    {formatCurrency(metrics?.totalPayouts || 0)}
                  </span>
                </div>
                {pipelineRows.map(({ status, count, totalAmount }) => (
                  <div key={status} className="flex justify-between">
                    <span className="text-muted-foreground capitalize">{status}</span>
                    <span className="font-semibold">
                      {count} &mdash; {formatCurrency(totalAmount)}
                    </span>
                  </div>
                ))}
              </div>
              <Button
                className="w-full mt-6"
                onClick={handleExportPayouts}
                disabled={exportPayoutsMut.isPending}
              >
                {exportPayoutsMut.isPending ? "Exporting…" : "View Payout History"}
              </Button>
            </Card>
          </TabsContent>

          {/* Analytics Tab */}
          <TabsContent value="analytics" className="space-y-6">

            {/* Retention */}
            <Card className="p-6">
              <h3 className="font-semibold mb-4">Player Retention (rounds played — last 90 days)</h3>
              {retentionSeries.length === 0 ? (
                <p className="text-sm text-muted-foreground py-8 text-center">No retention data yet.</p>
              ) : (
                <ResponsiveContainer width="100%" height={280}>
                  <LineChart data={retentionSeries}>
                    <CartesianGrid strokeDasharray="3 3" />
                    <XAxis dataKey="day" interval="preserveStartEnd" tick={{ fontSize: 11 }} />
                    <YAxis />
                    <Tooltip />
                    <Legend />
                    <Line type="monotone" dataKey="dau" stroke="#3b82f6" name="DAU" dot={false} />
                    <Line type="monotone" dataKey="wau" stroke="#a855f7" name="WAU" dot={false} />
                    <Line type="monotone" dataKey="mau" stroke="#f59e0b" name="MAU" dot={false} />
                  </LineChart>
                </ResponsiveContainer>
              )}
            </Card>

            {/* Song Accuracy */}
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
              <Card className="p-6">
                <h3 className="font-semibold mb-4">Hardest Songs (lowest accuracy)</h3>
                {(songAccuracy?.hardest ?? []).length === 0 ? (
                  <p className="text-sm text-muted-foreground">No data yet (need songs with 5+ rounds).</p>
                ) : (
                  <div className="space-y-2">
                    {(songAccuracy?.hardest ?? []).slice(0, 10).map((s) => (
                      <div key={s.songId} className="flex items-center justify-between text-sm">
                        <span className="truncate mr-2 flex-1">{s.title} <span className="text-muted-foreground">— {s.artistName}</span></span>
                        <span className="font-semibold shrink-0">{formatPct(s.overallRate)}</span>
                      </div>
                    ))}
                  </div>
                )}
              </Card>

              <Card className="p-6">
                <h3 className="font-semibold mb-4">Easiest Songs (highest accuracy)</h3>
                {(songAccuracy?.easiest ?? []).length === 0 ? (
                  <p className="text-sm text-muted-foreground">No data yet (need songs with 5+ rounds).</p>
                ) : (
                  <div className="space-y-2">
                    {(songAccuracy?.easiest ?? []).slice(0, 10).map((s) => (
                      <div key={s.songId} className="flex items-center justify-between text-sm">
                        <span className="truncate mr-2 flex-1">{s.title} <span className="text-muted-foreground">— {s.artistName}</span></span>
                        <span className="font-semibold shrink-0">{formatPct(s.overallRate)}</span>
                      </div>
                    ))}
                  </div>
                )}
              </Card>
            </div>

            {/* GN Economy */}
            <Card className="p-6">
              <h3 className="font-semibold mb-4">Golden Note Economy</h3>
              <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-6">
                <div>
                  <p className="text-xs text-muted-foreground">Circulation</p>
                  <p className="text-xl font-bold">{gnEconData?.circulation ?? 0}</p>
                </div>
                <div>
                  <p className="text-xs text-muted-foreground">Total Credited</p>
                  <p className="text-xl font-bold text-green-600">+{gnEconData?.totalCredited ?? 0}</p>
                </div>
                <div>
                  <p className="text-xs text-muted-foreground">Total Debited</p>
                  <p className="text-xl font-bold text-red-600">-{gnEconData?.totalDebited ?? 0}</p>
                </div>
                <div>
                  <p className="text-xs text-muted-foreground">Purchased (count)</p>
                  <p className="text-xl font-bold">{gnEconData?.purchasedCount ?? 0}</p>
                </div>
              </div>
              {(gnEconData?.byReason ?? []).length > 0 && (
                <div>
                  <p className="text-xs font-semibold text-muted-foreground mb-2">By Reason</p>
                  <div className="space-y-1">
                    {(gnEconData?.byReason ?? []).map((r) => (
                      <div key={r.reason} className="flex justify-between text-sm">
                        <span className="text-muted-foreground">{r.reason}</span>
                        <span className="font-semibold">
                          net {r.net > 0 ? "+" : ""}{r.net} &nbsp;({r.count} tx)
                        </span>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </Card>

            {/* Tournament Financials */}
            <Card className="p-6">
              <h3 className="font-semibold mb-4">Tournament Financials</h3>
              <div className="grid grid-cols-3 gap-4 mb-4">
                <div>
                  <p className="text-xs text-muted-foreground">Prize Pool Total</p>
                  <p className="text-xl font-bold">{formatCurrency(tfData?.rollup.poolTotal ?? 0)}</p>
                </div>
                <div>
                  <p className="text-xs text-muted-foreground">Distributed</p>
                  <p className="text-xl font-bold text-green-600">{formatCurrency(tfData?.rollup.poolDistributed ?? 0)}</p>
                </div>
                <div>
                  <p className="text-xs text-muted-foreground">Remaining</p>
                  <p className="text-xl font-bold text-blue-600">{formatCurrency(tfData?.rollup.poolRemaining ?? 0)}</p>
                </div>
              </div>
              {(tfData?.rollup.byStatus ?? []).length > 0 && (
                <div className="flex gap-4 mb-4">
                  {(tfData?.rollup.byStatus ?? []).map((s) => (
                    <span key={s.status} className="text-sm">
                      <span className="capitalize text-muted-foreground">{s.status}</span>
                      <span className="font-semibold ml-1">{s.count}</span>
                    </span>
                  ))}
                </div>
              )}
              {(tfData?.tournaments ?? []).length === 0 ? (
                <p className="text-sm text-muted-foreground">No tournaments yet.</p>
              ) : (
                <div className="space-y-2 max-h-64 overflow-y-auto">
                  {(tfData?.tournaments ?? []).map((t) => (
                    <div key={t.id} className="flex items-center justify-between text-sm border-b pb-1">
                      <span className="flex-1 truncate mr-2">{t.name}</span>
                      <span className="text-muted-foreground mr-2 capitalize">{t.status}</span>
                      <span className="shrink-0">
                        {t.rosterSize}{t.capacity ? `/${t.capacity}` : ""} players
                        {t.fillRate !== null ? ` (${formatPct(t.fillRate)} full)` : ""}
                      </span>
                    </div>
                  ))}
                </div>
              )}
            </Card>

            {/* Guest Funnel */}
            <Card className="p-6">
              <h3 className="font-semibold mb-4">Guest Funnel</h3>
              <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                <div>
                  <p className="text-xs text-muted-foreground">Total Guests</p>
                  <p className="text-xl font-bold">{guestFunnel?.totalGuests ?? 0}</p>
                </div>
                <div>
                  <p className="text-xs text-muted-foreground">Leads (email provided)</p>
                  <p className="text-xl font-bold">{guestFunnel?.leads ?? 0}</p>
                </div>
                <div>
                  <p className="text-xs text-muted-foreground">Marketing Opt-ins</p>
                  <p className="text-xl font-bold">{guestFunnel?.optIns ?? 0}</p>
                </div>
                <div>
                  <p className="text-xs text-muted-foreground">
                    Conversion <span className="font-normal">(email-match estimate)</span>
                  </p>
                  <p className="text-xl font-bold text-green-600">
                    {guestFunnel ? formatPct(guestFunnel.conversionRate) : "—"}
                  </p>
                  <p className="text-xs text-muted-foreground">{guestFunnel?.converted ?? 0} matched</p>
                </div>
              </div>
            </Card>

          </TabsContent>

          {/* User Activity Tab */}
          <TabsContent value="activity"><UserActivityTab /></TabsContent>

          {/* Songs Tab */}
          <TabsContent value="songs"><SongsTab /></TabsContent>

          {/* Log Tab */}
          <TabsContent value="log"><LogTab /></TabsContent>

          {/* Genres Tab */}
          <TabsContent value="genres"><GenresTab /></TabsContent>

          {/* Usage Tab */}
          <TabsContent value="usage"><UsageTab /></TabsContent>

          {/* Suggestions Tab */}
          <TabsContent value="suggestions"><SuggestionsTab /></TabsContent>

          {/* Commentary Tab */}
          <TabsContent value="commentary"><CommentaryTab /></TabsContent>

          {/* Banners Tab */}
          <TabsContent value="banners"><BannersTab /></TabsContent>

          {/* Vendors Tab */}
          <TabsContent value="vendors"><VendorsTab /></TabsContent>
        </Tabs>
      </div>
    </div>
  );
}
