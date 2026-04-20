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
    flowType: "pkce",
  },
});

// Small convenience used by the tRPC client to inject the current access
// token into every outgoing request's Authorization header.
export async function getCurrentAccessToken(): Promise<string | null> {
  const { data } = await supabase.auth.getSession();
  return data.session?.access_token ?? null;
}
