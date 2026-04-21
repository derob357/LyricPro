// Generate a Supabase magic link via the admin API (bypasses the email
// rate limit) and open it in the default browser. The URL is a one-time,
// short-lived credential — it's passed to `open` via execFile args so it
// never appears in stdout, logs, or shell history.
//
// Usage: node scripts/open-magic-link.mjs <email> [redirectTo]

import "dotenv/config";
import { createClient } from "@supabase/supabase-js";
import { execFile } from "node:child_process";
import { promisify } from "node:util";

const execFileP = promisify(execFile);

const email = process.argv[2];
if (!email) {
  console.error("Usage: node scripts/open-magic-link.mjs <email> [redirectTo]");
  process.exit(1);
}
const redirectTo =
  process.argv[3] ?? "https://lyricpro-ai.vercel.app/auth/callback";

const url = process.env.VITE_SUPABASE_PROJECT_URL;
const secret = process.env.SUPABASE_SECRET_KEY;
if (!url || !secret) {
  console.error("Missing VITE_SUPABASE_PROJECT_URL or SUPABASE_SECRET_KEY");
  process.exit(1);
}

const admin = createClient(url, secret, { auth: { persistSession: false } });
const { data, error } = await admin.auth.admin.generateLink({
  type: "magiclink",
  email,
  options: { redirectTo },
});
if (error) {
  console.error("generateLink failed:", error.message);
  process.exit(1);
}

const actionLink = data.properties?.action_link;
if (!actionLink) {
  console.error("No action_link in response");
  process.exit(1);
}

// Open the link in the default browser. URL passed as an arg — not
// printed. macOS `open` handles it; on Linux we fall back to xdg-open.
const opener = process.platform === "darwin" ? "open" : "xdg-open";
try {
  await execFileP(opener, [actionLink]);
  console.log(`Opened magic-link sign-in for ${email} in your browser`);
} catch (e) {
  console.error("Failed to open browser:", e.message);
  process.exit(1);
}
