// Generates the Apple Sign-In "client secret" JWT that Supabase's Apple
// provider config requires in the "Secret Key (for OAuth)" field.
//
// Apple's OAuth flow requires you to authenticate to its token endpoint
// using a short-lived JWT signed with your downloaded `.p8` private key.
// Supabase used to generate this JWT under the hood from your `.p8`; the
// current Supabase Apple provider UI requires YOU to pre-generate it and
// paste the JWT. Max lifetime per Apple is 6 months — set a calendar
// reminder to re-run this script ~5 months out.
//
// Usage (no values touch the terminal scrollback if you store them in .env):
//
//   APPLE_TEAM_ID=XXXXXXXXXX \
//   APPLE_KEY_ID=XXXXXXXXXX \
//   APPLE_SERVICES_ID=ai.intentionai.lyricpro.web \
//   APPLE_P8_PATH=/path/to/AuthKey_XXXXXXXXXX.p8 \
//   node scripts/generate-apple-client-secret.mjs
//
// The JWT is printed to stdout. Pipe to pbcopy on macOS to put it on the
// clipboard without it appearing in scrollback:
//
//   ... node scripts/generate-apple-client-secret.mjs | pbcopy
//
// Then paste into Supabase Dashboard -> Authentication -> Sign In / Providers
// -> Apple -> Secret Key (for OAuth). Click Save. Verify by reloading.

import { readFileSync } from "node:fs";
import { SignJWT, importPKCS8 } from "jose";

const TEAM_ID = process.env.APPLE_TEAM_ID;
const KEY_ID = process.env.APPLE_KEY_ID;
const SERVICES_ID = process.env.APPLE_SERVICES_ID;
const P8_PATH = process.env.APPLE_P8_PATH;

const missing = [
  ["APPLE_TEAM_ID", TEAM_ID],
  ["APPLE_KEY_ID", KEY_ID],
  ["APPLE_SERVICES_ID", SERVICES_ID],
  ["APPLE_P8_PATH", P8_PATH],
]
  .filter(([, v]) => !v)
  .map(([k]) => k);

if (missing.length) {
  console.error(`Missing required env vars: ${missing.join(", ")}`);
  console.error("");
  console.error("Example:");
  console.error("  APPLE_TEAM_ID=XXXXXXXXXX \\");
  console.error("  APPLE_KEY_ID=XXXXXXXXXX \\");
  console.error("  APPLE_SERVICES_ID=ai.intentionai.lyricpro.web \\");
  console.error("  APPLE_P8_PATH=/path/to/AuthKey_XXXXXXXXXX.p8 \\");
  console.error("  node scripts/generate-apple-client-secret.mjs");
  process.exit(1);
}

const p8Contents = readFileSync(P8_PATH, "utf8");

if (!p8Contents.includes("BEGIN PRIVATE KEY")) {
  console.error(`File at ${P8_PATH} does not look like a .p8 — missing BEGIN PRIVATE KEY marker.`);
  process.exit(1);
}

const privateKey = await importPKCS8(p8Contents, "ES256");

const now = Math.floor(Date.now() / 1000);
const SIX_MONTHS_SECONDS = 60 * 60 * 24 * 180; // Apple's hard max

const jwt = await new SignJWT({})
  .setProtectedHeader({ alg: "ES256", kid: KEY_ID })
  .setIssuer(TEAM_ID)
  .setIssuedAt(now)
  .setExpirationTime(now + SIX_MONTHS_SECONDS)
  .setAudience("https://appleid.apple.com")
  .setSubject(SERVICES_ID)
  .sign(privateKey);

// JWT printed to stdout. Pipe to pbcopy on macOS to skip scrollback.
process.stdout.write(jwt);
process.stdout.write("\n");
