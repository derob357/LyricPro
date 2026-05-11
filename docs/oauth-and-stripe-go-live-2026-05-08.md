# OAuth (Google + Apple) + Stripe Live — Go-Live Runbook

**Date:** 2026-05-08
**Estimated time:** ~70–90 minutes total (Google ~15 min, Apple ~25–30 min, Stripe ~30–40 min)
**Branch:** feat/2026-05-08-oauth-stripe-go-live (Wave 1 code-side changes already committed)

---

## Secrets handling — please read first

I (Claude) will only ever ask you to add **variable names** to `.env` (local) and the Vercel UI (production). Values stay between you and the provider dashboard. **Never paste into chat:**
- Stripe live secret keys, webhook signing secrets
- Apple `.p8` key contents, Team ID, Key ID
- Google Client Secret
- Supabase service-role keys, OAuth client secrets
- Database URLs, JWT secrets, OTP codes

When you say "saved," I read from `.env` on disk to use the values. I never echo values back in chat output.

If at any point I appear to ask for a secret value in chat — **STOP.** Re-read this section, then continue with the variable-name-only pattern.

---

## Wave 2 — Sequencing

You can do the three sections in any order. Each ends with a green-light test that proves end-to-end functionality. After all three pass, tell me "all three providers green" and I'll dispatch Wave 3 (three verification subagents in parallel — one per provider).

If something goes sideways, tell me which step + which error message; I can debug without needing values.

---

## Section A — Google OAuth (~15 min)

### A.0. Prerequisite — Privacy Policy and Terms of Service URLs

Before Google will accept your OAuth consent screen, you need **public URLs** for your Privacy Policy and Terms of Service. The repo already has these at `client/public/privacy.html` and `client/public/terms.html`, and as of commit `3eb6098` Vercel rewrites expose them at the cleaner URLs Google expects:

- **Privacy Policy URL:** `https://playlyricpro.com/privacy`
- **Terms of Service URL:** `https://playlyricpro.com/termsofservice`

**These URLs only resolve after the branch with the rewrites is deployed to production.** Two ways to handle that:

- **(a) Deploy first:** push `feat/2026-05-08-oauth-stripe-go-live` to remote and let Vercel preview/prod deploy it. Verify the URLs resolve in a browser, then fill out the consent screen.
- **(b) Trust the URLs and deploy before launch:** Google accepts the URLs at form-submit time even if they currently 404. You just need them resolving before real users click "Sign in with Google." If you choose this path, **don't forget to merge + deploy this branch** before turning OAuth on for non-test users.

> **Note on existing content:** both `privacy.html` and `terms.html` open with a "DRAFT / TEMPLATE — not a substitute for legal review" callout. Google won't reject your consent screen for that, but get the pages reviewed by counsel and remove the draft warnings before public marketing launch.

### A.1. Google Cloud Console — OAuth consent screen (the 4-tab walkthrough)

Google's current Cloud Console (2024–2025 redesign) organizes the OAuth consent screen under **Google Auth Platform** with four tabs: **Branding → Audience → Clients → Data Access**. Fill them in this order.

1. Go to [Google Cloud Console](https://console.cloud.google.com/).
2. Select (or create) a project. Suggested name: `LyricPro`.
3. Open the hamburger menu (☰) → **APIs & Services → OAuth consent screen**. You'll land on the **Branding** tab (or be prompted to set User Type first — choose **External**, then continue).

#### A.1.1. Branding tab

- **App name:** `LyricPro Ai` (this is what users see on the consent page).
- **User support email:** `deric@intentionai.ai`.
- **App logo:** optional — skip for now. Uploading a logo triggers Google's verification process for *any* upload, even with non-sensitive scopes; not worth it.
- **App domain section:**
  - **Application home page:** `https://playlyricpro.com`
  - **Application privacy policy link:** `https://playlyricpro.com/privacy`
  - **Application terms of service link:** `https://playlyricpro.com/termsofservice`
- **Authorized domains:** click **+ Add Domain** and add `playlyricpro.com`. This is the gatekeeper field — Google validates that any redirect URI you register later belongs to a domain listed here. (Supabase's `*.supabase.co` does NOT need to be added; the Authorized domains list governs the *home/privacy/terms URLs* you just entered, not the OAuth callback. Google trusts Supabase's callback because Supabase is the OAuth client owner from Google's perspective.)
- **Developer contact information:** `deric@intentionai.ai` (this is what Google emails about app review or violation issues).
- Click **Save**.

#### A.1.2. Audience tab

- **User type:** `External` (allows any Google account; `Internal` is only for Google Workspace orgs, which doesn't apply here).
- **Publishing status:** flip from `Testing` to **Production** by clicking **PUBLISH APP**.
  - **Testing mode quirks:** only test users you explicitly list can sign in; max 100 over the project's lifetime (not resettable).
  - **Production mode:** anyone with a Google account can sign in. **No Google verification is required for us** because we only request the non-sensitive scopes `openid`, `email`, `profile`. The flip is one click.
- **Test users:** ignore if you're going straight to Production.

#### A.1.3. Data Access tab (the new home for "Scopes")

- Click **Add or remove scopes**.
- In the dialog, check these three (they're already in Google's default list — just check the boxes):
  - `.../auth/userinfo.email`
  - `.../auth/userinfo.profile`
  - `openid`
- **Do not add anything else.** Adding any other scope (Drive, Gmail, Calendar, Cloud Storage, etc.) flips your app into "sensitive scopes" territory and forces a multi-week Google verification process.
- Click **Update**, then **Save**.

#### A.1.4. Clients tab (covered in A.2 below)

You'll come back here to create the OAuth Client ID — that's a separate step described in A.2.

### A.2. Google Cloud Console — OAuth 2.0 Client ID

4. Still in OAuth consent screen, click the **Clients** tab → **+ Create Client** (or use the left nav: **APIs & Services → Credentials → + Create Credentials → OAuth client ID**).
   - Application type: **Web application**.
   - Name: `LyricPro Supabase Auth` (this name is just for your reference; users never see it).
5. Under **Authorized JavaScript origins**, click **+ Add URI** for each:
   - `https://playlyricpro.com`
   - `http://localhost:5173`
6. Under **Authorized redirect URIs**, click **+ Add URI** and add **exactly** (no trailing slash):
   - `https://lkjxhpcowfzwbvtpnevz.supabase.co/auth/v1/callback`
7. Click **Create**.
8. **What you'll see:** A modal with Client ID and Client Secret. Copy both — you'll paste them into Supabase next. (Save them to your password manager; the Client Secret isn't shown again without navigating back.)
   - **Don't paste them into chat with me.** Add the Client Secret directly into Supabase Dashboard in step A.3.

### A.3. Supabase Dashboard — enable Google provider

9. Go to [Supabase Dashboard](https://supabase.com/dashboard) → your project → **Authentication → Providers → Google**.
10. Toggle **Enable Sign in with Google** on.
11. Paste the **Client ID** and **Client Secret** from A.2.
12. Click **Save**.

### A.4. Supabase Dashboard — URL Configuration

13. In the same project, go to **Authentication → URL Configuration**.
14. **Site URL:** set to `https://playlyricpro.com`.
15. **Redirect URLs** — add all three (use `**` not `*`; the double-star matches path separators):
    - `https://playlyricpro.com/**`
    - `http://localhost:5173/**`
    - Vercel preview wildcard: `https://lyricpro-ai-*-[YOUR_VERCEL_TEAM_SLUG].vercel.app/**`
      - Find your team slug: Vercel Dashboard → top-left team selector → Settings → your team URL slug (e.g. `deric-team`). The pattern becomes `https://lyricpro-ai-*-deric-team.vercel.app/**`.
16. Click **Save**.

### A.5. Green-light test

**What to do:** Open an incognito window and go to `https://playlyricpro.com`. Click **Continue with Google**.

**What you'll see if it works:**
- Google consent screen appears.
- After authorizing, you're redirected to `/auth/callback`, then to `/` (or `/dashboard`).
- In Supabase → Authentication → Users: a new row with the Google email, provider `google`, and a creation timestamp within the last minute.
- In your database → `public.users`: a matching row created by the server-side `authenticateRequest` call.

**If you see "redirect_uri_mismatch":** The URL in step A.2.6 doesn't exactly match what Supabase uses. Check for trailing slashes, `http` vs `https`, and the project ref. The exact URL is: `https://lkjxhpcowfzwbvtpnevz.supabase.co/auth/v1/callback`

**If you see "Access blocked: This app's request is invalid":** The OAuth consent screen wasn't Published (step A.1.3). Go back and verify status is "In production."

---

## Section B — Apple OAuth (~25–30 min)

> **Apple's UI is slow.** Pages take 3–5 seconds to save. Be patient after each "Save" or "Continue."

### B.1. Apple Developer — create App ID

1. Go to [developer.apple.com/account](https://developer.apple.com/account) → **Certificates, Identifiers & Profiles → Identifiers → + (new)**.
2. Select **App IDs** → type **App** → Continue.
3. Description: `LyricPro Ai`. Bundle ID: **Explicit**, value: `ai.intentionai.lyricpro`.
   - (This must match the iOS Bundle ID when the Capacitor app is submitted. If you already have this App ID registered, skip to B.2.)
4. Scroll to **Capabilities**. Check **Sign in with Apple**.
5. Click **Continue → Register**.

### B.2. Apple Developer — create Services ID

6. Identifiers → + (new) → **Services IDs** → Continue.
7. Description: `LyricPro Web Auth`. Identifier: `ai.intentionai.lyricpro.web`.
8. Click **Continue → Register**.
9. You're back at the Identifiers list. Click into the Services ID you just created.
10. Check the **Sign in with Apple** checkbox, then click **Configure** (the link that appears inline next to the checkbox).
11. **Web Authentication Configuration** modal:
    - Primary App ID: pick `ai.intentionai.lyricpro` (the App ID from B.1).
    - **Domains and Subdomains:** enter `lkjxhpcowfzwbvtpnevz.supabase.co` (no `https://`, no path).
    - **Return URLs:** enter `https://lkjxhpcowfzwbvtpnevz.supabase.co/auth/v1/callback` (exact, no trailing slash).
12. Click **Next → Done → Continue → Save**.
    - **What you'll see after Save:** the Services ID detail page with Sign in with Apple showing "Enabled."

### B.3. Apple Developer — create Sign-in-with-Apple Key

13. In the sidebar, click **Keys → + (new)**.
14. Key Name: `LyricPro SIWA Key`.
15. Check **Sign in with Apple** → click **Configure** → Select the App ID `ai.intentionai.lyricpro` → Save.
16. Click **Continue → Register**.
17. **Before navigating away:** note the **Key ID** (10-character alphanumeric string shown on this page).
18. Click **Download** to download the `.p8` file. **You cannot download this again.** Save it to your password manager / secure vault immediately.
19. Note your **Team ID**: visible in the top-right of the Apple Developer portal, in your account profile. It's a 10-character alphanumeric string.

### B.4. Supabase Dashboard — enable Apple provider

20. Supabase Dashboard → your project → **Authentication → Providers → Apple**.
21. Toggle **Enable Sign in with Apple** on.
22. Fill in:
    - **Services ID (Client ID):** `ai.intentionai.lyricpro.web`
    - **Team ID:** [YOUR_TEAM_ID from B.3.19]
    - **Key ID:** [YOUR_KEY_ID from B.3.17]
    - **Private Key:** the **entire contents** of the `.p8` file, including the `-----BEGIN PRIVATE KEY-----` and `-----END PRIVATE KEY-----` lines. **Use a plain text editor** (TextEdit, VS Code) to open the file and copy-paste — never Word or Pages, which corrupt line endings.
    - Important: the `.p8 content` must have LF (Unix) line endings and a trailing newline. If your editor converts to CRLF, use `dos2unix` to fix it before pasting.
23. Click **Save**.

### B.5. Verify Supabase Auth version

24. In Supabase Dashboard → your project → **Settings → General**. Look for the Supabase Auth (GoTrue) version number.
    - **Required:** ≥ v2.176.1 (handles the new `account.apple.com` issuer that Apple rolled out in 2026).
    - Cloud projects auto-update; if you're on an older version, file a Supabase support ticket before proceeding.

### B.6. Green-light test

**What to do:** Open a fresh incognito window at `https://playlyricpro.com`. Click **Continue with Apple**.

**What you'll see if it works:**
- Apple's authentication page appears (may be a popup or redirect depending on browser).
- After signing in, you optionally choose to share your name and email (or hide email with private relay). Click **Continue**.
- Redirected to `/auth/callback`, then to `/` or `/dashboard`.
- In Supabase → Authentication → Users: new row with provider `apple`. If the user chose "Hide My Email," the email field will show `[something]@privaterelay.appleid.com` — this is correct and expected; Supabase tracks the stable Apple subject internally.
- In `public.users`: matching row created.

**First-sign-in name capture (check this once):** On the very first sign-in with Apple, Apple sends the user's name. Check that `auth.users.raw_user_meta_data` (in Supabase → Authentication → Users → click the user → JSON view) contains `full_name` or `given_name`. If not populated, it means the client-side capture from Wave 1 Task O1 isn't firing — let me know.

**If you see "invalid_client":** One of Services ID, Team ID, Key ID, or Return URL doesn't match. Double-check B.4 values, especially that Services ID is `ai.intentionai.lyricpro.web` (not the App ID).

**If you see "Key rejected" or "JWT generation failed":** The `.p8` file contents weren't pasted correctly. Re-open the `.p8` in a plain text editor, copy everything including the `-----BEGIN...` and `-----END...` lines, and repaste into Supabase.

### B.7. Calendar reminders — set these now

- **~2026-10-08 (5 months from today):** Re-check the Apple Sign in with Apple key. Apple `.p8` files don't expire, but Supabase generates a client_secret JWT from the `.p8` on each request with a 6-month cap. If you rotate the `.p8` key externally (e.g., for security rotation), repaste the new `.p8` contents into Supabase before the old key is revoked.
- **45 days before Apple Developer Program renewal:** Confirm auto-renewal status. Organization accounts on annual invoice billing may require manual renewal — if the membership lapses, Apple OAuth stops working.

---

## Section C — Stripe live mode (~30–40 min)

### C.1. Activate live mode

1. In Stripe Dashboard, toggle to **Live mode** (top-right switch, currently shows "Test mode").
2. If your account hasn't been activated for live payments yet, Stripe will show an activation flow. Complete:
   - Business details (legal name, address, business type)
   - EIN / SSN for TIN verification
   - Statement descriptor (≤22 characters, what customers see on their bank statement — suggest `LYRICPRO`)
   - Bank account for payouts (routing + account number)
   - Identity verification for account representative
   - **What you'll see after activation:** live mode dashboard with real data, no "Test mode" banner.
   - Note: activation review can take a few minutes to a few hours. Plan accordingly.

### C.2. Create products + prices (live mode)

3. Stripe Dashboard (Live mode) → **Products → + Add product**. Create three products in order:

   | Product name | Billing period | Price |
   |---|---|---|
   | LyricPro Player | Monthly | $4.99 |
   | LyricPro Pro | Monthly | $8.99 |
   | LyricPro Elite | Monthly | $11.99 |

   For each: set the product name, click **Add another price** → Recurring → Monthly → enter the price. Save.

4. After creating all three, navigate to each product's detail page and copy its **Price ID** (the `price_*` string under the price entry). You'll add these to Vercel in C.6.

### C.3. Register the webhook endpoint

5. Stripe Dashboard (Live mode) → **Developers → Webhooks → + Add endpoint**.
6. **Endpoint URL:** `https://playlyricpro.com/api/stripe/webhook`
   - Note: no trailing slash, exact URL. Stripe does not follow redirects — if your app returns 308 from this URL, events will fail silently.
7. **Events to subscribe** (select all six — all are wired in the Wave 1 handler):
   - `checkout.session.completed`
   - `invoice.paid`
   - `invoice.payment_failed` ← added in Wave 1
   - `customer.subscription.updated` ← added in Wave 1
   - `customer.subscription.deleted`
   - `charge.refunded`
8. Click **Add endpoint**.
9. On the endpoint detail page, click **Reveal** next to the signing secret. Copy the `whsec_...` value — you'll add it to Vercel in C.6 as `STRIPE_WEBHOOK_SECRET`.

### C.4. Customer Portal (live mode)

10. Stripe Dashboard (Live mode) → **Settings → Billing → Customer portal**.
    - Note: the Customer Portal is configured separately in live mode vs. test mode.
11. Click **Activate portal** (or if already shown as active, click into it to configure).
12. Enable the following features:
    - Cancel subscriptions
    - Switch plans
    - View invoice history
    - Update payment method
13. **Save** changes.

### C.5. Smart Retries (opt-in — required for our dunning logic)

14. Stripe Dashboard (Live mode) → **Settings → Billing → Subscriptions and emails** (may be listed as just "Subscriptions").
15. Find **Smart Retries** and toggle it **on**.
    - **Why this matters:** Without Smart Retries enabled, Stripe cancels a subscription on the first failed payment charge using the default cancellation schedule. Our Wave 1 webhook handler marks subscriptions as `past_due` on `invoice.payment_failed` and waits for retries to exhaust before revoking access (triggered by `customer.subscription.deleted`). If Smart Retries is off, the subscription is deleted immediately on first failure — which skips the dunning window entirely.

### C.6. Add env vars to Vercel (Production environment only)

Go to Vercel Dashboard → your project → **Settings → Environment Variables**.

For each variable below:
- Click **+ Add New**.
- Under **Environments**, select **Production only** (uncheck Preview and Development).
- Set the appropriate sensitivity.

**Mark as Sensitive (select "Sensitive" in the Type dropdown):**

| Variable name | Where to get the value |
|---|---|
| `STRIPE_SECRET_KEY` | Stripe Dashboard (Live mode) → Developers → API keys → Secret key (`sk_live_...`) |
| `STRIPE_WEBHOOK_SECRET` | The `whsec_...` value you copied in C.3.9 |

**Regular (non-sensitive):**

| Variable name | Where to get the value |
|---|---|
| `STRIPE_PRICE_PLAYER` | The `price_*` ID for LyricPro Player from C.2 |
| `STRIPE_PRICE_PRO` | The `price_*` ID for LyricPro Pro from C.2 |
| `STRIPE_PRICE_ELITE` | The `price_*` ID for LyricPro Elite from C.2 |

**While you're here — confirm existing sensitive vars are marked correctly:**

- `SUPABASE_SERVICE_ROLE_KEY` — should be marked **Sensitive**. If it isn't, rotate it (Supabase Dashboard → Settings → API → rotate the service-role key, then update in Vercel) because it was previously stored as plaintext.
- Any JWT/cookie secrets (e.g., `SESSION_SECRET`, `JWT_SECRET` if present) — same rule.

**Keep test-mode values in Preview/Development:** Do NOT add `sk_live_*` to Preview or Development environments. Your existing test-mode `sk_test_*` should remain there (or in `.env` locally) for non-production testing.

### C.7. Apply the database schema migration

Before the first live subscription event arrives, the `subscription_status` enum needs the new values added in Wave 1.

**Option A — via your normal migration flow:**
```bash
pnpm db:push
```

**Option B — directly in Supabase SQL editor** (Supabase Dashboard → SQL Editor):
Run the contents of `drizzle/0006_puzzling_turbo.sql`. This file contains the five `ALTER TYPE` statements that widen the `subscription_status` enum to include `past_due`, `unpaid`, and any other values added in Wave 1.

Confirm the migration ran: in Supabase → Table Editor → find your `subscriptions` table → the `status` column should accept `past_due` and `unpaid` without errors.

### C.8. Trigger production redeploy

16. Env vars only take effect on the next deployment. Go to Vercel Dashboard → your project → **Deployments**.
17. Find the most recent Production deployment → click the `...` menu → **Redeploy**.
18. Check **"Redeploy without build cache"** to ensure a clean build.
19. Wait for the new deployment to show status **Ready** (green). This usually takes 2–4 minutes.

### C.9. Re-create promotion codes / coupons

Test-mode promotion codes do not carry over to live mode. If you have any active promo codes (e.g., for friends/beta users), recreate them in live mode:
- Stripe Dashboard (Live mode) → **Coupons** (or **Promotions** depending on UI version) → recreate against the live `price_*` IDs from C.2.

### C.10. Green-light test (run in this exact order)

**Step 1 — Smoke test (confirm live keys are active):**
- Go to `https://playlyricpro.com` → choose a plan → proceed to Checkout.
- Enter the Stripe test card number `4242 4242 4242 4242` (any future expiry, any CVC).
- **Expected result:** Stripe declines with error code `test_mode_live_card`. This means live keys are active. If the card is accepted or you see a different error, stop — you may still be on test keys. Go back and verify `STRIPE_SECRET_KEY` in Vercel is the `sk_live_*` value.

**Step 2 — Real subscription purchase:**
- Use a real card you'll refund afterward (a prepaid Visa or personal card works).
- Subscribe to any plan at `https://playlyricpro.com`.
- **Expected result:**
  - Stripe Checkout completes, redirects to `/dashboard`.
  - In Stripe Dashboard (Live mode) → **Payments**: a new payment appears.
  - In Stripe → Developers → Webhooks → your endpoint → Recent deliveries: `checkout.session.completed` shows HTTP 200.
  - In your database `subscriptions` table: a new row with a live `stripeSubscriptionId` (starts with `sub_`, not `sub_test`), status `active`.

**Step 3 — Test subscription cancellation:**
- In Stripe Dashboard (Live mode) → **Customers** → find the customer from Step 2 → their subscription → **Cancel subscription** → cancel immediately.
- **Expected result:** `customer.subscription.deleted` webhook fires → `subscriptions.status = 'canceled'` in DB.

**Step 4 — Test refund:**
- In Stripe Dashboard (Live mode) → **Payments** → find the charge from Step 2 → **Refund**.
- **Expected result:** `charge.refunded` webhook fires (check Webhook delivery logs). Depending on your refund handler logic, the subscription status may already be `canceled` from Step 3 — confirm the event was received with HTTP 200.

**After Step 4:** refund issued, subscription canceled, test complete.

---

## After all three sections pass

Tell me **"all three providers green"** and I'll dispatch Wave 3 — three verification subagents running in parallel (Agent G for Google, Agent A for Apple, Agent S for Stripe), each returning PASS/FAIL with evidence.

If anything fails, tell me: which step, which section, and the exact error message you see. I can debug without needing any secret values.
