import { useEffect, useState } from "react";
import { useLocation } from "wouter";
import { supabase } from "@/lib/supabase";

// Handles the redirect after a magic-link click or OAuth round-trip.
// The Supabase client (detectSessionInUrl: true) picks up the tokens
// from the URL fragment automatically; we just wait for the session to
// settle and bounce to the app.

export default function AuthCallback() {
  const [, navigate] = useLocation();
  const [message, setMessage] = useState("Completing sign-in…");

  useEffect(() => {
    let cancelled = false;
    (async () => {
      // Give Supabase a beat to process the URL fragment.
      const { data, error } = await supabase.auth.getSession();
      if (cancelled) return;
      if (error) {
        setMessage(`Sign-in failed: ${error.message}`);
        return;
      }
      if (data.session) {
        // Clear the URL hash so tokens don't linger in history.
        if (window.location.hash) {
          window.history.replaceState(null, "", window.location.pathname);
        }
        navigate("/");
      } else {
        setMessage("No session found. Redirecting to sign-in…");
        setTimeout(() => navigate("/signin"), 1500);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [navigate]);

  return (
    <div className="min-h-screen flex items-center justify-center">
      <div className="text-center">
        <div className="w-12 h-12 rounded-full border-2 border-primary border-t-transparent animate-spin mx-auto mb-4" />
        <p className="text-muted-foreground">{message}</p>
      </div>
    </div>
  );
}
