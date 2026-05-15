import { Link } from "wouter";
import { Music2, ShoppingCart } from "lucide-react";
import { trpc } from "@/lib/trpc";
import { supabase } from "@/lib/supabase";
import { Button } from "@/components/ui/button";
import { getLoginUrl } from "@/const";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { UserAvatar } from "@/components/UserAvatar";

export function PersistentHeader() {
  const { data: user } = trpc.auth.me.useQuery();
  const logoutMutation = trpc.auth.logout.useMutation();
  const { data: balance } = trpc.goldenNotes.getMyBalance.useQuery(undefined, {
    enabled: !!user,
    refetchOnWindowFocus: false,
  });

  const handleLogout = async () => {
    // Sign out from BOTH places. The Supabase JWT (in localStorage) is
    // what actually authenticates trpc.auth.me — without clearing it,
    // a hard reload immediately re-authenticates the user and the
    // logout looks like a no-op. The server-side tRPC mutation also
    // clears the legacy session cookie. Settle both even if one fails
    // so the reload always lands on a logged-out home.
    try { await supabase.auth.signOut(); } catch {}
    try { await logoutMutation.mutateAsync(); } catch {}
    window.location.href = "/";
  };

  return (
    <header className="fixed top-0 left-0 right-0 z-50 bg-background/80 backdrop-blur-xl border-b border-border/30">
      <div className="flex items-center justify-between h-16 px-4 max-w-7xl mx-auto w-full">
        {/* Logo - Gradient wordmark */}
        <Link href="/" className="flex items-center hover:opacity-80 transition-opacity">
          <span className="font-display text-lg font-extrabold" style={{
            background: 'linear-gradient(90deg, #8B5CF6, #F59E0B)',
            WebkitBackgroundClip: 'text',
            WebkitTextFillColor: 'transparent',
          }}>LyricPro</span>
        </Link>

        {/* Right Navigation */}
        <div className="flex items-center gap-4">
          {user ? (
            <>
              {/* Golden Notes balance → links to /shop */}
              <Link
                href="/shop"
                className="hidden sm:flex items-center gap-1.5 px-2 py-1 rounded-md hover:bg-primary/10 transition"
                title="Golden Notes balance"
              >
                <Music2 className="w-4 h-4 text-amber-400" />
                <span className="font-display font-bold text-amber-400 text-sm">
                  {balance?.balance?.toLocaleString() ?? 0}
                </span>
              </Link>
              {/* Shop link */}
              <Link
                href="/shop"
                className="flex items-center px-2 py-1 rounded-md hover:bg-primary/10 transition text-muted-foreground hover:text-foreground"
                title="Shop"
              >
                <ShoppingCart className="w-4 h-4" />
              </Link>
              {/* User Menu */}
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button variant="ghost" className="text-sm flex items-center gap-2 px-2">
                    <UserAvatar size="sm" />
                    <span className="hidden sm:inline">{user.firstName || "Player"}</span>
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
                    <Link href="/shop" className="flex items-center gap-2">
                      <ShoppingCart className="w-4 h-4" />
                      Shop (Golden Notes)
                    </Link>
                  </DropdownMenuItem>
                  <DropdownMenuItem asChild>
                    <Link href="/avatars">Avatars</Link>
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
                variant="outline"
                size="sm"
                className="border-primary/30 text-primary hover:bg-primary/10"
                onClick={() => {
                  window.location.href = getLoginUrl();
                }}
              >
                Sign Up
              </Button>
              <Button
                size="sm"
                className="bg-primary hover:bg-primary/90 shadow-[0_0_24px_rgba(139,92,246,0.2)]"
                onClick={() => {
                  window.location.href = getLoginUrl();
                }}
              >
                Play Now
              </Button>
            </>
          )}
        </div>
      </div>
    </header>
  );
}
