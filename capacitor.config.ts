import type { CapacitorConfig } from "@capacitor/cli";

// Capacitor wraps the built Vite client (dist/public) in a native shell.
// The bundled-assets approach (server.url omitted) means the app loads
// its UI from the bundled JS/HTML on first launch and talks to the
// Vercel-hosted API via absolute URLs — set in client/src/lib/apiBase.ts.
//
// Bundle ID note: `ai.intentionai.lyricpro` is a placeholder; change
// before first App Store / Play submission if the client wants their
// company name in the reverse-DNS prefix.

const config: CapacitorConfig = {
  appId: "ai.intentionai.lyricpro",
  appName: "LyricPro Ai",
  webDir: "dist/public",
  backgroundColor: "#0a0015",

  ios: {
    // Native iOS scroll bounce off at the scroll edge. The game UI looks
    // better without the rubber-band effect at the top/bottom.
    scrollEnabled: true,
    contentInset: "automatic",
    backgroundColor: "#0a0015",
  },

  android: {
    backgroundColor: "#0a0015",
    // Use HTTPS scheme so cookies + localStorage behave the same as web.
    // This is the Capacitor default on Android 10+ anyway; explicit here.
    allowMixedContent: false,
  },

  plugins: {
    SplashScreen: {
      launchShowDuration: 1200,
      backgroundColor: "#0a0015",
      showSpinner: false,
      splashFullScreen: true,
      splashImmersive: true,
      androidScaleType: "CENTER_CROP",
    },
    StatusBar: {
      // Dark-purple canvas; white icons. Matches the brand.
      backgroundColor: "#0a0015",
      style: "DARK",
      overlaysWebView: false,
    },
    Keyboard: {
      resize: "body",
      resizeOnFullScreen: true,
    },
  },
};

export default config;
