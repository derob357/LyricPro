// Capacitor deep-link handler. On native, incoming URLs with
// `lyricpro://auth/callback` (from a magic link or OAuth redirect)
// fire the `appUrlOpen` event. We parse the tokens and seed the
// Supabase client's session so the app moves past /signin seamlessly.
//
// Called once from main.tsx on native. On web this is a no-op.

import { App, type URLOpenListenerEvent } from "@capacitor/app";
import { supabase } from "./supabase";
import { IS_NATIVE } from "./platform";

// Custom URL scheme. Must match the one registered in Info.plist
// (iOS) and AndroidManifest.xml (Android). Kept here so any change
// is reviewed alongside the native-platform config.
export const AUTH_CALLBACK_URL = "lyricpro://auth/callback";

// Parse tokens out of either a URL fragment (#access_token=...) or
// query string (?code=... or ?error=...).
function extractTokens(rawUrl: string): {
  accessToken?: string;
  refreshToken?: string;
  code?: string;
  error?: string;
} {
  try {
    const url = new URL(rawUrl);
    const hash = url.hash.startsWith("#")
      ? new URLSearchParams(url.hash.slice(1))
      : null;
    const query = url.searchParams;

    return {
      accessToken: hash?.get("access_token") ?? undefined,
      refreshToken: hash?.get("refresh_token") ?? undefined,
      code: query.get("code") ?? undefined,
      error:
        hash?.get("error") ??
        query.get("error") ??
        query.get("error_description") ??
        undefined,
    };
  } catch {
    return {};
  }
}

export function registerDeepLinkHandlers() {
  if (!IS_NATIVE) return; // web already handles /auth/callback via router

  App.addListener("appUrlOpen", async (event: URLOpenListenerEvent) => {
    const url = event.url;
    if (!url.startsWith("lyricpro://")) return;

    const { accessToken, refreshToken, code, error } = extractTokens(url);

    if (error) {
      console.error("[DeepLink] Auth error:", error);
      return;
    }

    try {
      if (accessToken && refreshToken) {
        // Implicit flow: tokens arrive in the fragment, set directly.
        await supabase.auth.setSession({
          access_token: accessToken,
          refresh_token: refreshToken,
        });
      } else if (code) {
        // PKCE flow (not currently used — we're on implicit — but keep
        // this branch so switching modes doesn't require touching the
        // native deep-link handler).
        await supabase.auth.exchangeCodeForSession(code);
      }
    } catch (e) {
      console.error(
        "[DeepLink] Failed to establish session:",
        e instanceof Error ? e.message : "unknown"
      );
    }
  });
}
