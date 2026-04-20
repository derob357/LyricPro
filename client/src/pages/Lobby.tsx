import { useState, useEffect } from "react";
import { useLocation, useParams } from "wouter";
import { motion } from "framer-motion";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { trpc } from "@/lib/trpc";
import { useAuth } from "@/_core/hooks/useAuth";
import { toast } from "sonner";
import { Copy, Check, Users, Crown, Wifi, ArrowLeft, Play, UserCheck, Clock, Music } from "lucide-react";

const TEAM_COLORS = ["#8B5CF6", "#06B6D4", "#F59E0B", "#10B981", "#EF4444", "#EC4899"];
const TEAM_NAMES = ["Team Purple", "Team Cyan", "Team Gold", "Team Green", "Team Red", "Team Pink"];

export default function Lobby() {
  const { roomCode } = useParams<{ roomCode: string }>();
  const [, navigate] = useLocation();
  const { user, isAuthenticated } = useAuth();
  const [copied, setCopied] = useState(false);
  const [isReady, setIsReady] = useState(false);
  const [isStarting, setIsStarting] = useState(false);
  const [hasJoined, setHasJoined] = useState(false);

  const { data: room, refetch } = trpc.game.getRoom.useQuery(
    { roomCode: roomCode ?? "" },
    { enabled: !!roomCode && isAuthenticated, refetchInterval: 2000 }
  );

  const joinMutation = trpc.game.joinRoom.useMutation({
    onSuccess: () => setHasJoined(true),
    onError: (e) => {
      if (e.message?.includes("already") || e.message?.includes("started")) {
        setHasJoined(true);
      } else {
        toast.error(e.message);
      }
    },
  });
  const readyMutation = trpc.game.setReady.useMutation({
    onSuccess: () => { setIsReady(true); refetch(); },
  });
  const startMutation = trpc.game.startGame.useMutation({
    onSuccess: () => navigate(`/play/${roomCode}`),
    onError: (e) => { toast.error(e.message); setIsStarting(false); },
  });

  // Redirect unauthenticated users to sign in
  useEffect(() => {
    if (!isAuthenticated && user !== undefined) {
      // Store the lobby URL so we can return after sign in
      sessionStorage.setItem("lyricpro_return_to", window.location.pathname);
      window.location.href = `${import.meta.env.VITE_OAUTH_PORTAL_URL}/app-auth?appId=${import.meta.env.VITE_APP_ID}&redirectUri=${encodeURIComponent(window.location.origin + "/api/oauth/callback")}&state=${btoa(window.location.origin + "/api/oauth/callback")}&type=signIn`;
    }
  }, [isAuthenticated, user]);

  // Join room once authenticated
  useEffect(() => {
    if (roomCode && isAuthenticated && !hasJoined) {
      joinMutation.mutate({ roomCode });
    }
  }, [roomCode, isAuthenticated]);

  // Redirect when game starts
  useEffect(() => {
    if (room?.status === "active") {
      navigate(`/play/${roomCode}`);
    }
  }, [room?.status]);

  const handleCopyCode = () => {
    navigator.clipboard.writeText(roomCode ?? "");
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const handleCopyLink = () => {
    navigator.clipboard.writeText(`${window.location.origin}/lobby/${roomCode}`);
    toast.success("Invite link copied!");
  };

  const handleReady = () => {
    readyMutation.mutate({ roomCode: roomCode ?? "" });
  };

  const handleStart = () => {
    setIsStarting(true);
    startMutation.mutate({ roomCode: roomCode ?? "" });
  };

  const isHost = room && isAuthenticated && user && room.hostUserId === user.id;
  const allReady = room?.players && room.players.length > 1 && room.players.every(p => p.isReady);
  const myPlayer = room?.players?.find(p => isAuthenticated && user && p.userId === user.id);

  if (!room) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <div className="text-center">
          <div className="w-12 h-12 rounded-full border-2 border-primary border-t-transparent animate-spin mx-auto mb-4" />
          <p className="text-muted-foreground">Loading lobby...</p>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen text-foreground">
      {/* Header */}
      <div className="glass border-b border-border/50 sticky top-0 z-40">
        <div className="container flex items-center justify-between h-16">
          <button onClick={() => navigate("/")} className="flex items-center gap-2 text-muted-foreground hover:text-foreground transition-colors">
            <ArrowLeft className="w-4 h-4" />
            <span className="text-sm">Leave</span>
          </button>
          <h1 className="font-display font-bold text-lg text-gradient">Game Lobby</h1>
          <Badge variant="secondary" className="text-xs">
            <Wifi className="w-3 h-3 mr-1" />
            {room.mode === "solo" ? "Solo" : room.mode === "multiplayer" ? "Multiplayer" : "Team Mode"}
          </Badge>
        </div>
      </div>

      <div className="container py-8 max-w-2xl">
        <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} className="space-y-6">

          {/* Room Code */}
          <div className="glass rounded-2xl p-6 text-center">
            <p className="text-muted-foreground text-sm mb-2">Room Code</p>
            <div className="font-display text-5xl font-black text-gradient tracking-widest mb-4">
              {roomCode}
            </div>
            <div className="flex gap-3 justify-center">
              <Button variant="outline" size="sm" onClick={handleCopyCode} className="border-border/50">
                {copied ? <Check className="w-4 h-4 mr-1 text-green-400" /> : <Copy className="w-4 h-4 mr-1" />}
                {copied ? "Copied!" : "Copy Code"}
              </Button>
              <Button variant="outline" size="sm" onClick={handleCopyLink} className="border-border/50">
                <Wifi className="w-4 h-4 mr-1" /> Share Invite Link
              </Button>
            </div>
            <p className="text-muted-foreground text-xs mt-3">
              Share this code or link with friends to join
            </p>
          </div>

          {/* Game Settings Summary */}
          <div className="glass rounded-xl p-4">
            <h3 className="font-semibold text-sm text-muted-foreground mb-3 uppercase tracking-wide">Game Settings</h3>
            <div className="flex flex-wrap gap-2">
              <Badge variant="secondary">{room.difficulty} difficulty</Badge>
              <Badge variant="secondary">{room.timerSeconds}s timer</Badge>
              <Badge variant="secondary">{room.roundsTotal} rounds</Badge>
              <Badge variant="secondary">{room.rankingMode.replace("_", " ")}</Badge>
              {room.selectedGenres.slice(0, 3).map((g: string) => (
                <Badge key={g} variant="outline" className="border-primary/30 text-primary">{g}</Badge>
              ))}
            </div>
          </div>

          {/* Players */}
          <div className="glass rounded-2xl p-6">
            <div className="flex items-center justify-between mb-4">
              <h3 className="font-display font-semibold text-lg flex items-center gap-2">
                <Users className="w-5 h-5 text-primary" />
                Players ({room.players?.length ?? 0})
              </h3>
              {room.players && room.players.length < 2 && (
                <span className="text-muted-foreground text-sm flex items-center gap-1">
                  <Clock className="w-3 h-3" /> Waiting for players...
                </span>
              )}
            </div>
            <div className="space-y-3">
              {room.players?.map((player, idx) => {
                const isMe = isAuthenticated && user && player.userId === user.id;
                const playerName = player.guestName || (player.userId ? user?.firstName || user?.name?.split(" ")[0] || `Player ${idx + 1}` : "Unknown");
                const isPlayerHost = room.hostUserId === player.userId;

                return (
                  <motion.div
                    key={player.id}
                    initial={{ opacity: 0, x: -10 }}
                    animate={{ opacity: 1, x: 0 }}
                    transition={{ delay: idx * 0.1 }}
                    className={`flex items-center justify-between p-3 rounded-xl border ${
                      isMe ? "border-primary/40 bg-primary/5" : "border-border/30 bg-card/30"
                    }`}
                  >
                    <div className="flex items-center gap-3">
                      <div className={`w-8 h-8 rounded-full flex items-center justify-center text-sm font-bold ${
                        isMe ? "bg-primary/20 text-primary" : "bg-secondary text-foreground"
                      }`}>
                        {playerName.charAt(0).toUpperCase()}
                      </div>
                      <div>
                        <span className="font-medium text-foreground">{playerName}</span>
                        {isMe && <span className="text-primary text-xs ml-1">(you)</span>}
                        {isPlayerHost && <Crown className="w-3 h-3 text-yellow-400 inline ml-1" />}
                      </div>
                    </div>
                    <div className="flex items-center gap-2">
                      {player.isReady ? (
                        <Badge className="bg-green-500/20 text-green-400 border-green-500/30 text-xs">
                          <UserCheck className="w-3 h-3 mr-1" /> Ready
                        </Badge>
                      ) : (
                        <Badge variant="secondary" className="text-xs">Waiting</Badge>
                      )}
                    </div>
                  </motion.div>
                );
              })}
            </div>
          </div>

          {/* Remote play tip */}
          <div className="glass rounded-xl p-4 border border-accent/20">
            <p className="text-sm text-muted-foreground">
              <span className="text-accent font-medium">Remote Play Tip:</span> Share the room code with friends on FaceTime, WhatsApp, or Zoom. Each player joins from their own device.
            </p>
          </div>

          {/* Action buttons */}
          <div className="space-y-3">
            {!isReady && !myPlayer?.isReady && (
              <Button
                className="w-full bg-accent/20 border border-accent/40 text-accent hover:bg-accent/30 py-5 font-semibold rounded-xl"
                onClick={handleReady}
                disabled={readyMutation.isPending}
              >
                <UserCheck className="w-5 h-5 mr-2" />
                {readyMutation.isPending ? "Marking ready..." : "I'm Ready!"}
              </Button>
            )}

            {isHost && (
              <Button
                className="w-full bg-primary text-primary-foreground hover:bg-primary/90 glow-purple py-5 text-lg font-semibold rounded-xl"
                onClick={handleStart}
                disabled={isStarting || (room.mode !== "solo" && !allReady && (room.players?.length ?? 0) < 2)}
              >
                <Play className="w-5 h-5 mr-2" />
                {isStarting ? "Starting..." : "Start Game"}
              </Button>
            )}

            {!isHost && (
              <p className="text-center text-muted-foreground text-sm">
                Waiting for the host to start the game...
              </p>
            )}
          </div>
        </motion.div>
      </div>
    </div>
  );
}
