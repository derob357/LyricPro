import { useState, useEffect } from "react";
import { useLocation } from "wouter";
import { motion } from "framer-motion";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { trpc } from "@/lib/trpc";
import { useAuth } from "@/_core/hooks/useAuth";
import { Music, User, CheckCircle } from "lucide-react";
import { toast } from "sonner";

export default function ProfileCompletion() {
  const [, navigate] = useLocation();
  const { user, isAuthenticated, loading, refresh } = useAuth();
  const utils = trpc.useUtils();

  const [firstName, setFirstName] = useState("");
  const [lastName, setLastName] = useState("");
  const [email, setEmail] = useState("");

  // Pre-fill from OAuth data
  useEffect(() => {
    if (user) {
      if (user.firstName) setFirstName(user.firstName);
      else if (user.name) {
        const parts = user.name.trim().split(/\s+/);
        setFirstName(parts[0] || "");
        setLastName(parts.length > 1 ? parts.slice(1).join(" ") : "");
      }
      if (user.email) setEmail(user.email);
    }
  }, [user]);

  const updateProfileMutation = trpc.auth.updateProfile.useMutation({
    onSuccess: async () => {
      await utils.auth.me.invalidate();
      await refresh();
      toast.success("Profile saved! Welcome to LyricPro Ai!");
      navigate("/setup");
    },
    onError: (err) => {
      toast.error(err.message || "Failed to save profile");
    },
  });

  const handleSubmit = () => {
    if (!firstName.trim()) {
      toast.error("First name is required");
      return;
    }
    updateProfileMutation.mutate({
      firstName: firstName.trim(),
      lastName: lastName.trim(),
    });
  };

  // Redirect if not authenticated
  if (!loading && !isAuthenticated) {
    navigate("/");
    return null;
  }

  // If already has firstName, skip this page
  if (!loading && user?.firstName) {
    navigate("/setup");
    return null;
  }

  return (
    <div className="min-h-screen flex items-center justify-center p-4">
      <motion.div
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        className="w-full max-w-md"
      >
        {/* Logo */}
        <div className="text-center mb-8">
          <div className="inline-flex items-center gap-2 mb-3">
            <div className="w-10 h-10 rounded-xl bg-primary/20 flex items-center justify-center">
              <Music className="w-5 h-5 text-primary" />
            </div>
            <span className="font-display font-bold text-xl text-gradient">LyricPro Ai</span>
          </div>
          <h1 className="font-display text-2xl font-bold text-foreground mb-1">
            Complete Your Profile
          </h1>
          <p className="text-muted-foreground text-sm">
            Just a few details to get you started
          </p>
        </div>

        {/* Form */}
        <div className="glass-strong rounded-2xl border border-border/50 p-6 space-y-5">
          <div className="flex items-center gap-3 p-3 rounded-lg bg-primary/10 border border-primary/20">
            <CheckCircle className="w-4 h-4 text-primary flex-shrink-0" />
            <p className="text-sm text-primary">
              Signed in as <strong>{user?.email || user?.name || "you"}</strong>
            </p>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label htmlFor="firstName" className="text-foreground font-medium text-sm">
                First Name <span className="text-red-400">*</span>
              </Label>
              <Input
                id="firstName"
                placeholder="e.g. Jamie"
                value={firstName}
                onChange={(e) => setFirstName(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && handleSubmit()}
                className="bg-input border-border/50 text-foreground placeholder:text-muted-foreground"
                maxLength={64}
                autoFocus
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="lastName" className="text-foreground font-medium text-sm">
                Last Name
              </Label>
              <Input
                id="lastName"
                placeholder="e.g. Smith"
                value={lastName}
                onChange={(e) => setLastName(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && handleSubmit()}
                className="bg-input border-border/50 text-foreground placeholder:text-muted-foreground"
                maxLength={64}
              />
            </div>
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="email" className="text-foreground font-medium text-sm">
              Email Address
            </Label>
            <Input
              id="email"
              type="email"
              placeholder="your@email.com"
              value={email}
              disabled
              className="bg-input/50 border-border/30 text-muted-foreground cursor-not-allowed"
            />
            <p className="text-xs text-muted-foreground">
              Email is managed by your sign-in provider and cannot be changed here.
            </p>
          </div>

          <Button
            className="w-full bg-primary text-primary-foreground hover:bg-primary/90 glow-purple py-5 text-base font-semibold"
            onClick={handleSubmit}
            disabled={updateProfileMutation.isPending || !firstName.trim()}
          >
            {updateProfileMutation.isPending ? (
              <span className="flex items-center gap-2">
                <span className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                Saving...
              </span>
            ) : (
              <span className="flex items-center gap-2">
                <User className="w-4 h-4" />
                Save & Start Playing
              </span>
            )}
          </Button>

          <button
            onClick={() => navigate("/setup")}
            className="w-full text-center text-xs text-muted-foreground hover:text-foreground transition-colors"
          >
            Skip for now
          </button>
        </div>
      </motion.div>
    </div>
  );
}
