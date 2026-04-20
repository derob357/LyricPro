// Server-side Supabase Auth helper. Validates an incoming request's
// Supabase access token (JWT) and returns the matching public.users row.
//
// Inputs accepted:
//   - Authorization: Bearer <jwt>  (preferred — works from any client)
//   - Cookie: sb-<project>-auth-token  (set by @supabase/ssr, if used)
//
// Why call supabase.auth.getUser(jwt) instead of verifying JWT locally?
//   - No need to ship SUPABASE_JWT_SECRET to every env
//   - Uses the same code path Supabase's REST API uses — consistent truth
//   - Adds ~30ms per request; acceptable for our traffic, Vercel warm
//     instances cache the Supabase client across invocations
// If that round-trip becomes a bottleneck later, swap to jose-based local
// verification using the project JWT secret.

import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import type { User } from "../../drizzle/schema";
import { getUserByOpenId, upsertUser } from "../db";

type MinimalRequest = {
  headers: {
    authorization?: string | string[];
    cookie?: string | string[];
    [key: string]: string | string[] | undefined;
  };
};

let _client: SupabaseClient | null = null;
function getAdminClient(): SupabaseClient | null {
  if (_client) return _client;
  const url = process.env.VITE_SUPABASE_PROJECT_URL;
  const key = process.env.SUPABASE_SECRET_KEY;
  if (!url || !key) {
    console.warn("[Auth] Supabase env not configured — auth disabled");
    return null;
  }
  _client = createClient(url, key, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
  return _client;
}

function headerValue(
  h: MinimalRequest["headers"],
  name: string
): string | undefined {
  const v = h[name] ?? h[name.toLowerCase()];
  if (Array.isArray(v)) return v[0];
  return v;
}

// Extract an access token from either Authorization header or the
// Supabase SSR-style cookie (`sb-<ref>-auth-token`).
function extractToken(req: MinimalRequest): string | null {
  const auth = headerValue(req.headers, "authorization");
  if (auth?.toLowerCase().startsWith("bearer ")) return auth.slice(7).trim();

  const cookieHeader = headerValue(req.headers, "cookie");
  if (!cookieHeader) return null;
  // Supabase SSR cookie is JSON: [access_token, refresh_token, ...]
  const match = cookieHeader.match(/sb-[^=]+-auth-token=([^;]+)/);
  if (!match) return null;
  try {
    const decoded = decodeURIComponent(match[1]);
    if (decoded.startsWith("[")) {
      const arr = JSON.parse(decoded);
      return Array.isArray(arr) && typeof arr[0] === "string" ? arr[0] : null;
    }
    return decoded;
  } catch {
    return null;
  }
}

// Public API: given a request, return the matching public.users row or null.
// Also handles first-sign-in: if the auth user is valid but no public.users
// row exists yet, create one using the JWT's metadata (keeps us idempotent
// with the bootstrap script and resilient to users signing up organically).
export async function authenticateRequest(
  req: MinimalRequest
): Promise<User | null> {
  const token = extractToken(req);
  if (!token) return null;

  const client = getAdminClient();
  if (!client) return null;

  const { data, error } = await client.auth.getUser(token);
  if (error || !data?.user) return null;

  const authUser = data.user;
  // openId in public.users stores the Supabase auth UUID for all
  // Supabase-authenticated users.
  let appUser = await getUserByOpenId(authUser.id);
  if (!appUser) {
    const meta = (authUser.user_metadata ?? {}) as {
      firstName?: string;
      lastName?: string;
      role?: "user" | "admin";
    };
    const name =
      authUser.user_metadata?.full_name ??
      [meta.firstName, meta.lastName].filter(Boolean).join(" ") ??
      authUser.email ??
      null;
    await upsertUser({
      openId: authUser.id,
      email: authUser.email ?? null,
      name,
      firstName: meta.firstName ?? null,
      lastName: meta.lastName ?? null,
      loginMethod: authUser.app_metadata?.provider ?? "supabase",
      role: meta.role === "admin" ? "admin" : "user",
    });
    appUser = await getUserByOpenId(authUser.id);
  }
  return appUser ?? null;
}
