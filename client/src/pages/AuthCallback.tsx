import { useEffect, useState } from "react";
import { useLocation } from "wouter";
import { supabase } from "@/lib/supabase";
import { Button } from "@/components/ui/button";
import { Music, ShieldCheck } from "lucide-react";

// Sign-in callback. Handles every URL shape Supabase can land on
// /auth/callback with:
//
//   A. ?code=<pkce>                          — OAuth (Google/Apple) + any
//                                              client-initiated PKCE flow.
//                                              Exchange with
//                                              exchangeCodeForSession.
//
//   B. ?token_hash=<x>&type=<magiclink|...>  — admin.generateLink output
//                                              (the URL we email via Resend
//                                              for magic links). NOT a PKCE
//                                              code — has no verifier.
//                                              Exchange with verifyOtp.
//
//   C. #access_token=<jwt>&refresh_token=…   — legacy implicit-flow
//                                              fragment, still emitted by
//                                              some Supabase configurations.
//                                              Exchange with setSession.
//
// Format B is the magic-link path in this app because the server uses
// admin.auth.admin.generateLink({ type: "magiclink" }). That admin endpoint
// does NOT mint a PKCE verifier pair — it produces a server-verify URL,
// and we must call verifyOtp({ token_hash, type }) on the client.
// (auth-js#767, Supabase passwordless docs.)
//
// Two entry behaviors:
//   - OAuth (sessionStorage flag "lp-oauth-in-flight"): auto-exchange and
//     redirect home. No interstitial — the URL was never emailed.
//   - Everything else (came from an email): show click-to-confirm so
//     corporate URL scanners (Outlook Safe Links, Defender, Mimecast,
//     Proofpoint, Barracuda) that GET the page can't burn the single-use
//     token before the human clicks.

type Pending =
  | { kind: "code"; code: string }
  | { kind: "otp"; tokenHash: string; type: string }
  | { kind: "fragment"; accessToken: string; refreshToken: string }
  | null;

// Valid `type` values for verifyOtp's token_hash form. We accept what
// Supabase emits today (magiclink/signup/recovery/invite/email_change/email)
// rather than constraining server-side.
const OTP_TYPES = new Set([
  "magiclink",
  "signup",
  "recovery",
  "invite",
  "email_change",
  "email",
]);

export default function AuthCallback() {
  const [, navigate] = useLocation();
  const [pending, setPending] = useState<Pending>(null);
  const [phase, setPhase] = useState<"ready" | "exchanging" | "error">("ready");
  const [errorMsg, setErrorMsg] = useState<string>("");

  useEffect(() => {
    let cancelled = false;
    const url = new URL(window.location.href);

    const err = url.searchParams.get("error");
    const errDesc = url.searchParams.get("error_description");
    if (err) {
      setErrorMsg(errDesc ?? err);
      setPhase("error");
      return;
    }

    // Detect URL shape (A, B, or C above).
    const code = url.searchParams.get("code");
    const tokenHash = url.searchParams.get("token_hash");
    const otpType = url.searchParams.get("type");
    const hashStr = window.location.hash.startsWith("#")
      ? window.location.hash.slice(1)
      : window.location.hash;
    const hashParams = hashStr ? new URLSearchParams(hashStr) : null;
    const accessToken = hashParams?.get("access_token") ?? null;
    const refreshToken = hashParams?.get("refresh_token") ?? null;

    let detected: Pending = null;
    if (code) {
      detected = { kind: "code", code };
    } else if (tokenHash && otpType && OTP_TYPES.has(otpType)) {
      detected = { kind: "otp", tokenHash, type: otpType };
    } else if (accessToken && refreshToken) {
      detected = { kind: "fragment", accessToken, refreshToken };
    }

    if (!detected) {
      setErrorMsg(
        "This page is reached after clicking a sign-in link. If you got here some other way, head back to sign in."
      );
      setPhase("error");
      return;
    }

    // Was this an OAuth round-trip initiated by a button click in this
    // tab? If so, auto-complete with no interstitial.
    let oauthInFlight = false;
    try {
      oauthInFlight = sessionStorage.getItem("lp-oauth-in-flight") === "1";
      if (oauthInFlight) sessionStorage.removeItem("lp-oauth-in-flight");
    } catch {
      // private mode etc. — fall through to click-to-confirm.
    }

    if (oauthInFlight && detected.kind === "code") {
      (async () => {
        setPhase("exchanging");
        const { error } = await complete(detected);
        if (cancelled) return;
        if (error) {
          console.error("[AuthCallback:oauth]", error.message, error);
          setErrorMsg(error.message);
          setPhase("error");
          return;
        }
        window.history.replaceState(null, "", "/");
        navigate("/");
      })();
    } else {
      // Magic-link / recovery / OAuth-without-flag — show click-to-confirm.
      setPending(detected);
    }

    return () => {
      cancelled = true;
    };
  }, [navigate]);

  const handleConfirm = async () => {
    if (!pending) return;
    setPhase("exchanging");
    try {
      const { error } = await complete(pending);
      if (error) throw error;
      const { data, error: sessErr } = await supabase.auth.getSession();
      if (sessErr) throw sessErr;
      if (!data.session) {
        throw new Error(
          "Sign-in completed but no session was created. " +
            "If this keeps happening, the link may have already been used or expired — request a fresh one."
        );
      }
      window.history.replaceState(null, "", "/");
      navigate("/");
    } catch (e) {
      const msg = e instanceof Error ? e.message : "Unknown error";
      console.error("[AuthCallback]", msg, e);
      setErrorMsg(msg);
      setPhase("error");
    }
  };

  if (phase === "error") {
    return (
      <div className="min-h-screen flex items-center justify-center px-4">
        <div className="max-w-md w-full glass rounded-2xl p-8 border border-border/50 text-center">
          <h1 className="font-display font-bold text-xl text-foreground mb-3">
            Sign-in failed
          </h1>
          <p className="text-muted-foreground text-sm mb-6">{errorMsg}</p>
          <Button onClick={() => navigate("/signin")}>Back to sign in</Button>
        </div>
      </div>
    );
  }

  if (phase === "exchanging") {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <div className="text-center">
          <div className="w-12 h-12 rounded-full border-2 border-primary border-t-transparent animate-spin mx-auto mb-4" />
          <p className="text-muted-foreground">Completing sign-in…</p>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen flex items-center justify-center px-4">
      <div className="max-w-md w-full glass rounded-2xl p-8 border border-border/50">
        <div className="flex items-center gap-2 mb-2">
          <div className="w-9 h-9 rounded-lg bg-primary/20 flex items-center justify-center glow-purple">
            <Music className="w-4 h-4 text-primary" />
          </div>
          <h1 className="font-display font-bold text-xl text-gradient">LyricPro Ai</h1>
        </div>
        <div className="flex items-center gap-2 mt-4 mb-3 text-foreground">
          <ShieldCheck className="w-5 h-5 text-primary" />
          <h2 className="font-display font-semibold text-lg">Confirm sign-in</h2>
        </div>
        <p className="text-muted-foreground text-sm mb-6">
          Click the button below to finish signing in. We use this extra step so corporate email scanners and link previewers can't accidentally consume your sign-in link before you arrive.
        </p>
        <Button
          onClick={handleConfirm}
          className="w-full bg-primary text-primary-foreground hover:bg-primary/90 glow-purple"
          disabled={!pending}
        >
          Continue to LyricPro
        </Button>
        <p className="text-xs text-muted-foreground text-center mt-4">
          Didn't request this sign-in? You can safely close this page.
        </p>
      </div>
    </div>
  );
}

// Dispatch to the right supabase method based on which URL shape we got.
// Returns the supabase-style { error } object (null on success).
async function complete(
  p: Exclude<Pending, null>
): Promise<{ error: { message: string } | null }> {
  if (p.kind === "code") {
    const { error } = await supabase.auth.exchangeCodeForSession(p.code);
    return { error };
  }
  if (p.kind === "otp") {
    // EmailOtpType in auth-js is the string union below. We've already
    // gated p.type through OTP_TYPES, so this cast is safe.
    const type = p.type as
      | "magiclink"
      | "signup"
      | "recovery"
      | "invite"
      | "email_change"
      | "email";
    const { error } = await supabase.auth.verifyOtp({
      token_hash: p.tokenHash,
      type,
    });
    return { error };
  }
  // fragment
  const { error } = await supabase.auth.setSession({
    access_token: p.accessToken,
    refresh_token: p.refreshToken,
  });
  return { error };
}
