import { useAuth } from "@/_core/hooks/useAuth";
import { trpc } from "@/lib/trpc";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Wallet, CreditCard, Trophy, TrendingUp } from "lucide-react";
const formatCurrency = (amount: number) => {
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: 'USD',
  }).format(amount);
};

export function UserDashboard() {
  const { user } = useAuth();
  const { data: stats, isLoading } = trpc.monetization.getMonetizationStats.useQuery();
  const { data: wallet } = trpc.monetization.getWallet.useQuery();

  if (isLoading) {
    return <div className="p-8 text-center">Loading...</div>;
  }

  const tierColors: Record<string, string> = {
    free: "bg-gray-100 text-gray-800",
    player: "bg-blue-100 text-blue-800",
    pro: "bg-purple-100 text-purple-800",
    elite: "bg-yellow-100 text-yellow-800",
  };

  const tierLabel = {
    free: "Free Trial",
    player: "Player",
    pro: "Pro",
    elite: "Elite",
  };

  return (
    <div className="min-h-screen bg-background p-4 md:p-8">
      <div className="max-w-6xl mx-auto">
        {/* Header */}
        <div className="mb-8">
          <h1 className="text-3xl font-bold mb-2">My Account</h1>
          <p className="text-muted-foreground">
            Welcome back, {user?.firstName || "Player"}!
          </p>
        </div>

        {/* Subscription Status */}
        <div className="grid grid-cols-1 md:grid-cols-3 gap-6 mb-8">
          <Card className="p-6">
            <div className="flex items-center justify-between mb-4">
              <h3 className="font-semibold">Current Plan</h3>
              <CreditCard className="w-5 h-5 text-muted-foreground" />
            </div>
            <div className={`inline-block px-3 py-1 rounded-full text-sm font-semibold ${tierColors[stats?.subscription?.tier || "free"]}`}>
              {tierLabel[stats?.subscription?.tier as keyof typeof tierLabel]}
            </div>
            <p className="text-sm text-muted-foreground mt-3">
              {stats?.subscription?.tier === "free"
                ? "2 trial games available"
                : "Renews on " + new Date(stats?.subscription?.currentPeriodEnd || Date.now()).toLocaleDateString()}
            </p>
          </Card>

          <Card className="p-6">
            <div className="flex items-center justify-between mb-4">
              <h3 className="font-semibold">Daily Games</h3>
              <Trophy className="w-5 h-5 text-muted-foreground" />
            </div>
            <div className="text-2xl font-bold">{stats?.todayGameCount || 0}</div>
            <p className="text-sm text-muted-foreground mt-2">
              {stats?.subscription?.tier === "free"
                ? "Trial games used"
                : stats?.subscription?.tier === "player"
                  ? "of 1 (every 2 days)"
                  : "of 1 (daily)"}
            </p>
          </Card>

          <Card className="p-6">
            <div className="flex items-center justify-between mb-4">
              <h3 className="font-semibold">Available Balance</h3>
              <Wallet className="w-5 h-5 text-muted-foreground" />
            </div>
            <div className="text-2xl font-bold text-green-600">
              {formatCurrency(wallet?.availableBalance || 0)}
            </div>
            <Button size="sm" className="mt-3 w-full">
              Request Payout
            </Button>
          </Card>
        </div>

        {/* Tabs */}
        <Tabs defaultValue="subscription" className="w-full">
          <TabsList className="grid w-full grid-cols-3">
            <TabsTrigger value="subscription">Subscription</TabsTrigger>
            <TabsTrigger value="wallet">Wallet</TabsTrigger>
            <TabsTrigger value="history">History</TabsTrigger>
          </TabsList>

          {/* Subscription Tab */}
          <TabsContent value="subscription" className="space-y-4">
            <Card className="p-6">
              <h3 className="font-semibold mb-4">Subscription Details</h3>
              <div className="space-y-3">
                <div className="flex justify-between">
                  <span className="text-muted-foreground">Current Tier</span>
                  <span className="font-semibold">{tierLabel[stats?.subscription?.tier as keyof typeof tierLabel]}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-muted-foreground">Status</span>
                  <span className="font-semibold capitalize">{stats?.subscription?.status}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-muted-foreground">Period End</span>
                  <span className="font-semibold">
                    {stats?.subscription?.currentPeriodEnd
                      ? new Date(stats.subscription.currentPeriodEnd).toLocaleDateString()
                      : "N/A"}
                  </span>
                </div>
              </div>
              <Button className="w-full mt-6">Upgrade Plan</Button>
            </Card>
          </TabsContent>

          {/* Wallet Tab */}
          <TabsContent value="wallet" className="space-y-4">
            <Card className="p-6">
              <h3 className="font-semibold mb-4">Wallet Summary</h3>
              <div className="space-y-3">
                <div className="flex justify-between">
                  <span className="text-muted-foreground">Available Balance</span>
                  <span className="font-semibold text-green-600">
                    {formatCurrency(wallet?.availableBalance || 0)}
                  </span>
                </div>
                <div className="flex justify-between">
                  <span className="text-muted-foreground">Total Winnings</span>
                  <span className="font-semibold">
                    {formatCurrency(wallet?.totalWinnings || 0)}
                  </span>
                </div>
                <div className="flex justify-between">
                  <span className="text-muted-foreground">Total Payouts</span>
                  <span className="font-semibold">
                    {formatCurrency(wallet?.totalPayouts || 0)}
                  </span>
                </div>
                {wallet?.lastPayoutDate && (
                  <div className="flex justify-between">
                    <span className="text-muted-foreground">Last Payout</span>
                    <span className="font-semibold">
                      {new Date(wallet.lastPayoutDate).toLocaleDateString()}
                    </span>
                  </div>
                )}
              </div>
              <Button className="w-full mt-6" disabled={!wallet?.availableBalance || wallet.availableBalance < 10}>
                Request Payout (Min $10)
              </Button>
            </Card>
          </TabsContent>

          {/* History Tab */}
          <TabsContent value="history" className="space-y-4">
            <Card className="p-6">
              <h3 className="font-semibold mb-4">Recent Activity</h3>
              <div className="text-center text-muted-foreground py-8">
                <TrendingUp className="w-8 h-8 mx-auto mb-2 opacity-50" />
                <p>Game history coming soon</p>
              </div>
            </Card>
          </TabsContent>
        </Tabs>
      </div>
    </div>
  );
}
