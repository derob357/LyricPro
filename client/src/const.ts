export { COOKIE_NAME, ONE_YEAR_MS } from "@shared/const";

// Generate login URL at runtime so redirect URI reflects the current origin.
// IMPORTANT: state must only contain the redirectUri (base64-encoded).
// The server's sdk.ts decodes state as the redirectUri for token exchange.
// Do NOT embed returnPath in state — it breaks OAuth token exchange.
// The Manus OAuth portal only supports type=signIn; sign-up and password reset
// are handled within the same portal UI — all auth flows use the same URL.
const buildAuthUrl = () => {
  const oauthPortalUrl = import.meta.env.VITE_OAUTH_PORTAL_URL;
  const appId = import.meta.env.VITE_APP_ID;
  // When OAuth isn't configured (e.g. local dev without portal access),
  // return a harmless no-op URL so components mounting useAuth don't crash.
  if (!oauthPortalUrl || !appId) return "/";

  const redirectUri = `${window.location.origin}/api/oauth/callback`;
  const state = btoa(redirectUri);

  const url = new URL(`${oauthPortalUrl}/app-auth`);
  url.searchParams.set("appId", appId);
  url.searchParams.set("redirectUri", redirectUri);
  url.searchParams.set("state", state);
  url.searchParams.set("type", "signIn");

  return url.toString();
};

export const getLoginUrl = (_returnPath?: string) => buildAuthUrl();
export const getSignUpUrl = (_returnPath?: string) => buildAuthUrl();
export const getPasswordResetUrl = () => buildAuthUrl();
