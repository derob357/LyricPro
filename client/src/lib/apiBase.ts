import { IS_NATIVE } from "./platform";

// Base URL for API calls.
//   - Web: relative path so dev and prod work the same way.
//   - Native (Capacitor): the app is loaded from `capacitor://localhost`
//     (iOS) or `https://localhost` (Android), so relative paths would
//     try to hit those origins. Force-route to the Vercel production
//     deployment. Configurable via VITE_API_BASE_URL for staging /
//     preview-deployment builds.

const NATIVE_DEFAULT = "https://lyricpro-ai.vercel.app";

export const API_BASE_URL: string = IS_NATIVE
  ? import.meta.env.VITE_API_BASE_URL ?? NATIVE_DEFAULT
  : ""; // empty = relative path, same origin

export const API_TRPC_URL: string = `${API_BASE_URL}/api/trpc`;
