import { useEffect, useState } from "react";
import { useLocation } from "wouter";
import { supabase } from "@/lib/supabase";
import { Button } from "@/components/ui/button";

// Handles the redirect after a magic-link click or OAuth round-trip.
// With flowType: "pkce" the URL looks like /auth/callback?code=<opaque>
// and we must explicitly exchange the code for a session. With the
// legacy implicit flow the URL looks like /auth/callback#access_token=...
// and detectSessionInUrl handles it, but we still verify by reading
// the session afterwards.

export default function AuthCallback() {
  const [, navigate] = useLocation();
  const [status, setStatus] = useState<"loading" | "error">("loading");
  const [errorMsg, setErrorMsg] = useState<string>("");

  useEffect(() => {
    let cancelled = false;

    (async () => {
      try {
        const url = new URL(window.location.href);

        // Supabase sends error info as query params on failure.
        const err = url.searchParams.get("error");
        const errDesc = url.searchParams.get("error_description");
        if (err) {
          throw new Error(errDesc ?? err);
        }

        // PKCE path — exchange the code for a session.
        const code = url.searchParams.get("code");
        if (code) {
          const { error } = await supabase.auth.exchangeCodeForSession(code);
          if (error) throw error;
        }
        // (Implicit flow path: the Supabase client auto-consumes the
        // fragment tokens via detectSessionInUrl — nothing to do here.)

        // Confirm a session actually landed.
        const { data, error: sessErr } = await supabase.auth.getSession();
        if (sessErr) throw sessErr;
        if (!data.session) {
          throw new Error(
            "Sign-in completed but no session was created. " +
              "Check that this app's URL is in Supabase → Authentication → " +
              "URL Configuration → Redirect URLs."
          );
        }

        if (cancelled) return;
        // Clean the ?code / #access_token out of the URL bar before we go.
        window.history.replaceState(null, "", "/");
        navigate("/");
      } catch (e) {
        if (cancelled) return;
        const msg = e instanceof Error ? e.message : "Unknown error";
        console.error("[AuthCallback]", msg, e);
        setErrorMsg(msg);
        setStatus("error");
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [navigate]);

  if (status === "error") {
    return (
      <div className="min-h-screen flex items-center justify-center px-4">
        <div className="max-w-md glass rounded-2xl p-8 border border-border/50 text-center">
          <h1 className="font-display font-bold text-xl text-foreground mb-3">
            Sign-in failed
          </h1>
          <p className="text-muted-foreground text-sm mb-6">{errorMsg}</p>
          <Button onClick={() => navigate("/signin")}>
            Back to sign-in
          </Button>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen flex items-center justify-center">
      <div className="text-center">
        <div className="w-12 h-12 rounded-full border-2 border-primary border-t-transparent animate-spin mx-auto mb-4" />
        <p className="text-muted-foreground">Completing sign-in…</p>
      </div>
    </div>
  );
}
