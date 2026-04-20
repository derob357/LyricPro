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
    // "implicit" (not PKCE) is deliberate for a non-SSR SPA: PKCE stores
    // a code verifier in localStorage that has to survive the email
    // round-trip. If the user opens the magic link in a different
    // browser or the email app's in-app browser, the verifier isn't
    // there and the exchange fails with "code verifier not found".
    // Implicit flow puts the session tokens directly in the URL fragment
    // so the callback works regardless of which browser opens the link.
    flowType: "implicit",
  },
});

// Small convenience used by the tRPC client to inject the current access
// token into every outgoing request's Authorization header.
export async function getCurrentAccessToken(): Promise<string | null> {
  const { data } = await supabase.auth.getSession();
  return data.session?.access_token ?? null;
}
