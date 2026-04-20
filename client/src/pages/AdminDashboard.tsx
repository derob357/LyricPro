import { useAuth } from "@/_core/hooks/useAuth";
import { trpc } from "@/lib/trpc";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { BarChart, Bar, LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer, PieChart, Pie, Cell } from "recharts";
import { TrendingUp, Users, DollarSign, Trophy } from "lucide-react";

const formatCurrency = (amount: number) => {
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: 'USD',
  }).format(amount);
};

export function AdminDashboard() {
  const { user } = useAuth();
  const { data: metrics, isLoading } = trpc.monetization.getAdminMetrics.useQuery();

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

  // Mock revenue trend data
  const revenueData = [
    { month: "Jan", revenue: 45000, payouts: 13500 },
    { month: "Feb", revenue: 52000, payouts: 15600 },
    { month: "Mar", revenue: 68000, payouts: 20400 },
    { month: "Apr", revenue: 85000, payouts: 25500 },
  ];

  return (
    <div className="min-h-screen bg-background p-4 md:p-8">
      <div className="max-w-7xl mx-auto">
        {/* Header */}
        <div className="mb-8">
          <h1 className="text-3xl font-bold mb-2">Admin Dashboard</h1>
          <p className="text-muted-foreground">
            LyricPro Ai Analytics & Management
          </p>
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
              From entry fees & subscriptions
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
        <Tabs defaultValue="overview" className="w-full">
          <TabsList className="grid w-full grid-cols-4">
            <TabsTrigger value="overview">Overview</TabsTrigger>
            <TabsTrigger value="users">Users</TabsTrigger>
            <TabsTrigger value="revenue">Revenue</TabsTrigger>
            <TabsTrigger value="payouts">Payouts</TabsTrigger>
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
              <Button className="w-full mt-6">Export User Data</Button>
            </Card>
          </TabsContent>

          {/* Revenue Tab */}
          <TabsContent value="revenue" className="space-y-4">
            <Card className="p-6">
              <h3 className="font-semibold mb-4">Revenue Trend</h3>
              <ResponsiveContainer width="100%" height={300}>
                <LineChart data={revenueData}>
                  <CartesianGrid strokeDasharray="3 3" />
                  <XAxis dataKey="month" />
                  <YAxis />
                  <Tooltip formatter={(value: any) => formatCurrency(typeof value === 'number' ? value : 0)} />
                  <Legend />
                  <Line
                    type="monotone"
                    dataKey="revenue"
                    stroke="#3b82f6"
                    name="Total Revenue"
                    dot={false}
                  />
                  <Line
                    type="monotone"
                    dataKey="payouts"
                    stroke="#ef4444"
                    name="Prize Payouts"
                    dot={false}
                  />
                </LineChart>
              </ResponsiveContainer>
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
                <div className="flex justify-between">
                  <span className="text-muted-foreground">Pending Payouts</span>
                  <span className="font-semibold">$0.00</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-muted-foreground">Failed Payouts</span>
                  <span className="font-semibold">0</span>
                </div>
              </div>
              <Button className="w-full mt-6">View Payout History</Button>
            </Card>
          </TabsContent>
        </Tabs>
      </div>
    </div>
  );
}
