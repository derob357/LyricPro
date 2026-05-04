import { useState } from "react";
import { useLocation } from "wouter";
import { supabase } from "@/lib/supabase";
import { useAuth } from "@/_core/hooks/useAuth";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { toast } from "sonner";
import { ArrowLeft, ShieldCheck } from "lucide-react";
import {
  validateNewPassword,
  describeIssue,
  PASSWORD_MIN,
  PASSWORD_MAX,
  type PasswordIssue,
} from "@/lib/passwordValidation";

// Set or change the signed-in user's password. Magic-link signups have no
// password by default; this page is how they add one. Subsequent visits
// are "change password."

export default function AccountSecurity() {
  const [, navigate] = useLocation();
  const { user, isAuthenticated, loading: authLoading } = useAuth();
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [issues, setIssues] = useState<PasswordIssue[]>([]);
  const [submitting, setSubmitting] = useState(false);

  if (authLoading) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <div className="w-12 h-12 rounded-full border-2 border-primary border-t-transparent animate-spin" />
      </div>
    );
  }

  if (!isAuthenticated || !user) {
    return (
      <div className="min-h-screen flex items-center justify-center px-4">
        <div className="glass rounded-2xl p-8 max-w-md w-full text-center">
          <p className="text-muted-foreground mb-4">Sign in to manage your password.</p>
          <Button onClick={() => navigate("/signin")}>Go to sign in</Button>
        </div>
      </div>
    );
  }

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (submitting) return;

    if (newPassword !== confirmPassword) {
      toast.error("Passwords don't match");
      return;
    }

    setSubmitting(true);
    try {
      const found = await validateNewPassword(newPassword);
      if (found.length > 0) {
        setIssues(found);
        return;
      }
      setIssues([]);
      const { error } = await supabase.auth.updateUser({ password: newPassword });
      if (error) {
        // Surface real Supabase errors (e.g. weak per-project policy).
        toast.error(error.message);
        return;
      }
      toast.success("Password updated");
      setNewPassword("");
      setConfirmPassword("");
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="min-h-screen px-4 py-8">
      <div className="max-w-md mx-auto">
        <button
          type="button"
          onClick={() => navigate("/profile")}
          className="flex items-center gap-2 text-sm text-muted-foreground hover:text-foreground transition-colors mb-6"
        >
          <ArrowLeft className="w-4 h-4" />
          Back to profile
        </button>

        <div className="glass rounded-2xl p-8 border border-border/50">
          <div className="flex items-center gap-2 mb-2">
            <ShieldCheck className="w-5 h-5 text-primary" />
            <h1 className="font-display font-bold text-xl text-gradient">
              Account security
            </h1>
          </div>
          <p className="text-muted-foreground text-sm mb-6">
            Set or change your password. After this, you'll be able to sign in with email + password instead of (or in addition to) the magic link.
          </p>

          <form onSubmit={handleSubmit} className="space-y-4">
            <div>
              <Label htmlFor="new-password" className="text-foreground">New password</Label>
              <Input
                id="new-password"
                type="password"
                required
                value={newPassword}
                onChange={(e) => { setNewPassword(e.target.value); setIssues([]); }}
                placeholder={`At least ${PASSWORD_MIN} characters`}
                className="bg-input border-border/50 mt-1"
                disabled={submitting}
                autoComplete="new-password"
                minLength={PASSWORD_MIN}
                maxLength={PASSWORD_MAX}
              />
            </div>
            <div>
              <Label htmlFor="confirm-password" className="text-foreground">Confirm new password</Label>
              <Input
                id="confirm-password"
                type="password"
                required
                value={confirmPassword}
                onChange={(e) => setConfirmPassword(e.target.value)}
                placeholder="Repeat the password"
                className="bg-input border-border/50 mt-1"
                disabled={submitting}
                autoComplete="new-password"
                minLength={PASSWORD_MIN}
                maxLength={PASSWORD_MAX}
              />
            </div>

            {issues.length > 0 && (
              <ul className="text-xs text-red-400 space-y-1 list-disc list-inside">
                {issues.map((i) => (
                  <li key={i}>{describeIssue(i)}</li>
                ))}
              </ul>
            )}

            <Button
              type="submit"
              disabled={submitting || !newPassword || !confirmPassword}
              className="w-full bg-primary text-primary-foreground hover:bg-primary/90 glow-purple"
            >
              {submitting ? "Updating…" : "Update password"}
            </Button>
          </form>

          <p className="text-xs text-muted-foreground mt-6">
            Password requirements: {PASSWORD_MIN}-{PASSWORD_MAX} characters, with at least one uppercase letter, one digit, and one symbol. Passwords found in known data breaches are rejected.
          </p>
        </div>
      </div>
    </div>
  );
}
