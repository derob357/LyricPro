# OAuth (Google + Apple) + Stripe Live + Security Scan + Manus Removal — Design

**Date**: 2026-05-08
**Status**: Drafted, awaiting review
**Goal**: Take Google OAuth and Apple OAuth from "code-complete, provider-side unconfigured" to "live in production." Take Stripe from "test-mode wired" to "live in production." Run a baseline security scan, then a delta scan over the final state. Remove all Manus-era legacy code in the same cycle.

---

## 1. Goals & non-goals

### In scope

1. **Pre-flight security scan** of `main` (Wave 0) and a delta scan after all changes land (Wave 4). Two specialist subagents run each pass: `Security Engineer` + `Compliance Auditor`.
2. **Manus-era code removal** — six-step deletion in dependency order (Wave 1).
3. **OAuth code adjustments** required for production-quality OAuth: Apple `name email` scope, first-sign-in profile capture, Helmet COOP override, CSP allowlist for Supabase + Stripe, Stripe API version pin, missing webhook events, webhook handler `maxDuration`.
4. **Stripe code adjustments** — fix the `STRIPE_TEST2_KEY_STRIPE_SECRET_KEY` reference at [server/routers/goldenNotes.ts:115](../../server/routers/goldenNotes.ts#L115); add `customer` resolution to Checkout sessions (dedup); add the two missing webhook events.
5. **Three targeted tests** — webhook signature 400, subscription-checkout creation, first-sign-in user-row creation.
6. **Provider dashboard configuration runbook** combining and updating [docs/oauth-setup-google.md](../../oauth-setup-google.md) and [docs/oauth-setup-apple.md](../../oauth-setup-apple.md), plus a new live-mode Stripe walkthrough.
7. **Three end-to-end verification subagents** — one per provider, each PASS/FAIL with evidence (Wave 3).

### Out of scope (explicit non-goals)

- **Apple Sign-In native iOS path.** Capacitor + `@capacitor-community/apple-sign-in` integration is a separate spec, scheduled for whenever the iOS submission is closer.
- **Google OAuth verification (publication out of "Testing" mode for sensitive scopes).** We use only `openid email profile`, which does not require Google's verification process; we still need to click **Publish App** to leave Testing mode, but no Google security review is needed.
- **Stripe Tax, Stripe Identity, Stripe Connect.**
- **External penetration test or SaaS DAST scanner.** Approach (b) was chosen.
- **Account-deletion / GDPR-style erasure flow.** Mentioned in scan lanes; not implemented in this cycle.
- **Migrating off Supabase**, restructuring `supabase-auth.ts`, restructuring the webhook handler, restructuring the rate-limiter.
- **iOS Capacitor wrapper security review.**
- **Test → live promotion automation in CI.** Stays manual via Vercel env-var promotion.
- **Email deliverability / Resend production audit.**
- **Custom Supabase auth domain** (`auth.playlyricpro.com`) — improves consent-screen branding but is a multi-day separate effort.
- **Apple revoke-tokens compliance** — only forced for App Store apps.

---

## 2. Workstreams & sequencing

Five waves, executed in order. Each wave has a clear exit criterion before the next begins.

### Wave 0 — Pre-flight security scan (baseline)

- Two specialist subagents in parallel against current `main`: `Security Engineer` + `Compliance Auditor`.
- Output: `/memory/security-scan-2026-05-08-baseline.md`.
- **Triage between Wave 0 and Wave 1.** Critical → fix in Wave 1, no exceptions. High → fix in Wave 1 if mechanical; otherwise raise to user before Wave 2. Medium → batch into Wave 1 if cheap; defer with a tracker entry. Low/Info → log.
- I surface findings as a numbered list with proposed disposition before starting Wave 1.

**Exit criterion:** baseline report committed; user has reviewed proposed dispositions for Critical/High findings.

### Wave 1 — Code-side work (parallel-friendly)

- **Manus removal** (six steps; see §3.1).
- **OAuth code adjustments** (see §3.2).
- **Stripe code adjustments** (see §3.3).
- **Three new tests** (see §3.4).
- **Mechanical fixes** from Wave 0 baseline (see §3.5).

**Exit criterion:** `pnpm build` clean, `pnpm test` green, all changes committed.

### Wave 2 — Provider dashboard configuration (user-driven)

User walks the combined runbook (see §4). Three sections, in any order: Google → Apple → Stripe. Each ends with a green-light test.

**Constraints:**
- **No secrets in chat.** I only ever ask for env-var **names** to be added to `.env` (local) and Vercel UI (prod). When user says "saved," I read from `.env` on disk.
- I pre-fill every redirect URI, callback URL, Services ID convention, and event list before the wave starts.

**Exit criterion:** all three providers report green-light test passing.

### Wave 3 — End-to-end verification (parallel subagents)

Three subagents in parallel: `Agent G` (Google), `Agent A` (Apple), `Agent S` (Stripe). Each is read-only against the live state, each returns PASS/FAIL with evidence (see §5).

**Exit criterion:** three PASS reports. Any FAIL → fix and re-run that one agent only.

### Wave 4 — Delta security scan (final)

Same two specialists from Wave 0, prompted to diff against the baseline. Output: `/memory/security-scan-2026-05-08-final.md`.

**Exit criterion:** zero open Critical or High findings. Anything else gets logged with a tracker entry in `todo.md`.

---

## 3. Wave 1 — Code-side work

### 3.1. Manus removal (six steps, in dependency order)

**Step 1 — Top-level dead callers.**
- Delete [server/_core/oauth.ts](../../server/_core/oauth.ts) (legacy code-exchange route, unwired).
- Delete [client/src/components/ManusDialog.tsx](../../client/src/components/ManusDialog.tsx) (never imported).
- [client/src/pages/Lobby.tsx:51](../../client/src/pages/Lobby.tsx#L51) — Manus portal redirect. Replace with a redirect to `/signin` (do **not** just delete the branch — preserve unauthenticated fallback).
- Verify: re-grep for `oauth.ts`, `ManusDialog`, `VITE_OAUTH_PORTAL_URL`. Build + tests pass.

**Step 2 — Now-orphaned SDK + types.**
- Delete [server/_core/sdk.ts](../../server/_core/sdk.ts) (`exchangeCodeForToken`, `getUserInfo`, `createSessionToken`, `verifySession`, legacy `authenticateRequest` JWT-cookie path, hardcoded WebDevAuthPublicService paths).
- Delete [server/_core/types/manusTypes.ts](../../server/_core/types/manusTypes.ts).
- Verify: nothing imports `sdk.ts` or `manusTypes.ts` after deletion.

**Step 3 — Env var + legacy cookie cleanup.**
- [.env.example](../../.env.example) lines 41–48: drop `VITE_APP_ID`, `VITE_OAUTH_PORTAL_URL`, `OAUTH_SERVER_URL`, `OWNER_OPEN_ID`, `JWT_SECRET` and the explanatory comment.
- Clean `env.ts` (or equivalent) of any typed config that reads these.
- Remove the legacy-cookie `clearCookie` block in `server/app-router.ts:35-41` (already neutralized; now redundant with `JWT_SECRET` going away).
- **User action note:** delete these vars from Vercel Project Settings (Production + Preview + Development).

**Step 4 — Vite plugin + debug collector.**
- Remove `vite-plugin-manus-runtime` from [package.json](../../package.json) and the import in [vite.config.ts](../../vite.config.ts).
- Remove the `vitePluginManusDebugCollector()` plugin and `/__manus__/logs` endpoint.
- Delete the four copies of `__manus__/debug-collector.js` (`client/public/`, `ios/`, `android/`, `dist/`).
- Drop the Manus domain allowlist (`*.manuspre.computer`, `*.manus.computer`, `*.manus-asia.computer`, `*.manuscomputer.ai`, `*.manusvm.computer`).
- `pnpm install` + clean `pnpm build`.

**Step 5 — Diagnostic directories.**
- Delete `.manus/` and `.manus-logs/`.
- Add both to `.gitignore` defensively.

**Step 6 — Stale comments + lingering Forge URL.**
- Fix stale docstrings in [server/_core/notification.ts](../../server/_core/notification.ts), [server/storage.ts](../../server/storage.ts), [server/_core/map.ts](../../server/_core/map.ts).
- [server/_core/llm.ts:215](../../server/_core/llm.ts#L215) hardcoded fallback `https://forge.manus.im/v1/chat/completions` — **flag for user decision** in Wave 0 report. Default disposition: drop the fallback entirely, throw if `BUILT_IN_FORGE_API_URL` isn't set (Manus URL out of trust boundary).
- `server/auth.logout.test.ts:21` change `loginMethod: "manus"` → `"supabase"` for consistency.

### 3.2. OAuth code adjustments

**O1. Apple `name email` scope + first-sign-in profile capture.** (D1)
- [client/src/pages/SignIn.tsx:128](../../client/src/pages/SignIn.tsx#L128) — when `provider === 'apple'`, pass `options: { scopes: 'name email', redirectTo }`.
- Add a one-time profile-capture handler on the first `SIGNED_IN` event: read `session.user.user_metadata.full_name` (or `name`/`given_name`+`family_name` if structured), call `supabase.auth.updateUser({ data: { full_name } })`, upsert into `public.users` if our schema has a name field.
- Important: Apple returns the name **only on first authorization**. If we don't capture it now, we can't get it later without the user revoking + re-authorizing.
- Apply only on first SIGNED_IN — don't overwrite on subsequent logins (would clobber user-edited values with null).

**O2. Helmet `Cross-Origin-Opener-Policy: same-origin-allow-popups`.** (D3)
- Override Helmet's default COOP to `same-origin-allow-popups` (or disable COOP entirely on auth pages). Default `same-origin` breaks Google/Apple OAuth popup flows in some browsers.
- Apply via `helmet({ crossOriginOpenerPolicy: { policy: 'same-origin-allow-popups' } })` in [server/_core/index.ts](../../server/_core/index.ts) (lines 50–55, helmet config block).

**O3. CSP allowlist for Supabase + Stripe.** (D4)
- Helmet CSP is currently disabled in dev (per existing config) and enabled in prod with defaults. Defaults will block Supabase OAuth redirects and Stripe Checkout assets.
- Add prod-only directives:
  - `connect-src` adds: `https://<supabase-ref>.supabase.co`, `https://api.stripe.com`.
  - `script-src` adds: `https://js.stripe.com`.
  - `frame-src` adds: `https://js.stripe.com`, `https://hooks.stripe.com`, `https://checkout.stripe.com`.
  - `img-src` adds: `https://*.stripe.com`.
- Use `useDefaults: true` to keep Helmet's secure base; only add the entries above.
- Run with `reportOnly: true` for the first prod deploy if any CSP violations are uncertain — switch to enforcing once clean.

**O4. Email collision check (D8).** Trace the `public.users` provisioning path during Wave 0 scan.
- If provisioning is via a `handle_new_user` trigger on `auth.users` INSERT only, an existing email/password user signing in with Google for the first time won't get OAuth metadata applied (Supabase auto-links the identity but doesn't re-fire INSERT).
- If affected: add a trigger on `auth.identities` INSERT/UPDATE that backfills/updates `public.users` from the new identity's metadata.
- Out of scope if scan shows the existing path already handles this (e.g., the on-request `authenticateRequest` auto-create at [server/_core/supabase-auth.ts](../../server/_core/supabase-auth.ts) lines 79–118 may already cover it).

**O5. Supabase Auth version check (D9).** Wave 0 environment check confirms project is on GoTrue ≥ v2.176.1 (handles new Apple `account.apple.com` issuer). Cloud projects auto-update; if older, Supabase support ticket.

**O6. Supabase Redirect URLs allow-list (D7).** No code change here; lives in Wave 2 runbook. Use `**` (not `*`) to match path separators. Add prod domain, `localhost`, Vercel preview wildcard.

### 3.3. Stripe code adjustments

**S1. Fix the `STRIPE_TEST2_KEY_STRIPE_SECRET_KEY` reference.** [server/routers/goldenNotes.ts:115](../../server/routers/goldenNotes.ts#L115). Read line in context first to confirm intent. Default disposition: accidental concat, normalize to `process.env.STRIPE_SECRET_KEY`. If the line is intentional (separate test-mode key), surface to user before changing.

**S2. Add two webhook events to the handler.** (D2)
- `customer.subscription.updated` — handle status transitions (`past_due`, `unpaid`, plan changes, pause/resume). Update `subscriptions.status` and `subscriptions.tier` if changed. Extend `currentPeriodEnd` if `current_period_end` updated.
- `invoice.payment_failed` — mark the subscription as `past_due` (do **not** revoke immediately — let dunning run via Stripe Smart Retries; only revoke on `customer.subscription.deleted`). **Smart Retries is opt-in** — the runbook (§4.3) includes a step to confirm it's enabled in Stripe Settings → Billing → Subscriptions; without it, Stripe cancels on the first failed charge per the default schedule.
- Also extend the test webhook signature test to cover the new events as smoke checks.

**S3. Add the two new events to the live webhook endpoint registration.** Lives in §4 runbook (Stripe Dashboard step).

**S4. Stripe API version pin (D10).** In `new Stripe(key, { apiVersion: '2025-09-30.clover' })` (or whatever Stripe's current pinned version is — confirm in Wave 0 by checking [server/stripe-integration.ts](../../server/stripe-integration.ts) line 3 area). Without a pin, Stripe SDK floats and proration math + payload shapes can shift unannounced.

**S5. Webhook function `maxDuration: 30` (D6).** Add `export const config = { maxDuration: 30 }` (or equivalent in `vercel.json` `functions` block) to the webhook handler. Default Vercel timeout under cold start may not cover raw-body parse + `constructEvent` + DB writes inside Stripe's 20s retry window.

**S6. Customer dedup on Checkout (D13).** Wave 0 scan: trace whether we map our user → `stripe_customer_id` anywhere. If not:
- Before creating a Checkout Session, look up an existing `stripe_customer_id` for the user (either via a `users.stripe_customer_id` column or via `customers.search({ query: \`email:'${email}'\` })`).
- Pass `customer:` if found; otherwise let Stripe create one and persist the resulting `cus_*` from the completed session.
- Without this, every checkout for the same email creates a new `cus_*`, producing ghost customers with no payment methods.

### 3.4. Three new tests

- **`server/stripe.webhook-signature.test.ts`** — feeds a known-bad signature into the webhook, asserts 400. Covers regression where someone disables `constructEvent`.
- **`server/stripe.subscription-checkout.test.ts`** — calls `createSubscriptionCheckout` with mocked Stripe, asserts the right `mode='subscription'`, the right price ID per tier (`STRIPE_PRICE_PLAYER/PRO/ELITE`), the right success/cancel URLs.
- **`server/auth.first-signin-user-row.test.ts`** — calls `authenticateRequest` with a Supabase JWT for a user not yet in `public.users`, asserts the row gets created with the expected fields. Covers the Apple private-relay-email case (email is `xxx@privaterelay.appleid.com`).

### 3.5. Mechanical fixes from Wave 0

Anything Wave 0 surfaces that's mechanical (a missing input validator, a route that should be `protectedProcedure` but isn't, a header config gap, an HSTS `includeSubDomains` flag absence) gets applied here. Decisions get surfaced.

---

## 4. Wave 2 — Provider dashboard runbook

Deliverable: `docs/oauth-and-stripe-go-live-2026-05-08.md`. Combines + updates existing runbooks with concrete pre-filled values.

### 4.0. Format conventions

- Each step is numbered and atomic.
- **What you'll see** → **What to do** → **Verify**.
- **Secrets handling rule, repeated at top:** I only ever ask for env-var **names** to be added to `.env` and Vercel. Values stay between user and the provider dashboard. When user says "saved," I read from `.env` on disk. I never echo values.
- Pre-fillable values get filled. Unfillable values get `[YOUR_VALUE]` placeholders.
- Each provider section ends with a green-light test.

### 4.1. Section A — Google (estimated 15 min)

1. Google Cloud Console → APIs & Services → Credentials → create OAuth 2.0 Client ID (type: Web application).
2. Authorized JavaScript origins: prod app origin (e.g., `https://playlyricpro.com`) + dev origins (`http://localhost:5173`).
3. Authorized redirect URIs: `https://[YOUR_SUPABASE_REF].supabase.co/auth/v1/callback` (exact, no trailing slash). I'll capture the Supabase ref before the wave starts.
4. OAuth consent screen → keep scopes to `openid email profile` (default). Click **Publish App** to leave Testing mode (no Google verification needed since we're not requesting sensitive scopes).
5. Copy Client ID + Client Secret → paste into Supabase Dashboard → Auth → Providers → Google.
6. Supabase Auth → URL Configuration → Site URL = prod app URL; Redirect URLs allow-list includes:
   - `https://playlyricpro.com/**`
   - `http://localhost:5173/**`
   - `https://*-yourteam.vercel.app/**` (preview wildcard; replace with your team slug)
7. **Green-light test:** Sign in with Google in incognito at prod URL. Expect: redirect → consent → return → `/`, with `auth.users` row + `public.users` row present.

### 4.2. Section B — Apple (estimated 25–30 min)

1. Apple Developer → Certificates, Identifiers & Profiles → create App ID (`ai.intentionai.lyricpro`). Enable Sign in with Apple capability.
2. Create **Services ID** (`ai.intentionai.lyricpro.web`) — this is the OAuth `client_id` for web.
3. Configure Services ID → Web Authentication Configuration:
   - Primary App ID = the App ID just created.
   - Domains and Subdomains: `[YOUR_SUPABASE_REF].supabase.co` (no scheme, no path).
   - Return URLs: `https://[YOUR_SUPABASE_REF].supabase.co/auth/v1/callback` (exact, no trailing slash, no wildcards).
4. Apple Developer → Keys → create a **Sign in with Apple Key** → download `.p8` **once** (Apple will not show it again). Capture the **Key ID** before navigating away.
5. Capture **Team ID** from top-right of Apple Developer portal.
6. Supabase Dashboard → Auth → Providers → Apple:
   - Client IDs: Services ID (comma-separated if multiple — could include the iOS Bundle ID later).
   - Team ID, Key ID, full `.p8` body **including** `-----BEGIN PRIVATE KEY-----` / `-----END PRIVATE KEY-----` markers and trailing newline. LF line endings only (open in a plain text editor, not Word).
7. **Verify Supabase Auth version ≥ v2.176.1** (handles the new `account.apple.com` issuer). Cloud auto-updates; if stuck, file a Supabase support ticket.
8. **Green-light test:** Sign in with Apple in incognito at prod URL. Expect: Apple consent → return → user row created. Specifically test:
   - The private-relay email path (email is `xxx@privaterelay.appleid.com`) — the user-row test from §3.4 covers this.
   - The first-sign-in name capture — `user_metadata.full_name` should be populated.
9. **Set calendar reminders:**
   - 5 months from today (~2026-10-08): re-check Apple `.p8` / client_secret JWT (Apple caps lifetime at 6 months; Supabase signs from `.p8` each request, but if `.p8` is regenerated externally, repaste required).
   - 45 days before Apple Developer Program renewal: confirm auto-renewal status (org accounts on annual invoice billing must renew manually).

### 4.3. Section C — Stripe live (estimated 30–40 min)

1. Stripe Dashboard → toggle to **Live mode** (top-right).
2. **Activate live mode** — confirm business details, EIN/SSN with TIN match, statement descriptor (≤22 chars), bank account verified, representative emails. Stripe blocks live charges until activation is complete.
3. Live mode → Products → create three products:
   - "LyricPro Player" with one monthly recurring price at $4.99
   - "LyricPro Pro" with one monthly recurring price at $8.99
   - "LyricPro Elite" with one monthly recurring price at $11.99
   Capture the three live `price_*` IDs.
4. Live mode → Webhooks → add endpoint at `https://www.playlyricpro.com/api/stripe/webhook` (or whatever the prod path is — Wave 0 confirms from route registration). Select events:
   - `checkout.session.completed`
   - `invoice.paid`
   - `invoice.payment_failed` *(new in Wave 1)*
   - `customer.subscription.updated` *(new in Wave 1)*
   - `customer.subscription.deleted`
   - `charge.refunded`
   Reveal the live `whsec_*` signing secret.
5. Live mode → Settings → Customer Portal → **enable** (it's off by default in live, configured separately from test). Toggle on cancellation, plan switching, invoice history, and update-payment-method.
5b. Live mode → Settings → Billing → Subscriptions → **enable Smart Retries** (opt-in; without it, Stripe cancels subscriptions on the first failed charge per the default schedule, which conflicts with our Wave 1 dunning logic in §3.3 S2).
6. **Vercel env-var update** (user does this in Vercel Dashboard, not chat). Add to **Production environment only**:
   - `STRIPE_SECRET_KEY` (live `sk_live_...`) — mark as **Sensitive**.
   - `STRIPE_WEBHOOK_SECRET` (live `whsec_...`) — mark as **Sensitive**.
   - `STRIPE_PRICE_PLAYER`, `STRIPE_PRICE_PRO`, `STRIPE_PRICE_ELITE` — non-sensitive.
   - **Keep test-mode values in Preview/Development** (do not check Production for any test-mode key).
   - Also confirm `SUPABASE_SERVICE_ROLE_KEY` and any JWT/cookie secrets are marked **Sensitive**.
7. Trigger a production redeploy (env vars only take effect on next deploy). Use Vercel Dashboard → Deployments → Redeploy without build cache.
8. Re-create any **promotion codes / coupons** in live mode that were created in test (codes don't carry over).
9. **Green-light test (sequence — order matters):**
   - First, smoke test that the live key flipped: try Checkout with test card `4242 4242 4242 4242`. Expect decline with code `test_mode_live_card`. (If it succeeds, you're still on test keys.)
   - Then real test: subscribe with a real card you'll refund. Expect: redirect to `/dashboard` → webhook delivers (200 from our handler) → `subscriptions` row written with live `stripeSubscriptionId`.
   - Cancel from Stripe Dashboard → `customer.subscription.deleted` fires → `subscriptions.status='canceled'` in DB.
   - Refund the charge → `charge.refunded` fires → state reverts.

### 4.4. Boundaries

- Apple Developer Program 2FA / device verification is on the user — I can't help and shouldn't see those codes.
- I won't ask the user to paste any client secret, `.p8` contents, or Stripe key into chat. Values go straight from provider dashboard → `.env` (local) or Vercel UI (prod).

---

## 5. Wave 3 — End-to-end verification (parallel subagents)

Three subagents run after the user signals Wave 2 complete. Each is read-only against live state, returns PASS/FAIL with evidence.

### 5.1. Agent G — Google OAuth

- **Checks:** redirect URI in Google Cloud Console matches Supabase callback exactly. Supabase Provider config for Google enabled. Manual flow trigger (user signs in with Google in incognito while agent watches server logs / DB).
- **Evidence required:** server log line confirming Supabase JWT validated for the new user; `auth.users` row exists; `public.users` row created with correct fields; user lands on right post-sign-in route.
- **Failure modes to probe:** redirect URI mismatch (most common), Supabase Redirect URLs allow-list missing prod URL or using single `*` instead of `**`, OAuth client still in Testing mode blocking non-test-user emails, missing `email` scope.

### 5.2. Agent A — Apple OAuth

- **Checks:** Services ID matches Supabase. Return URL on Services ID matches Supabase callback exactly. `.p8` accepted (Supabase surfaces "JWT generation failed" if not). Team ID + Key ID correct. Auth version ≥ v2.176.1.
- **Evidence required:** Supabase JWT issued, `auth.users` row, `public.users` row. **Specifically test the Apple private-relay email path.** **Specifically test the first-sign-in name capture** — `user_metadata.full_name` populated and persisted.
- **Failure modes to probe:** malformed `.p8` (line endings, missing BEGIN/END, no trailing newline — most common), Services ID mismatch, return URL trailing-slash mismatch, missing `name` scope, `account.apple.com` issuer rejection (if Auth version old).

### 5.3. Agent S — Stripe live

- **Checks:** live `STRIPE_SECRET_KEY` reachable from prod (no test-mode banner on Checkout). Three live price IDs resolve to real products. Webhook endpoint registered for the right six events. Webhook signing secret matches Vercel.
- **Evidence required (sequence):**
  1. Test card `4242` on prod returns decline `test_mode_live_card` (proves live keys flipped).
  2. Real subscription purchase from prod with real card → Stripe webhook delivery succeeds (200 from our handler) → `subscriptions` row written with live `stripeSubscriptionId`.
  3. Cancel from Stripe Dashboard → `customer.subscription.deleted` fires → `subscriptions.status='canceled'`.
  4. Refund the charge → `charge.refunded` fires → state reverts.
  5. Probe webhook URL for 308 redirects (apex↔www, trailing slash) — Stripe doesn't follow redirects.
- **Failure modes to probe:** webhook secret mismatch (silent until first event), price ID env var mismatch (checkout 500s), webhook URL pointing at preview deployment instead of prod alias, webhook URL trailing-slash 308.

Each agent returns a structured PASS/FAIL report. If any FAIL → fix that one item, re-run that one agent only.

---

## 6. Waves 0 & 4 — Security scan methodology

### 6.1. Subagents and lanes

**`Security Engineer` — application + transport surface.**
- AuthN/AuthZ: every tRPC procedure correctly typed (`protectedProcedure` / `adminProcedure`); every Express route has an auth check or is intentionally public; no auth bypass via header tampering.
- Input validation: every tRPC input has a zod schema; query/path params on Express routes validated.
- Session integrity: Supabase JWT validation path; cookie flags (HttpOnly, Secure, SameSite); CSRF posture.
- Webhook security: signature verification unconditional; raw-body middleware upstream of JSON parser; idempotency table cannot be bypassed; 308 redirect probes.
- Transport: Helmet config audit (especially **COOP** override and **CSP allowlist** from §3.2); CORS allowlist correctness; HSTS with `includeSubDomains` if subdomains exist; CSP enabled in prod.
- Rate limiting: every sensitive operation (auth, OTP send, checkout create, password reset) has a bucket; no holes.
- Secret-leak scan: hardcoded keys, secrets in logs, secrets in error messages returned to clients.
- OWASP top-10 walkthrough.

**`Compliance Auditor` — process, data, provider trust.**
- Stripe-specific: webhook event allowlist; refund/dispute handling; subscription state machine; idempotency under replay; PCI scope confirmation (SAQ-A — hosted Checkout, no card data on origin); customer dedup pattern; API version pinning.
- Supabase RLS: every table either has RLS enabled or is documented as service-role-only; service-role key never reaches client; Supabase Auth version check (≥ v2.176.1).
- OAuth provider trust: state validation; PKCE enabled; redirect-URI strict matching; no open-redirect chain via `next` params; Apple private-relay email handling; first-sign-in name capture; email-collision identity-linking handling.
- Data lifecycle: PII fields documented; deletion path exists; no PII in logs.
- Logging hygiene: redaction in place for emails, JWTs, OTPs, webhook bodies.
- `.env.example` is current and free of dead vars.
- Vercel env-var scoping (live secrets Production-only and marked Sensitive; nothing live in Preview).
- **Supabase rate-limit IP forwarding (D17).** Default 30 OAuth sign-ins/hour per IP. Behind Vercel/Express, all traffic looks like one IP unless we forward the client IP via the `Sb-Forwarded-For` header on Supabase admin requests. Compliance Auditor traces our auth path; if we don't forward, log as Medium and consider implementation in a follow-up (or enable hCaptcha/Turnstile under Auth → Settings as a mitigation). Not a blocker for go-live.
- `pnpm audit` for known-vuln deps.

### 6.2. Subagent prompting constraints

Subagents are explicitly told never to echo `.env` values, secret strings, JWTs, or full webhook payloads in their reports. Findings cite `file:line`, not value content. If a subagent finds a real secret committed to the repo, the finding cites file:line and severity, not the secret string.

### 6.3. Report format

Each scan produces a single markdown file:
- Wave 0: `/memory/security-scan-2026-05-08-baseline.md`
- Wave 4: `/memory/security-scan-2026-05-08-final.md`

Each contains:
1. **Methodology** — what was scanned, by which agent, with what scope.
2. **Findings table** — `ID | Severity | Title | Location | Status (Open/Fixed/Wontfix/Accepted)`.
3. **Per-finding detail** — description, attack scenario, suggested fix, evidence (`file:line`).
4. **Severity rubric** — Critical = remote code exec / auth bypass / payment bypass. High = privilege escalation / PII leak / webhook forgery. Medium = info disclosure / DoS / weak headers. Low = hygiene. Info = posture observation.
5. **Coverage gaps** — what was *not* scanned and why (iOS Capacitor wrapper out of scope; client-side XSS spot-checked only; no automated DAST).

The **final** report adds:
6. **Diff against baseline** — fixed / new since baseline / pre-existing still open.

### 6.4. Triage policy

- **Critical** → fix in Wave 1, no exceptions.
- **High** → fix in Wave 1 if mechanical; otherwise raise to user before Wave 2.
- **Medium** → batch into Wave 1 if cheap; defer with `todo.md` entry if not.
- **Low / Info** → log; no action unless trivial.

---

## 7. Definition of Done

All four must be true:

1. Three Wave 3 verification reports all PASS.
2. Wave 4 final scan shows zero open Critical or High findings.
3. `pnpm build` and `pnpm test` both green on a clean checkout of the merged branch.
4. `git log` shows clean, conventionally-prefixed commits (`feat`, `fix`, `chore`, `test`, `docs`) — no Manus references in commit subjects, no `Co-Authored-By: Claude` trailer.

---

## 8. Risks

1. **Apple `.p8` mishandling.** The single biggest source of Apple OAuth failures. Mitigation: Agent A specifically tests this; runbook explicitly tells user to copy file as-is, never paste contents into chat.
2. **Vercel env-var scoping.** Adding live Stripe keys to all environments leaks them to preview deploys (publicly accessible at `*.vercel.app`). Mitigation: runbook is explicit per-environment; Agent S checks active key shape on prod URL; live keys marked Sensitive (per April 2026 Vercel incident learnings).
3. **Webhook secret rotation gap.** When user generates the live webhook secret, there's a window where the old (test) secret is still in `STRIPE_WEBHOOK_SECRET` until redeploy. Mitigation: trigger redeploy *before* doing live test purchase; runbook calls this out explicitly.
4. **Manus removal cascade build break.** Six-step deletion order should prevent it; if `pnpm build` breaks at any step, revert that step and investigate before continuing.
5. **CSP rollout breaks production.** New CSP directives could block a third-party we're not aware of. Mitigation: deploy with `reportOnly: true` first; check browser console + CSP report endpoint for violations before enforcing.
6. **Webhook handler timeout under cold start.** Even with `maxDuration: 30`, heavy DB writes inside the handler under cold start could approach Stripe's 20s retry threshold. Mitigation: Agent S verifies real webhook delivery time; if slow, defer DB work to a queue (out-of-scope follow-up).

---

## 9. Wall-clock estimate

- Wave 0: 15–20 min (parallel subagents) + 10 min user triage of findings.
- Wave 1: 90–120 min (Manus removal + OAuth/Stripe code + tests + mechanical fixes).
- Wave 2: 60–80 min (user-driven dashboard work, with me on standby).
- Wave 3: 10–15 min (parallel verification subagents) + per-failure re-runs.
- Wave 4: 15–20 min (parallel subagents) + 5 min user review.

**Total: ~3.5–4.5 hours active.**

---

## 10. Out-of-scope follow-ups (track in `todo.md`)

- Apple Sign-In native iOS (Capacitor + `@capacitor-community/apple-sign-in`).
- Custom Supabase auth domain (`auth.playlyricpro.com`) for OAuth consent-screen branding.
- Account deletion / GDPR erasure flow.
- Webhook DB-write deferral to a queue (if cold-start timing is borderline).
- Google Sign-In One Tap (`signInWithIdToken`).
- Supabase `Sb-Forwarded-For` IP forwarding for proper per-IP OAuth rate limiting behind Vercel (D17), or hCaptcha/Turnstile enablement as a mitigation.
- Stripe Tax registration (when nexus thresholds approached).
- HSTS preload list submission (after subdomains audited HTTPS-only).
- External pentest engagement before broad public launch.
