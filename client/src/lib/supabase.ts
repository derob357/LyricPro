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
    // PKCE binds the code-exchange to the originating browser via a
    // code_verifier stored in localStorage. Mitigates code-interception
    // attacks on the OAuth redirect. RFC 9700 deprecates implicit flow.
    flowType: "pkce",
    // detectSessionInUrl is OFF on purpose. With it on, supabase-js
    // auto-exchanges the ?code= query param during _initialize() and
    // deletes the code_verifier from storage. That races AuthCallback.tsx
    // (which also calls exchangeCodeForSession for the magic-link
    // click-to-confirm UX), producing AuthPKCECodeVerifierMissingError
    // on the second exchange attempt. Each callback page exchanges
    // explicitly: AuthCallback.tsx (OAuth + magic-link) and
    // PasswordReset.tsx (recovery). Under PKCE this is also strictly
    // safer — only the originating browser holds the verifier, so a
    // scanner prefetch of /auth/callback?code= cannot burn the token.
    detectSessionInUrl: false,
  },
});

// Small convenience used by the tRPC client to inject the current access
// token into every outgoing request's Authorization header.
export async function getCurrentAccessToken(): Promise<string | null> {
  const { data } = await supabase.auth.getSession();
  return data.session?.access_token ?? null;
}
