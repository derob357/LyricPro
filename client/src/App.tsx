import { Toaster } from "@/components/ui/sonner";
import { TooltipProvider } from "@/components/ui/tooltip";
import NotFound from "@/pages/NotFound";
import { Route, Switch, Redirect, useSearch } from "wouter";
import ErrorBoundary from "./components/ErrorBoundary";
import { ThemeProvider } from "./contexts/ThemeContext";
import Home from "./pages/Home";
import GameSetup from "./pages/GameSetup";
import Lobby from "./pages/Lobby";
import VideoLobby from "./pages/VideoLobby";
import Gameplay from "./pages/Gameplay";
import RoundResults from "./pages/RoundResults";
import FinalResults from "./pages/FinalResults";
import Profile from "./pages/Profile";
import Leaderboards from "./pages/Leaderboards";
import ProfileCompletion from "./pages/ProfileCompletion";
import { UserDashboard } from "./pages/UserDashboard";
import { AdminDashboard } from "./pages/AdminDashboard";
import SongsList from "./pages/admin/SongsList";
import SongEdit from "./pages/admin/SongEdit";
import SongNew from "./pages/admin/SongNew";
import TournamentsList from "@/pages/admin/TournamentsList";
import TournamentNew from "@/pages/admin/TournamentNew";
import TournamentEdit from "@/pages/admin/TournamentEdit";
import AdminChatDashboard from "@/pages/admin/chat/AdminChatDashboard";
import SignIn from "./pages/SignIn";
import AuthCallback from "./pages/AuthCallback";
import AccountSecurity from "./pages/AccountSecurity";
import PasswordReset from "./pages/PasswordReset";
import Shop from "./pages/Shop";
import Avatars from "./pages/Avatars";
import ChatPage from "./pages/Chat";
import TournamentsPage from "@/pages/Tournaments";
// import JoinInvite from "./pages/JoinInvite"; // Disabled - invite codes removed
import { PersistentHeader } from "./components/PersistentHeader";
import { NotificationContainer } from "./components/NotificationToast";
import FeedbackWidget from "./components/FeedbackWidget";
import { AdminPauseButton } from "./components/AdminPauseButton";
import { ChatPanel } from "./components/chat/ChatPanel";
import { useChatPanelOpen } from "./lib/chat/chatPanelStore";
import { useRealtimeAuth } from "./lib/supabase/realtimeClient";
import { useKeyboardHeight } from "./lib/capacitor/useKeyboardHeight";

// Wrapper that keys Gameplay on the ?round= param so it fully remounts each round
function GameplayWithKey() {
  const search = useSearch();
  return <Gameplay key={search} />;
}

function Router() {
  return (
    <Switch>
      <Route path="/" component={Home} />
      <Route path="/setup" component={GameSetup} />
      <Route path="/lobby/live/:inviteCode" component={VideoLobby} />
      <Route path="/lobby/:roomCode" component={Lobby} />
      <Route path="/play/:roomCode" component={GameplayWithKey} />
      <Route path="/results/round/:roomCode" component={RoundResults} />
      <Route path="/results/final/:roomCode" component={FinalResults} />
      <Route path="/profile" component={Profile} />
      <Route path="/profile/complete" component={ProfileCompletion} />
      <Route path="/leaderboards" component={Leaderboards} />
      <Route path="/tournaments" component={TournamentsPage} />
      <Route path="/dashboard" component={UserDashboard} />
      <Route path="/admin" component={AdminDashboard} />
      <Route path="/admin/songs" component={SongsList} />
      <Route path="/admin/songs/new" component={SongNew} />
      <Route path="/admin/songs/:id" component={SongEdit} />
      <Route path="/admin/tournaments" component={TournamentsList} />
      <Route path="/admin/tournaments/new" component={TournamentNew} />
      <Route path="/admin/tournaments/:id" component={TournamentEdit} />
      <Route path="/admin/chat" component={AdminChatDashboard} />
      <Route path="/admin/usage">{() => <Redirect to="/admin?tab=usage" />}</Route>
      <Route path="/signin" component={SignIn} />
      <Route path="/auth/callback" component={AuthCallback} />
      <Route path="/auth/reset-password" component={PasswordReset} />
      <Route path="/account/security" component={AccountSecurity} />
      <Route path="/shop" component={Shop} />
      <Route path="/avatars" component={Avatars} />
      <Route path="/chat" component={ChatPage} />
      {/* <Route path="/join" component={JoinInvite} /> */} {/* Disabled - invite codes removed */}
      <Route path="/404" component={NotFound} />
      <Route component={NotFound} />
    </Switch>
  );
}

function App() {
  // Keep the Supabase Realtime WS in sync with the latest JWT so channels
  // don't silently stop delivering after token refresh. Safe to call at the
  // App root: useAuth() also subscribes to the same supabase singleton and
  // is not wrapped in a provider.
  useRealtimeAuth();

  // Reflect the on-screen keyboard height into a --kb-height CSS variable
  // so input bars / safe-area utilities can stay above the keyboard. No-op
  // on web; only fires inside the Capacitor native shell.
  useKeyboardHeight();

  // Module-scoped store wired into React so PersistentHeader can toggle the
  // desktop ChatPanel slide-over without prop drilling. Mobile bypasses this
  // and uses the /chat route directly.
  const [chatOpen, setChatOpen] = useChatPanelOpen();

  return (
    <ErrorBoundary>
      <ThemeProvider defaultTheme="dark">
        <TooltipProvider>
          <Toaster richColors position="top-center" />
          <PersistentHeader />
          <NotificationContainer />
          <FeedbackWidget />
          <AdminPauseButton />
          <ChatPanel open={chatOpen} onOpenChange={setChatOpen} />
          <div className="pt-16">
            <Router />
          </div>
        </TooltipProvider>
      </ThemeProvider>
    </ErrorBoundary>
  );
}

export default App;
