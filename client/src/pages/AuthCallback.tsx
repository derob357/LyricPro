import { useEffect, useState } from "react";
import { useLocation } from "wouter";
import { supabase } from "@/lib/supabase";
import { Button } from "@/components/ui/button";
import { Music, ShieldCheck } from "lucide-react";

// Sign-in callback. Handles two return-trip shapes:
//
// 1) OAuth (Google / Apple): user just clicked a button on /signin moments
//    ago, sessionStorage carries `lp-oauth-in-flight=1`. Exchange the code
//    immediately and redirect home — no interstitial, no scanner concern
//    (this URL was never sent through email).
//
// 2) Magic link (?code= or #access_token=...): the link is in an email
//    that may pass through corporate URL scanners (Outlook Safe Links,
//    Microsoft Defender, Mimecast, Proofpoint, Barracuda) which pre-fetch
//    links before the human clicks. Defense: GET only PARSES the URL.
//    The actual exchange runs only inside a real user-gesture button
//    click. Headless scanners that GET the page don't click "Continue",
//    so the token survives until the human arrives. Same change also
//    addresses the in-app webview class of bug — the user can see the
//    "Continue" page and choose to open it in their real browser before
//    the token is consumed.
//
// Note on PKCE: the supabase client is configured with
// detectSessionInUrl: false in lib/supabase.ts; we are the sole exchanger
// of the code on this page.

export default function AuthCallback() {
  const [, navigate] = useLocation();
  const [authCode, setAuthCode] = useState<string | null>(null);
  const [hasFragment, setHasFragment] = useState(false);
  const [phase, setPhase] = useState<"ready" | "exchanging" | "error">("ready");
  const [errorMsg, setErrorMsg] = useState<string>("");

  // ── Mount: parse the URL; for OAuth, exchange immediately. ──────────────
  useEffect(() => {
    let cancelled = false;
    const url = new URL(window.location.href);

    // Supabase sends error info as query params on failure. Surface
    // immediately — there's nothing to confirm.
    const err = url.searchParams.get("error");
    const errDesc = url.searchParams.get("error_description");
    if (err) {
      setErrorMsg(errDesc ?? err);
      setPhase("error");
      return;
    }

    const code = url.searchParams.get("code");
    const hasHash = !!(window.location.hash && window.location.hash.length > 1);

    // Was this return-trip initiated by an OAuth button click in this
    // tab? If so, skip the click-to-confirm interstitial — the URL was
    // never emailed, so scanner-prefetch isn't a concern.
    let oauthInFlight = false;
    try {
      oauthInFlight = sessionStorage.getItem("lp-oauth-in-flight") === "1";
      if (oauthInFlight) sessionStorage.removeItem("lp-oauth-in-flight");
    } catch {
      // Private mode etc. — fall through to click-to-confirm path.
    }

    if (oauthInFlight && code) {
      (async () => {
        setPhase("exchanging");
        try {
          const { error } = await supabase.auth.exchangeCodeForSession(code);
          if (error) throw error;
          if (cancelled) return;
          window.history.replaceState(null, "", "/");
          navigate("/");
        } catch (e) {
          if (cancelled) return;
          const msg = e instanceof Error ? e.message : "Unknown error";
          console.error("[AuthCallback:oauth]", msg, e);
          setErrorMsg(msg);
          setPhase("error");
        }
      })();
      return () => {
        cancelled = true;
      };
    }

    // PKCE path (magic link) — capture the code but DO NOT exchange yet.
    if (code) {
      setAuthCode(code);
      return;
    }

    // Implicit-flow path — Supabase puts the token in the URL fragment.
    // Fragments don't get sent to corporate scanners (they're client-side
    // only), so the prefetch problem doesn't apply here. We still gate
    // session creation behind the click for consistency.
    if (hasHash) {
      setHasFragment(true);
      return;
    }

    // No code, no fragment, no error — user landed here directly.
    setErrorMsg("This page is reached after clicking a sign-in link. If you got here some other way, head back to sign in.");
    setPhase("error");
  }, [navigate]);

  // ── Click handler: NOW exchange the code for a session. ─────────────────
  const handleConfirm = async () => {
    setPhase("exchanging");
    try {
      if (authCode) {
        const { error } = await supabase.auth.exchangeCodeForSession(authCode);
        if (error) throw error;
      }
      // Implicit-fragment path is effectively dead under PKCE (flowType:
      // "pkce" in lib/supabase.ts means Supabase doesn't issue implicit
      // tokens). If we got here via a legacy emailed fragment URL,
      // getSession() will return null and the "no session created" branch
      // below handles it gracefully — user is bounced back to /signin.

      const { data, error: sessErr } = await supabase.auth.getSession();
      if (sessErr) throw sessErr;
      if (!data.session) {
        throw new Error(
          "Sign-in completed but no session was created. " +
            "If this keeps happening, the link may have already been used or expired — request a fresh one."
        );
      }

      // Strip the ?code / #access_token from the URL bar before navigating.
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

  // phase === "ready" — show the click-to-confirm screen.
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
          disabled={!authCode && !hasFragment}
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
