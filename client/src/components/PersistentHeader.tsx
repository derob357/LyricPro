import { Link } from "wouter";
import { Music, Sparkles } from "lucide-react";
import { trpc } from "@/lib/trpc";
import { Button } from "@/components/ui/button";
import { getLoginUrl } from "@/const";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";

export function PersistentHeader() {
  const { data: user } = trpc.auth.me.useQuery();
  const logoutMutation = trpc.auth.logout.useMutation();
  const { data: balance } = trpc.goldenNotes.getMyBalance.useQuery(undefined, {
    enabled: !!user,
    refetchOnWindowFocus: false,
  });

  const handleLogout = async () => {
    await logoutMutation.mutateAsync();
    window.location.href = "/";
  };

  return (
    <header className="fixed top-0 left-0 right-0 z-50 bg-background border-b border-border">
      <div className="flex items-center justify-between h-16 px-4 max-w-7xl mx-auto w-full">
        {/* Logo - Links to Home */}
        <Link href="/" className="flex items-center gap-2 hover:opacity-80 transition-opacity">
          <Music className="w-6 h-6 text-purple-500" />
          <span className="font-bold text-lg bg-gradient-to-r from-purple-400 to-blue-400 bg-clip-text text-transparent">
            LyricPro Ai
          </span>
        </Link>

        {/* Right Navigation */}
        <div className="flex items-center gap-4">
          {user ? (
            <>
              {/* Golden Notes balance → links to /shop */}
              <Link
                href="/shop"
                className="hidden sm:flex items-center gap-1.5 px-2 py-1 rounded-md hover:bg-primary/10 transition"
                title="Golden Notes · Shop"
              >
                <Sparkles className="w-4 h-4 text-yellow-400 neon-gold-sm" />
                <span className="font-display font-bold text-yellow-400 neon-gold-sm text-sm">
                  {balance?.balance?.toLocaleString() ?? 0}
                </span>
              </Link>
              {/* User Menu */}
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button variant="ghost" className="text-sm">
                    {user.firstName || "Player"}
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end">
                  <DropdownMenuItem asChild>
                    <Link href="/dashboard">Dashboard</Link>
                  </DropdownMenuItem>
                  <DropdownMenuItem asChild>
                    <Link href="/profile">Profile</Link>
                  </DropdownMenuItem>
                  <DropdownMenuItem asChild>
                    <Link href="/leaderboards">Leaderboards</Link>
                  </DropdownMenuItem>
                  <DropdownMenuItem asChild>
                    <Link href="/shop">Shop (Golden Notes)</Link>
                  </DropdownMenuItem>
                  <DropdownMenuItem asChild>
                    <button
                      onClick={handleLogout}
                      className="w-full text-left text-red-400 hover:text-red-300"
                    >
                      Logout
                    </button>
                  </DropdownMenuItem>
                </DropdownMenuContent>
              </DropdownMenu>
            </>
          ) : (
            <>
              <Button
                variant="ghost"
                size="sm"
                onClick={() => {
                  window.location.href = getLoginUrl();
                }}
              >
                Sign In
              </Button>
              <Button
                size="sm"
                className="bg-purple-600 hover:bg-purple-700"
                onClick={() => {
                  window.location.href = getLoginUrl();
                }}
              >
                Sign Up
              </Button>
            </>
          )}
        </div>
      </div>
    </header>
  );
}
