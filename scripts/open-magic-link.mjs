// Generate a Supabase magic link via the admin API (bypasses the email
// rate limit) and deliver it one of three ways:
//
//   --open   (default) open in the local default browser. Use ONLY to sign
//            yourself in — it will sign the local browser in as <email>.
//
//   --print  print the URL to stdout. Copy it to iMessage / Slack / SMS
//            and send it to the intended user manually. Useful when the
//            Supabase email rate limit is blocking the normal flow.
//
//   --email  use Supabase's normal mailer (public client + signInWithOtp).
//            Subject to the per-email / per-hour rate limit.
//
// URL is passed to `open` via execFile args so it never appears in stdout
// unless --print is set.
//
// Usage:
//   node scripts/open-magic-link.mjs <email> [--open|--print|--email] [redirectTo]

import "dotenv/config";
import { createClient } from "@supabase/supabase-js";
import { execFile } from "node:child_process";
import { promisify } from "node:util";

const execFileP = promisify(execFile);

const args = process.argv.slice(2);
const email = args.find(a => !a.startsWith("--") && a.includes("@"));
if (!email) {
  console.error(
    "Usage: node scripts/open-magic-link.mjs <email> [--open|--print|--email] [redirectTo]"
  );
  process.exit(1);
}

const mode = args.find(a => ["--open", "--print", "--email"].includes(a)) ?? "--open";
const redirectTo =
  args.find(a => a.startsWith("http")) ??
  "https://lyricpro-ai.vercel.app/auth/callback";

const url = process.env.VITE_SUPABASE_PROJECT_URL;
const secret = process.env.SUPABASE_SECRET_KEY;
const pub = process.env.VITE_SUPABASE_PUBLISHABLE_KEY;
if (!url || !secret) {
  console.error("Missing VITE_SUPABASE_PROJECT_URL or SUPABASE_SECRET_KEY");
  process.exit(1);
}

// ── --email: delegate to Supabase mailer (subject to rate limit) ────────────
if (mode === "--email") {
  const client = createClient(url, pub, { auth: { persistSession: false } });
  const { error } = await client.auth.signInWithOtp({
    email,
    options: { emailRedirectTo: redirectTo, shouldCreateUser: false },
  });
  if (error) {
    console.error(`Email send failed: ${error.message}`);
    process.exit(1);
  }
  console.log(`Magic-link email sent to ${email} (via Supabase mailer)`);
  process.exit(0);
}

// ── --open or --print: admin API issues a fresh link synchronously ──────────
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

if (mode === "--print") {
  // Deliberately print to stdout so the operator can copy-paste into a
  // message. Only use this for sign-in links destined for another person.
  console.log(actionLink);
  console.error(
    `\nLink printed above. Send it to ${email} via iMessage / Slack / SMS. ` +
      `It's one-time-use and expires in ~1 hour.`
  );
} else {
  // --open: opens in YOUR local browser. Only use to sign yourself in.
  const opener = process.platform === "darwin" ? "open" : "xdg-open";
  await execFileP(opener, [actionLink]);
  console.log(
    `Opened magic-link sign-in for ${email} in your local browser.`
  );
  console.log(
    `WARNING: this signs YOUR browser in as ${email}. ` +
      `If that isn't you, sign out immediately — or re-run with --print to forward the link instead.`
  );
}
