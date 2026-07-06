import { Link, useLocation } from "wouter";
import { BarChart3, MessageSquare, Music, Music2, ShoppingCart } from "lucide-react";
import { trpc } from "@/lib/trpc";
import AnimatedGnBalance from "@/components/AnimatedGnBalance";
import { supabase } from "@/lib/supabase";
import { Button } from "@/components/ui/button";
import { getLoginUrl } from "@/const";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { UserAvatar } from "@/components/UserAvatar";
import { useChatPanelOpen } from "@/lib/chat/chatPanelStore";

export function PersistentHeader() {
  const { data: user } = trpc.auth.me.useQuery();
  const logoutMutation = trpc.auth.logout.useMutation();
  const { data: balance } = trpc.goldenNotes.getMyBalance.useQuery(undefined, {
    enabled: !!user,
    refetchOnWindowFocus: false,
  });

  // Chat icon wiring: desktop toggles a slide-over via the chatPanelStore;
  // mobile navigates to the full /chat page. unreadCounts is a protected
  // procedure, so gate the query on `user` to avoid 401s for anonymous
  // visitors (this whole block only renders inside the authed branch
  // below, but the hook itself must be unconditional).
  const [, setChatOpen] = useChatPanelOpen();
  const [, navigate] = useLocation();
  const unread = trpc.chat.unreadCounts.useQuery(undefined, {
    enabled: !!user,
    refetchOnWindowFocus: true,
    staleTime: 30_000,
  });
  const totalUnread =
    (unread.data?.global ?? 0) +
    (unread.data?.friends ?? 0) +
    Object.values(unread.data?.tournaments ?? {}).reduce((a, b) => a + b, 0);
  const handleChatClick = () => {
    const isMobile =
      typeof window !== "undefined" &&
      window.matchMedia("(max-width: 767px)").matches;
    if (isMobile) {
      navigate("/chat");
    } else {
      setChatOpen(true);
    }
  };

  const handleLogout = async () => {
    // Sign out from BOTH places. The Supabase JWT (in localStorage) is
    // what actually authenticates trpc.auth.me — without clearing it,
    // a hard reload immediately re-authenticates the user and the
    // logout looks like a no-op. The server-side tRPC mutation also
    // clears the legacy session cookie. Settle both even if one fails
    // so the reload always lands on a logged-out home.
    try { await supabase.auth.signOut(); } catch {}
    try { await logoutMutation.mutateAsync(); } catch {}
    window.location.href = "/welcome";
  };

  return (
    <header className="fixed top-0 left-0 right-0 z-50 bg-background border-b border-border">
      <div className="flex items-center justify-between h-16 px-4 max-w-7xl mx-auto w-full">
        {/* Logo - Links to Home */}
        <Link href="/welcome" className="flex items-center gap-2 hover:opacity-80 transition-opacity">
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
                title="Golden Notes balance"
              >
                <Music2 className="w-4 h-4 text-yellow-400 neon-gold-sm" />
                <span className="font-display font-bold text-yellow-400 neon-gold-sm text-sm">
                  <AnimatedGnBalance value={balance?.balance ?? 0} />
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
              {/* Chat icon + avatar share a tighter gap-2 cluster */}
              <div className="flex items-center gap-2">
                {/* Chat icon: opens slide-over on desktop, navigates to /chat on mobile */}
                <button
                  type="button"
                  onClick={handleChatClick}
                  className="relative flex items-center justify-center h-9 w-9 rounded-full hover:bg-muted"
                  aria-label="Open chat"
                >
                  <MessageSquare className="h-4 w-4" />
                  {totalUnread > 0 && (
                    <span className="absolute -top-1 -right-1 min-w-[18px] h-[18px] rounded-full bg-primary text-primary-foreground text-[10px] font-semibold flex items-center justify-center px-1">
                      {totalUnread > 99 ? "99+" : totalUnread}
                    </span>
                  )}
                </button>
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
                    {user.role === "vendor" && (
                      <DropdownMenuItem asChild>
                        <Link href="/vendor" className="flex items-center gap-2">
                          <BarChart3 className="w-4 h-4" />
                          Vendor Dashboard
                        </Link>
                      </DropdownMenuItem>
                    )}
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
              </div>
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
