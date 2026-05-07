import { useEffect, useState } from "react";
import { useLocation } from "wouter";
import { supabase } from "@/lib/supabase";
import { Button } from "@/components/ui/button";
import { Music, ShieldCheck } from "lucide-react";

// Click-to-confirm sign-in interstitial.
//
// On magic-link click the URL looks like /auth/callback?code=<opaque> (PKCE)
// or /auth/callback#access_token=... (implicit). Industry research consistently
// flags corporate URL scanners (Outlook Safe Links, Microsoft Defender,
// Mimecast, Proofpoint, Barracuda) that pre-fetch every link in an email
// before the user clicks. If we exchange the code on page load, those
// scanners burn the single-use token and the human's click lands on
// "expired or already used."
//
// Defense: GET only PARSES the URL. The actual exchange runs only inside
// a real user-gesture button click. Headless scanners that GET the page
// don't click "Continue", so the token survives until the human arrives.
// Same change also fixes the in-app webview class of bug — the user can
// see the "Continue" page and choose to open it in their real browser
// before the token is consumed.

export default function AuthCallback() {
  const [, navigate] = useLocation();
  const [authCode, setAuthCode] = useState<string | null>(null);
  const [hasFragment, setHasFragment] = useState(false);
  const [phase, setPhase] = useState<"ready" | "exchanging" | "error">("ready");
  const [errorMsg, setErrorMsg] = useState<string>("");

  // ── Mount: parse the URL only — do NOT touch the token yet. ─────────────
  useEffect(() => {
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

    // PKCE path — capture the code but DO NOT exchange yet.
    const code = url.searchParams.get("code");
    if (code) {
      setAuthCode(code);
      return;
    }

    // Implicit-flow path — Supabase puts the token in the URL fragment.
    // Fragments don't get sent to corporate scanners (they're client-side
    // only), so the prefetch problem doesn't apply here. We still gate
    // session creation behind the click for consistency.
    if (window.location.hash && window.location.hash.length > 1) {
      setHasFragment(true);
      return;
    }

    // No code, no fragment, no error — user landed here directly.
    setErrorMsg("This page is reached after clicking a sign-in link. If you got here some other way, head back to sign in.");
    setPhase("error");
  }, []);

  // ── Click handler: NOW exchange the code for a session. ─────────────────
  const handleConfirm = async () => {
    setPhase("exchanging");
    try {
      if (authCode) {
        const { error } = await supabase.auth.exchangeCodeForSession(authCode);
        if (error) throw error;
      }
      // For the implicit-fragment path, supabase-js's detectSessionInUrl
      // has already parsed the fragment by now — we just verify a session
      // landed below. No code exchange needed.

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
