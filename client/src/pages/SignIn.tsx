import { useState } from "react";
import { useLocation } from "wouter";
import { supabase } from "@/lib/supabase";
import { trpc } from "@/lib/trpc";
import { IS_NATIVE } from "@/lib/platform";
import { AUTH_CALLBACK_URL } from "@/lib/deepLink";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { toast } from "sonner";
import { Mail, Music, Terminal } from "lucide-react";

// Sign-in paths offered:
// 1) Magic link (email) — default, passwordless. Delivered via Resend
//    (auth.sendMagicLink) so we sidestep Supabase's email rate limit.
// 2) Email + password — for users who've set one via /account/security.
// 3) Forgot password — sends a recovery link via Resend
//    (auth.sendPasswordReset) that lands on /auth/reset-password.
// 4) Continue with Google / Apple — Supabase OAuth, unchanged.

type Mode = "magic" | "password" | "reset-request";

export default function SignIn() {
  const [, navigate] = useLocation();
  const [mode, setMode] = useState<Mode>("magic");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [magicSent, setMagicSent] = useState(false);
  const [resetSent, setResetSent] = useState(false);
  const [loading, setLoading] = useState(false);
  const [devLink, setDevLink] = useState<string | null>(null);

  // Dev-only: skip the email round-trip entirely.
  const devGenerateLink = trpc.auth.devGenerateMagicLink.useMutation({
    onSuccess: (data) => {
      setDevLink(data.actionLink);
      if (data.actionLink) {
        navigator.clipboard?.writeText(data.actionLink).catch(() => {});
        toast.success("Magic link copied to clipboard");
      }
    },
    onError: (err) => toast.error(err.message),
  });

  const sendMagicLinkMutation = trpc.auth.sendMagicLink.useMutation({
    onSuccess: () => setMagicSent(true),
    onError: (err) => toast.error(err.message),
    onSettled: () => setLoading(false),
  });

  const sendPasswordResetMutation = trpc.auth.sendPasswordReset.useMutation({
    onSuccess: () => setResetSent(true),
    onError: (err) => toast.error(err.message),
    onSettled: () => setLoading(false),
  });

  const sendMagicLink = (e: React.FormEvent) => {
    e.preventDefault();
    if (!email) return;
    setLoading(true);
    const redirectTo = IS_NATIVE
      ? AUTH_CALLBACK_URL
      : `${window.location.origin}/auth/callback`;
    sendMagicLinkMutation.mutate({ email, redirectTo });
  };

  const signInWithPassword = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!email || !password) return;
    setLoading(true);
    try {
      const { error } = await supabase.auth.signInWithPassword({ email, password });
      if (error) {
        // Generic message — never differentiate "no such email" from
        // "wrong password" to prevent account enumeration.
        toast.error("Invalid email or password");
        return;
      }
      // Session is now set in the supabase client. Land on home and let
      // the auth context pick it up on next render.
      navigate("/");
    } finally {
      setLoading(false);
    }
  };

  const sendPasswordReset = (e: React.FormEvent) => {
    e.preventDefault();
    if (!email) return;
    setLoading(true);
    sendPasswordResetMutation.mutate({ email });
  };

  const signInWith = async (provider: "google" | "apple") => {
    setLoading(true);
    try {
      const redirectTo = IS_NATIVE
        ? AUTH_CALLBACK_URL
        : `${window.location.origin}/auth/callback`;
      const { error } = await supabase.auth.signInWithOAuth({
        provider,
        options: { redirectTo },
      });
      if (error) throw error;
      // signInWithOAuth redirects the browser — no further code runs here.
    } catch (err) {
      toast.error(
        err instanceof Error ? err.message : `Failed to start ${provider} sign-in`
      );
      setLoading(false);
    }
  };

  const showSent = (magicSent && mode === "magic") || (resetSent && mode === "reset-request");

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

        {showSent ? (
          <div className="text-center py-8">
            <Mail className="w-8 h-8 text-accent mx-auto mb-3" />
            <p className="text-foreground font-medium">Check your inbox</p>
            <p className="text-muted-foreground text-sm mt-2">
              {magicSent
                ? <>We sent a sign-in link to <strong>{email}</strong>. Click it to finish signing in.</>
                : <>If an account exists for <strong>{email}</strong>, we sent a password-reset link.</>}
            </p>
            <p className="text-muted-foreground text-xs mt-2 italic">
              (Don't forget to check your spam folder)
            </p>
            <Button
              variant="ghost"
              className="mt-6"
              onClick={() => {
                setMagicSent(false);
                setResetSent(false);
                setEmail("");
                setMode("magic");
              }}
            >
              Use a different email
            </Button>
          </div>
        ) : (
          <>
            {/* Mode tabs — Magic link is the default */}
            {mode !== "reset-request" && (
              <div className="grid grid-cols-2 gap-1 p-1 bg-muted/40 rounded-lg mb-4">
                <button
                  type="button"
                  onClick={() => setMode("magic")}
                  className={`text-sm font-medium py-2 rounded-md transition-colors ${
                    mode === "magic"
                      ? "bg-card text-foreground shadow-sm"
                      : "text-muted-foreground hover:text-foreground"
                  }`}
                >
                  Magic link
                </button>
                <button
                  type="button"
                  onClick={() => setMode("password")}
                  className={`text-sm font-medium py-2 rounded-md transition-colors ${
                    mode === "password"
                      ? "bg-card text-foreground shadow-sm"
                      : "text-muted-foreground hover:text-foreground"
                  }`}
                >
                  Password
                </button>
              </div>
            )}

            {mode === "magic" && (
              <form onSubmit={sendMagicLink} className="space-y-3">
                <Label htmlFor="email" className="text-foreground">Email</Label>
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
                  autoComplete="email"
                />
                <Button
                  type="submit"
                  disabled={loading || !email}
                  className="w-full bg-primary text-primary-foreground hover:bg-primary/90 glow-purple"
                >
                  {loading ? "Sending…" : "Send magic link"}
                </Button>
              </form>
            )}

            {mode === "password" && (
              <form onSubmit={signInWithPassword} className="space-y-3">
                <div>
                  <Label htmlFor="email" className="text-foreground">Email</Label>
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
                    autoComplete="email"
                  />
                </div>
                <div>
                  <Label htmlFor="password" className="text-foreground">Password</Label>
                  <Input
                    id="password"
                    type="password"
                    required
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    placeholder="Your password"
                    className="bg-input border-border/50"
                    disabled={loading}
                    autoComplete="current-password"
                    maxLength={128}
                  />
                </div>
                <Button
                  type="submit"
                  disabled={loading || !email || !password}
                  className="w-full bg-primary text-primary-foreground hover:bg-primary/90 glow-purple"
                >
                  {loading ? "Signing in…" : "Sign in"}
                </Button>
                <button
                  type="button"
                  onClick={() => { setMode("reset-request"); setPassword(""); }}
                  className="block w-full text-center text-xs text-muted-foreground hover:text-foreground transition-colors"
                >
                  Forgot password?
                </button>
              </form>
            )}

            {mode === "reset-request" && (
              <form onSubmit={sendPasswordReset} className="space-y-3">
                <div>
                  <Label htmlFor="email" className="text-foreground">Email</Label>
                  <p className="text-xs text-muted-foreground mt-1 mb-2">
                    We'll send a link to choose a new password.
                  </p>
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
                    autoComplete="email"
                  />
                </div>
                <Button
                  type="submit"
                  disabled={loading || !email}
                  className="w-full bg-primary text-primary-foreground hover:bg-primary/90 glow-purple"
                >
                  {loading ? "Sending…" : "Send reset link"}
                </Button>
                <button
                  type="button"
                  onClick={() => setMode("password")}
                  className="block w-full text-center text-xs text-muted-foreground hover:text-foreground transition-colors"
                >
                  Back to sign in
                </button>
              </form>
            )}

            <div className="relative my-6">
              <div className="absolute inset-0 flex items-center">
                <span className="w-full border-t border-border/50" />
              </div>
              <div className="relative flex justify-center text-xs uppercase">
                <span className="bg-card px-2 text-muted-foreground">Or continue with</span>
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

            {/* DEV-ONLY: bypass the email round-trip and generate the magic
                link URL directly. Visible only when Vite is in dev mode. */}
            {import.meta.env.DEV && mode === "magic" && (
              <div className="mt-6 border-t border-border/50 pt-4">
                <div className="flex items-center gap-2 text-xs text-muted-foreground mb-2">
                  <Terminal className="w-3 h-3" />
                  <span className="uppercase tracking-wider">Dev tools</span>
                </div>
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  disabled={!email || devGenerateLink.isPending}
                  onClick={() => devGenerateLink.mutate({ email })}
                  className="w-full border-border/50"
                >
                  {devGenerateLink.isPending ? "Generating…" : "Generate magic link URL (skip email)"}
                </Button>
                {devLink && (
                  <div className="mt-3 p-3 bg-muted/50 rounded-md text-xs break-all text-muted-foreground">
                    <p className="text-foreground mb-1">Copied to clipboard. Or click to sign in now:</p>
                    <a href={devLink} className="text-accent underline" rel="noreferrer">
                      Open magic link
                    </a>
                  </div>
                )}
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
}
