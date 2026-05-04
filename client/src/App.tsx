import { Toaster } from "@/components/ui/sonner";
import { TooltipProvider } from "@/components/ui/tooltip";
import NotFound from "@/pages/NotFound";
import { Route, Switch, useSearch } from "wouter";
import ErrorBoundary from "./components/ErrorBoundary";
import { ThemeProvider } from "./contexts/ThemeContext";
import Home from "./pages/Home";
import GameSetup from "./pages/GameSetup";
import Lobby from "./pages/Lobby";
import Gameplay from "./pages/Gameplay";
import RoundResults from "./pages/RoundResults";
import FinalResults from "./pages/FinalResults";
import Profile from "./pages/Profile";
import Leaderboards from "./pages/Leaderboards";
import ProfileCompletion from "./pages/ProfileCompletion";
import { UserDashboard } from "./pages/UserDashboard";
import { AdminDashboard } from "./pages/AdminDashboard";
import UsageReport from "./pages/UsageReport";
import SignIn from "./pages/SignIn";
import AuthCallback from "./pages/AuthCallback";
import AccountSecurity from "./pages/AccountSecurity";
import PasswordReset from "./pages/PasswordReset";
import Shop from "./pages/Shop";
import Avatars from "./pages/Avatars";
// import JoinInvite from "./pages/JoinInvite"; // Disabled - invite codes removed
import { PersistentHeader } from "./components/PersistentHeader";
import { NotificationContainer } from "./components/NotificationToast";
import FeedbackWidget from "./components/FeedbackWidget";
import { AdminPauseButton } from "./components/AdminPauseButton";

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
      <Route path="/lobby/:roomCode" component={Lobby} />
      <Route path="/play/:roomCode" component={GameplayWithKey} />
      <Route path="/results/round/:roomCode" component={RoundResults} />
      <Route path="/results/final/:roomCode" component={FinalResults} />
      <Route path="/profile" component={Profile} />
      <Route path="/profile/complete" component={ProfileCompletion} />
      <Route path="/leaderboards" component={Leaderboards} />
      <Route path="/dashboard" component={UserDashboard} />
      <Route path="/admin" component={AdminDashboard} />
      <Route path="/admin/usage" component={UsageReport} />
      <Route path="/signin" component={SignIn} />
      <Route path="/auth/callback" component={AuthCallback} />
      <Route path="/auth/reset-password" component={PasswordReset} />
      <Route path="/account/security" component={AccountSecurity} />
      <Route path="/shop" component={Shop} />
      <Route path="/avatars" component={Avatars} />
      {/* <Route path="/join" component={JoinInvite} /> */} {/* Disabled - invite codes removed */}
      <Route path="/404" component={NotFound} />
      <Route component={NotFound} />
    </Switch>
  );
}

function App() {
  return (
    <ErrorBoundary>
      <ThemeProvider defaultTheme="dark">
        <TooltipProvider>
          <Toaster richColors position="top-center" />
          <PersistentHeader />
          <NotificationContainer />
          <FeedbackWidget />
          <AdminPauseButton />
          <div className="pt-16">
            <Router />
          </div>
        </TooltipProvider>
      </ThemeProvider>
    </ErrorBoundary>
  );
}

export default App;
