// Wires the Supabase access token into the Realtime websocket every time
// auth refreshes. Without this hook the WS keeps the original token and
// silently stops delivering once it expires (supabase discussion #37002).
//
// Mount this hook once at the React root — see client/src/App.tsx.
import { useEffect } from "react";
import { supabase } from "../supabase";

export function useRealtimeAuth(): void {
  useEffect(() => {
    // Sync the current session immediately on mount.
    supabase.auth.getSession().then(({ data }) => {
      if (data.session?.access_token) {
        supabase.realtime.setAuth(data.session.access_token);
      }
    });

    // Re-sync on every auth event (TOKEN_REFRESHED is the critical one;
    // SIGNED_IN and SIGNED_OUT bracket the session lifecycle).
    const { data: sub } = supabase.auth.onAuthStateChange((event, session) => {
      if (event === "TOKEN_REFRESHED" || event === "SIGNED_IN") {
        if (session?.access_token) {
          supabase.realtime.setAuth(session.access_token);
        }
      } else if (event === "SIGNED_OUT") {
        // Clear so the WS doesn't keep a stale token after logout.
        supabase.realtime.setAuth(null as unknown as string);
      }
    });

    return () => {
      sub.subscription.unsubscribe();
    };
  }, []);
}
