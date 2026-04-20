import { useState } from "react";
import { supabase } from "@/lib/supabase";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { toast } from "sonner";
import { Mail, Music } from "lucide-react";

// Neutral, brand-consistent sign-in. Three paths:
// 1) Magic link (email) — default, zero external setup
// 2) Continue with Google — requires Google OAuth app configured in
//    Supabase Dashboard → Authentication → Providers
// 3) Continue with Apple — requires Apple Services ID + private key
//    configured in Supabase Dashboard. Also required by Apple for
//    App Store submission if any social login is offered.

export default function SignIn() {
  const [email, setEmail] = useState("");
  const [sent, setSent] = useState(false);
  const [loading, setLoading] = useState(false);

  const sendMagicLink = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!email) return;
    setLoading(true);
    try {
      const { error } = await supabase.auth.signInWithOtp({
        email,
        options: {
          emailRedirectTo: `${window.location.origin}/auth/callback`,
          shouldCreateUser: false, // bootstrap-only accounts for now
        },
      });
      if (error) throw error;
      setSent(true);
    } catch (err) {
      toast.error(
        err instanceof Error ? err.message : "Failed to send magic link"
      );
    } finally {
      setLoading(false);
    }
  };

  const signInWith = async (provider: "google" | "apple") => {
    setLoading(true);
    try {
      const { error } = await supabase.auth.signInWithOAuth({
        provider,
        options: {
          redirectTo: `${window.location.origin}/auth/callback`,
        },
      });
      if (error) throw error;
      // signInWithOAuth redirects the browser — no further code runs here.
    } catch (err) {
      toast.error(
        err instanceof Error
          ? err.message
          : `Failed to start ${provider} sign-in`
      );
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen flex items-center justify-center px-4 relative overflow-hidden">
      <div className="absolute top-0 left-1/4 w-[28rem] h-[28rem] rounded-full bg-primary/20 blur-3xl pointer-events-none" />
      <div className="absolute bottom-0 right-1/4 w-[22rem] h-[22rem] rounded-full bg-accent/15 blur-3xl pointer-events-none" />

      <div className="relative z-10 w-full max-w-md glass rounded-2xl p-8 border border-border/50">
        <div className="flex items-center gap-2 mb-6">
          <div className="w-9 h-9 rounded-lg bg-primary/20 flex items-center justify-center glow-purple">
            <Music className="w-4 h-4 text-primary" />
          </div>
          <h1 className="font-display font-bold text-xl text-gradient">
            Sign in to LyricPro Ai
          </h1>
        </div>

        {sent ? (
          <div className="text-center py-8">
            <Mail className="w-8 h-8 text-accent mx-auto mb-3" />
            <p className="text-foreground font-medium">Check your inbox</p>
            <p className="text-muted-foreground text-sm mt-2">
              We sent a sign-in link to <strong>{email}</strong>. Click it to
              finish signing in.
            </p>
            <Button
              variant="ghost"
              className="mt-6"
              onClick={() => {
                setSent(false);
                setEmail("");
              }}
            >
              Use a different email
            </Button>
          </div>
        ) : (
          <>
            <form onSubmit={sendMagicLink} className="space-y-3">
              <Label htmlFor="email" className="text-foreground">
                Email
              </Label>
              <Input
                id="email"
                type="email"
                required
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="you@example.com"
                className="bg-input border-border/50"
                disabled={loading}
                autoFocus
              />
              <Button
                type="submit"
                disabled={loading || !email}
                className="w-full bg-primary text-primary-foreground hover:bg-primary/90 glow-purple"
              >
                {loading ? "Sending…" : "Send magic link"}
              </Button>
            </form>

            <div className="relative my-6">
              <div className="absolute inset-0 flex items-center">
                <span className="w-full border-t border-border/50" />
              </div>
              <div className="relative flex justify-center text-xs uppercase">
                <span className="bg-card px-2 text-muted-foreground">
                  Or continue with
                </span>
              </div>
            </div>

            <div className="grid gap-2">
              <Button
                type="button"
                variant="outline"
                onClick={() => signInWith("google")}
                disabled={loading}
                className="border-border/50"
              >
                <svg className="w-4 h-4 mr-2" viewBox="0 0 24 24" aria-hidden>
                  <path fill="#EA4335" d="M12 10.2v3.8h5.3c-.2 1.4-1.6 4-5.3 4-3.2 0-5.8-2.6-5.8-5.9S8.8 6.2 12 6.2c1.8 0 3 .8 3.7 1.4l2.5-2.4C16.6 3.8 14.5 3 12 3 7 3 3 7 3 12s4 9 9 9c5.2 0 8.6-3.7 8.6-8.8 0-.6-.1-1-.1-1.4H12z" />
                </svg>
                Continue with Google
              </Button>
              <Button
                type="button"
                variant="outline"
                onClick={() => signInWith("apple")}
                disabled={loading}
                className="border-border/50"
              >
                <svg className="w-4 h-4 mr-2" viewBox="0 0 24 24" aria-hidden>
                  <path fill="currentColor" d="M16.4 12.5c0-2.6 2.1-3.8 2.2-3.9-1.2-1.7-3-2-3.7-2-1.6-.2-3 .9-3.8.9-.8 0-2-.9-3.3-.9-1.7 0-3.3 1-4.2 2.5-1.8 3.1-.5 7.7 1.3 10.2.9 1.2 1.9 2.6 3.3 2.5 1.3-.1 1.8-.9 3.4-.9 1.6 0 2 .9 3.4.8 1.4 0 2.3-1.2 3.1-2.5.7-1 1.2-2 1.5-3.1-.1 0-2.9-1.1-3-4.4-.1 0-.2-.2-.2-.2zM14 4.2c.7-.9 1.2-2.1 1.1-3.2-1 0-2.2.6-3 1.5-.6.7-1.2 1.9-1.1 3.1 1.1.1 2.3-.5 3-1.4z" />
                </svg>
                Continue with Apple
              </Button>
            </div>

            <p className="text-xs text-muted-foreground text-center mt-6">
              Only invited accounts can sign in during this preview.
            </p>
          </>
        )}
      </div>
    </div>
  );
}
