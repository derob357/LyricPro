import { useEffect, useState } from "react";
import { useLocation } from "wouter";
import { supabase } from "@/lib/supabase";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { toast } from "sonner";
import { ShieldCheck } from "lucide-react";
import {
  validateNewPassword,
  describeIssue,
  PASSWORD_MIN,
  PASSWORD_MAX,
  type PasswordIssue,
} from "@/lib/passwordValidation";

// Landing page after a user clicks the password-reset link in their email.
// At this point Supabase has populated a recovery session in the URL hash;
// supabase-js parses it on load. We only need to call updateUser({ password }).
//
// If the user lands here without a recovery session (link expired, opened
// directly), we surface an error and bounce them to /signin.

export default function PasswordReset() {
  const [, navigate] = useLocation();
  const [hasSession, setHasSession] = useState<boolean | null>(null);
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [issues, setIssues] = useState<PasswordIssue[]>([]);
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    // supabase-js auto-parses the URL hash on load (#access_token=...).
    // Listen once for the recovery session, or check synchronously.
    let cancelled = false;
    supabase.auth.getSession().then(({ data }) => {
      if (cancelled) return;
      setHasSession(!!data.session);
    });
    return () => { cancelled = true; };
  }, []);

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
        toast.error(error.message);
        return;
      }
      toast.success("Password updated. You're signed in.");
      navigate("/");
    } finally {
      setSubmitting(false);
    }
  };

  if (hasSession === null) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <div className="w-12 h-12 rounded-full border-2 border-primary border-t-transparent animate-spin" />
      </div>
    );
  }

  if (!hasSession) {
    return (
      <div className="min-h-screen flex items-center justify-center px-4">
        <div className="glass rounded-2xl p-8 max-w-md w-full text-center border border-border/50">
          <p className="font-medium mb-2">This reset link is invalid or has expired.</p>
          <p className="text-sm text-muted-foreground mb-4">Request a fresh one from the sign-in page.</p>
          <Button onClick={() => navigate("/signin")}>Back to sign in</Button>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen flex items-center justify-center px-4">
      <div className="glass rounded-2xl p-8 max-w-md w-full border border-border/50">
        <div className="flex items-center gap-2 mb-2">
          <ShieldCheck className="w-5 h-5 text-primary" />
          <h1 className="font-display font-bold text-xl text-gradient">Choose a new password</h1>
        </div>
        <p className="text-muted-foreground text-sm mb-6">
          Set a new password for your account. You'll be signed in immediately after.
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
              autoFocus
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
            {submitting ? "Updating…" : "Set new password"}
          </Button>
        </form>

        <p className="text-xs text-muted-foreground mt-6">
          Requirements: {PASSWORD_MIN}-{PASSWORD_MAX} characters, with at least one uppercase letter, one digit, and one symbol. Passwords found in known data breaches are rejected.
        </p>
      </div>
    </div>
  );
}
