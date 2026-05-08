import { createClient } from "@supabase/supabase-js";

// Browser-side Supabase client. Uses the publishable key (safe to ship).
// The client persists the session in localStorage by default, auto-refreshes
// the access token, and broadcasts onAuthStateChange events that useAuth
// subscribes to.

const url = import.meta.env.VITE_SUPABASE_PROJECT_URL;
const key = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY;

if (!url || !key) {
  console.error(
    "[Supabase] VITE_SUPABASE_PROJECT_URL and VITE_SUPABASE_PUBLISHABLE_KEY must be set"
  );
}

export const supabase = createClient(url ?? "", key ?? "", {
  auth: {
    persistSession: true,
    autoRefreshToken: true,
    detectSessionInUrl: true, // handles the magic-link / OAuth redirect
    // PKCE binds the code-exchange to the originating browser via a
    // code_verifier stored in localStorage. Mitigates code-interception
    // attacks on the OAuth redirect. RFC 9700 deprecates implicit flow.
    // supabase-js handles the exchange automatically via
    // detectSessionInUrl: true; AuthCallback.tsx also calls
    // exchangeCodeForSession() explicitly for the click-to-confirm UX
    // that defends against corporate email scanner link prefetching.
    // Note: magic links opened in a *different* browser lose the verifier,
    // but Supabase OTP magic-links are single-use server-side codes — the
    // verifier concern applies to OAuth provider flows, not OTP. Surfaced
    // by Wave 0 baseline scan finding CA-13.
    flowType: "pkce",
  },
});

// Small convenience used by the tRPC client to inject the current access
// token into every outgoing request's Authorization header.
export async function getCurrentAccessToken(): Promise<string | null> {
  const { data } = await supabase.auth.getSession();
  return data.session?.access_token ?? null;
}
