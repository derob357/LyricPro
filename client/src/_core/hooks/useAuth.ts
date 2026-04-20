import { useCallback, useEffect, useMemo, useState } from "react";
import { supabase } from "@/lib/supabase";
import { trpc } from "@/lib/trpc";
import type { Session } from "@supabase/supabase-js";

// useAuth is the single point of truth for client-side auth state.
//   - Subscribes to Supabase's onAuthStateChange for the JWT/session.
//   - Fetches the matching public.users row (app-level user with role,
//     stats, etc.) from tRPC's auth.me — but only after a session exists,
//     so we don't hammer the API as an anonymous visitor.
//   - Exposes `logout()` that clears both Supabase session and cached
//     React Query data.

type UseAuthOptions = {
  redirectOnUnauthenticated?: boolean;
};

export function useAuth(options?: UseAuthOptions) {
  const { redirectOnUnauthenticated = false } = options ?? {};
  const utils = trpc.useUtils();

  const [session, setSession] = useState<Session | null>(null);
  const [sessionReady, setSessionReady] = useState(false);

  // Bootstrap the session on mount + subscribe to changes.
  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => {
      setSession(data.session);
      setSessionReady(true);
    });
    const { data: sub } = supabase.auth.onAuthStateChange((_event, s) => {
      setSession(s);
      // Invalidate cached auth.me so it refetches with the new JWT (or
      // clears to null on sign-out).
      utils.auth.me.invalidate();
    });
    return () => sub.subscription.unsubscribe();
  }, [utils]);

  // Fetch the app-level user row once we've checked for a Supabase session.
  // Not gated on session being non-null: in dev the server's DEV_AUTH_BYPASS
  // can return a user without a Supabase session, and in prod this just
  // hits the public auth.me procedure and gets null for anonymous visitors.
  const meQuery = trpc.auth.me.useQuery(undefined, {
    retry: false,
    refetchOnWindowFocus: false,
    enabled: sessionReady,
  });

  const logout = useCallback(async () => {
    await supabase.auth.signOut();
    utils.auth.me.setData(undefined, null);
    await utils.auth.me.invalidate();
  }, [utils]);

  useEffect(() => {
    if (!redirectOnUnauthenticated) return;
    if (!sessionReady) return;
    if (session) return;
    if (typeof window === "undefined") return;
    if (window.location.pathname === "/signin") return;
    window.location.href = "/signin";
  }, [redirectOnUnauthenticated, session, sessionReady]);

  const state = useMemo(
    () => ({
      user: meQuery.data ?? null,
      loading: !sessionReady || meQuery.isLoading,
      error: meQuery.error ?? null,
      // The server (via tRPC auth.me) is the source of truth for
      // "is there an authenticated identity?" — in prod it only resolves
      // when a valid Supabase JWT is present; in dev DEV_AUTH_BYPASS can
      // also resolve it. Either way, if the server returns a user, the
      // app should treat them as signed in.
      isAuthenticated: Boolean(meQuery.data),
      session,
    }),
    [meQuery.data, meQuery.error, meQuery.isLoading, session, sessionReady]
  );

  return {
    ...state,
    refresh: () => meQuery.refetch(),
    logout,
  };
}
