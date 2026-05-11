# Compliance Auditor Lane — Baseline Scan 2026-05-08

## Methodology

**Lane scope:** Stripe-specific compliance (event allowlist, idempotency, refund/dispute, PCI scope, customer dedup, API version), Supabase RLS + service-role isolation, OAuth provider trust (state/PKCE/redirect-URI/Apple-relay/identity-linking), data lifecycle / PII, .env.example currency, Vercel env scoping (informational), Supabase IP-forwarding for OAuth rate-limit, and `pnpm audit` baseline.

**Out of lane (Security Engineer):** route-level auth, input validation, OWASP top-10 (XSS/SQLi/CSRF), security headers/CSP/CORS, rate limits as a category, transport-layer concerns. Where my findings touch their lane (e.g., the OAuth `redirectTo` whitelist), I report only the data-trust angle.

**Severity rubric:** Critical = payment bypass / PII exfil / missing webhook sig verify / RLS off on sensitive table. High = missing OAuth state, broken provider flow, deferred-fix that's a known production blocker. Medium = suboptimal pattern, missing dunning event, no API version pin. Low = stale env vars / non-blocking. Info = posture / out-of-repo verification.

**Secret-handling confirmation:** I did **not** echo any `.env` value, JWT, signing secret, or DB connection string in this report. `.env` was never opened with `Read`/`cat`; I only used targeted `grep` against the application code (which contains references, not values). Findings cite `file:line`; values are never quoted.

---

## Findings Table

| ID | Severity | Title | Location | Status |
|----|----------|-------|----------|--------|
| CA-01 | **Critical** | RLS disabled on **every** table in `public` schema (Supabase project) | `drizzle/meta/*_snapshot.json` (all `isRLSEnabled: false`) | Open |
| CA-02 | High | First-sign-in profile-name capture missing for OAuth `SIGNED_IN` event (Apple name returned only once) | `server/_core/supabase-auth.ts:79-118` (path) — no client `onAuthStateChange` capture handler found | Open (planned Task 8) |
| CA-03 | High | No handler for `invoice.payment_failed` — failed-renewal users keep paid features until `customer.subscription.deleted` fires | `server/_core/stripeWebhook.ts:77-256` (switch — only 4 events handled) | Open |
| CA-04 | High | No handler for `customer.subscription.updated` — plan changes / proration / pause not reflected in DB | `server/_core/stripeWebhook.ts:77-256` | Open |
| CA-05 | Medium | `charge.dispute.created` not handled — disputes don't auto-pause access or alert ops | `server/_core/stripeWebhook.ts:77-256` (no case) | Open |
| CA-06 | Medium | `charge.refunded` for invoice path is logged "for review" only — does not flip subscription state | `server/_core/stripeWebhook.ts:241-250` | Open |
| CA-07 | Medium | Stripe SDK instantiated without `apiVersion` pin (3 sites) — Stripe API drift can break webhooks/checkout silently | `server/stripe-integration.ts:3`, `server/routers/goldenNotes.ts:123` | Open (planned Task 12) |
| CA-08 | Medium | `subscription_status` enum is missing Stripe statuses `past_due`, `unpaid`, `trialing`, `incomplete`, `incomplete_expired` — handler can't write them even if added | `drizzle/schema.ts:81-86` | Open |
| CA-09 | Medium | Checkout sessions pass only `customer_email` (4 sites) — no Stripe-customer dedup; same human re-paying creates a new Stripe Customer each time | `server/stripe-integration.ts:22,56,99`, `server/routers/goldenNotes.ts:143` | Open |
| CA-10 | Medium | Email-collision identity-linking (D8): on conflicting email between providers, `upsertUser` writes ONLY for the FIRST provider; second sign-in returns existing row but never updates `loginMethod`/identity metadata | `server/_core/supabase-auth.ts:94-115` | Open (revisit Task 19) |
| CA-11 | Medium | No `Sb-Forwarded-For` header on server-side Supabase admin calls — all OAuth/admin attempts share one Vercel egress IP for Supabase rate-limit purposes (D17) | `server/app-router.ts:133`, `server/_core/supabase-auth.ts:37` (createClient sites) | Open (deferred per spec §10) |
| CA-12 | Medium | No account-deletion path implemented — GDPR/CCPA "right to delete" not satisfiable without manual ops | `server/routers/*.ts` (no `deleteAccount` router); `server/_core/supabase-auth.ts` (no admin-delete) | Open (deferred per spec §1 non-goals) |
| CA-13 | Medium | Client-side Supabase set to `flowType: "implicit"` (not PKCE) — token in URL fragment, replayable from browser history if not stripped before user navigates away | `client/src/lib/supabase.ts:29` | Open — design tradeoff documented inline; verify `replaceState` strip in `AuthCallback.tsx:88` covers all paths |
| CA-14 | Low | Stale Manus env vars (`VITE_APP_ID`, `VITE_OAUTH_PORTAL_URL`, `OAUTH_SERVER_URL`, `OWNER_OPEN_ID`, `JWT_SECRET`) still referenced in code AND listed in `.env.example` | `server/_core/env.ts:2-6`, `server/_core/sdk.ts:36`, `server/_core/oauth.ts:13`, `client/src/pages/Lobby.tsx:51`, `.env.example:42-48` | Open (planned Task 4) |
| CA-15 | Low | `JWT_SECRET=change-me-to-a-random-32-char-string` placeholder in `.env.example:48` — devs may ship the literal placeholder; once `app-router` deprecates Manus, drop the var entirely | `.env.example:48` | Open (planned Task 4) |
| CA-16 | Low | Idempotency rollback (`stripeWebhook.ts:262-269`) issues a `delete` on failure but doesn't gate it on whether the failure happened **before** any DB writes succeeded — partial-write events can re-process and double-credit Golden Notes / double-record entry-fee participants | `server/_core/stripeWebhook.ts:62-75, 259-275` | Open |
| CA-17 | Info | Vercel env-var scoping (Production / Preview / Development) cannot be verified from repo — must be confirmed in Vercel Dashboard during Wave 2 | n/a (out-of-repo) | Open |
| CA-18 | Info | Supabase Auth (GoTrue) version cannot be determined from repo (`@supabase/supabase-js@2.104.0` is the JS client, not the server Auth version) — must verify ≥ v2.176.1 in Supabase Dashboard for Apple `account.apple.com` issuer support | `package.json:56` | Open (verify Wave 2) |
| CA-19 | Info | `pnpm audit`: **41 high, 38 moderate, 3 low** (82 total). Direct app-runtime impact is limited (most are dev-toolchain `tar`/`rollup`/`minimatch`/`pnpm`/`xlsx`); none in `@supabase/*`, `stripe`, or `express` core paths | repo root | Open — see "pnpm audit summary" below |

---

## Per-Finding Detail

### CA-01 — RLS disabled on every public table
- **Severity:** Critical
- **Location:** `drizzle/meta/0000_snapshot.json` … `0005_snapshot.json` — every table has `"isRLSEnabled": false`. No migration in `drizzle/0000…0007_*.sql` issues `ALTER TABLE … ENABLE ROW LEVEL SECURITY`.
- **Description:** Supabase's default posture relies on RLS-as-defense for any table that's reachable via `anon` or `authenticated` API keys. Today the server uses the service-role key (`SUPABASE_SECRET_KEY`) for all DB access, so RLS-off is "fine" only as long as nobody ever queries Postgres directly via `VITE_SUPABASE_PUBLISHABLE_KEY`. The publishable key IS shipped to the browser (`client/src/lib/supabase.ts:9`) and supabase-js exposes a PostgREST query builder by default. If any future code path uses the browser supabase client to read/write tables (and not just `auth`), every row of every table is publicly readable/writable. This is the single largest latent-risk item in the codebase.
- **Suggested fix:** Either (a) add an explicit migration that enables RLS on every table and writes deny-by-default policies (preferred — defense in depth), or (b) lock the project's PostgREST exposure off in the Supabase Dashboard so the publishable key cannot reach tables. Track in a new Wave-2 task.
- **Evidence:** `drizzle/meta/0005_snapshot.json` — every table object has `"isRLSEnabled": false`. No `ENABLE ROW LEVEL SECURITY` string anywhere in `drizzle/`.

### CA-02 — First-sign-in name capture missing
- **Severity:** High
- **Location:** `server/_core/supabase-auth.ts:79-118`. Client-side: no `supabase.auth.onAuthStateChange("SIGNED_IN", …)` handler captures `user_metadata` on the first event.
- **Description:** Apple Sign-In returns `user.user_metadata.full_name` ONLY on the very first authorization. On subsequent sign-ins it's null. `authenticateRequest` does upsert from `authUser.user_metadata.full_name` on first call (line 102), so it works **if** the very first request after the OAuth redirect carries a token whose `user_metadata` is still populated. But if the client resumes a session from localStorage on a later page load before any server call, the JWT's metadata may already have been rotated by Supabase — then we lose the name forever. Also, neither `firstName` nor `lastName` is parsed out of `full_name`.
- **Suggested fix:** In Task 8, add a client-side `onAuthStateChange` listener that, on first `SIGNED_IN` after OAuth (detect via `app_metadata.provider === 'apple'` AND no `public.users` row OR no `firstName`), POSTs the `user_metadata.name`/`full_name` to a `users.captureProfile` tRPC mutation that splits it and writes to `public.users`.
- **Evidence:** `server/_core/supabase-auth.ts:102-105` only reads `user_metadata.full_name` and joins `firstName`+`lastName`. Grep confirms no client handler.

### CA-03 — `invoice.payment_failed` unhandled
- **Severity:** High
- **Location:** `server/_core/stripeWebhook.ts:77` switch. The `default` branch (line 254) just logs and returns 200 — Stripe will not retry.
- **Description:** When a renewal charge fails (insufficient funds, expired card), Stripe fires `invoice.payment_failed`, then enters its dunning process. Without this event in our switch, the user keeps paid-tier access until Stripe finally cancels the subscription (3+ retries, ~3 weeks later) and `customer.subscription.deleted` fires. That's a 3-week paid-features-without-payment leak per failure.
- **Suggested fix:** Add a case that flips `subscriptions.status = 'past_due'` and surfaces a banner in-app. Once CA-08 lands (enum widened), this is a 10-line patch.

### CA-04 — `customer.subscription.updated` unhandled
- **Severity:** High
- **Location:** Same switch. No case for `customer.subscription.updated`.
- **Description:** Plan upgrades/downgrades, pauses, prorations, and trial-end transitions all fire this event. Today our DB only learns about subscription state via `checkout.session.completed` (initial purchase), `invoice.paid` (renewal), and `customer.subscription.deleted` (cancel). A user upgrading from Player to Pro mid-cycle via Stripe Customer Portal would not get reflected in `subscriptions.tier`.
- **Suggested fix:** Add a case that maps Stripe `subscription.status` and `subscription.items[0].price.id` back to our tier enum. Required before enabling the Customer Portal.

### CA-05 — `charge.dispute.created` unhandled
- **Severity:** Medium
- **Description:** A chargeback is the strongest fraud signal we get. Today nothing happens — user keeps access until they ALSO trigger a refund. Add an alert and an automatic `subscriptions.status = 'paused'` flip.

### CA-06 — Refunded invoices logged but not reverted
- **Severity:** Medium
- **Location:** `server/_core/stripeWebhook.ts:241-250` ("flagging for review" comment).
- **Description:** Comment acknowledges this is partial. Subscription-refund path needs to actually `UPDATE subscriptions SET tier='free', status='canceled' WHERE stripeSubscriptionId = (SELECT subscription FROM invoice WHERE id = charge.invoice)`. Currently only entry-fee refunds (line 227-237) revert state.

### CA-07 — Stripe SDK API version not pinned
- **Severity:** Medium
- **Location:** `server/stripe-integration.ts:3` (`new Stripe(process.env.STRIPE_SECRET_KEY || "")` — no second arg). Same omission at `server/routers/goldenNotes.ts:123` (`new Stripe(key)`).
- **Description:** Without `apiVersion` set, the SDK uses the Stripe account's "default API version" from the Dashboard. That changes when Stripe rotates default versions, and shape changes (e.g., the `invoice.subscription` field — already typed as `any` at `stripe-integration.ts:179-181`) can break webhook handlers silently.
- **Suggested fix:** Pin `{ apiVersion: '2024-11-20.acacia' }` (or whichever version we test against) at all three sites.

### CA-08 — `subscriptionStatusEnum` too narrow
- **Severity:** Medium
- **Location:** `drizzle/schema.ts:81-86` — only `["active", "paused", "canceled", "expired"]`.
- **Description:** Stripe emits `past_due`, `unpaid`, `trialing`, `incomplete`, `incomplete_expired`. We can't store them. Combined with CA-03, blocks proper dunning UX.
- **Suggested fix:** New migration that ALTERs the enum. Postgres enum-add is non-destructive: `ALTER TYPE subscription_status ADD VALUE 'past_due';` etc. Order: add values, then update CA-03/CA-04 handlers.

### CA-09 — No Stripe-customer dedup
- **Severity:** Medium
- **Location:** `server/stripe-integration.ts:22, 56, 99`, `server/routers/goldenNotes.ts:143` — all four Checkout creators pass only `customer_email`.
- **Description:** Stripe creates a NEW `cus_xxx` for every Checkout when `customer:` is omitted. Same human paying twice → two Stripe Customer records → confused reporting, broken Customer Portal sessions, billing-history fragmentation, harder fraud review. Doesn't cause a security breach but causes ops/finance pain at scale.
- **Suggested fix:** Add a `stripeCustomerId` column to `users` (or a `user_payment_profiles` table). On first Checkout, create the customer up-front via `stripe.customers.create({email})`, store the id, pass `customer:` thereafter.

### CA-10 — Email-collision identity-linking trace
- **Severity:** Medium
- **Location:** `server/_core/supabase-auth.ts:94-115`.
- **Description:** See dedicated section below.

### CA-11 — Supabase admin calls don't forward client IP
- **Severity:** Medium
- **Location:** `server/app-router.ts:133` (sendMagicLink admin client), `server/_core/supabase-auth.ts:37` (auth admin client). Neither sets the `Sb-Forwarded-For` header.
- **Description:** Supabase's per-IP rate limits for `generateLink`, `signInWithPassword`, etc. see only the Vercel egress IP, not the real user. One bad actor could exhaust the OTP/magic-link quota for everyone. `api-src/trpc/[trpc].ts:60` already extracts `x-forwarded-for` for our own rate-limiter — pass that same value to the Supabase admin client init via a custom `fetch` that injects `Sb-Forwarded-For`.

### CA-12 — No account deletion
- **Severity:** Medium
- **Description:** GDPR Art. 17 / CCPA right-to-delete. Currently must be done by ops via the Supabase Dashboard + a manual `DELETE FROM users` cascade. Spec §1 lists this as non-goal but it does need to be a known follow-up.

### CA-13 — Implicit OAuth flow on web client
- **Severity:** Medium
- **Location:** `client/src/lib/supabase.ts:29` — `flowType: "implicit"`.
- **Description:** Inline comment justifies this for cross-browser magic-link survival, which is reasonable. The risk is that the access_token lives in the URL fragment briefly. `AuthCallback.tsx:88` does `window.history.replaceState(null, "", "/")` after exchange, which strips it — good. But if the user opens devtools / clicks any extension before the click handler runs, the fragment is visible. Also: implicit flow is deprecated by the OAuth WG. Long-term migrate to PKCE with a server-side callback that owns the verifier (the bug it works around — verifier-not-found across browsers — is fixable by storing the verifier server-side keyed by `state`).
- **Suggested fix:** Defer; document as a known-tradeoff in security posture.

### CA-14 / CA-15 — Stale Manus vars
- **Severity:** Low
- **Description:** Already on roadmap (Task 4). Notable: `server/_core/oauth.ts:13` registers a route `/api/oauth/callback` that's still reachable in production and uses `JWT_SECRET` to mint cookies. Until Task 4 lands, this is a parallel auth path the Security Engineer should also flag from the route-auth angle (mentioning here only because the env-var sprawl is the data-trust signal).

### CA-16 — Idempotency rollback race
- **Severity:** Medium
- **Location:** `server/_core/stripeWebhook.ts:62-75` (insert-then-process), `259-275` (catch deletes the marker).
- **Description:** If `handleCheckoutSessionCompleted` (line 80) succeeds AND the Golden-Notes transaction (line 128-162) succeeds but THEN `db.transaction` post-commit cleanup throws — or any later code throws between a successful side-effect and `res.json` — the catch deletes the idempotency marker. Stripe retries, we re-process, user gets double Golden Notes. The current pattern is "all-or-nothing rollback" but our handlers are not all-or-nothing: each event-type writes to a different table and the writes aren't all wrapped in a single tx.
- **Suggested fix:** Either wrap each event-type's handler in an outer `db.transaction` that includes the `processedWebhookEvents` insert (so DB-level rollback un-marks atomically), or change the rollback policy to "leave marked" and surface the error for manual replay. The latter is safer at scale.

### CA-17 / CA-18 — Out-of-repo verifications
- Vercel env scoping: confirm in Wave 3 (Agent S) that `STRIPE_SECRET_KEY`, `SUPABASE_SECRET_KEY`, `RESEND_API_KEY`, `JWT_SECRET` are scoped to Production only (not Preview/Development) and that test-mode keys are scoped to Preview.
- Supabase Auth version: in Wave 2, navigate to Supabase Dashboard → Project Settings → Infrastructure → "Postgres + Auth versions". Need GoTrue ≥ v2.176.1 for Apple `account.apple.com` issuer.

---

## Email-collision behavior trace (CA-10)

**Scenario:** User signs up with `alice@example.com` + password (Supabase creates `auth.users` row #1, identity provider="email"). Later, same Alice clicks "Continue with Google" using the same `alice@example.com`.

**Supabase side** (depends on project setting "Allow linking same-email identities", default ON in projects created post-2024): Supabase creates a NEW identity row inside the EXISTING `auth.users.id` — so `auth.users.id` is unchanged, but `auth.users.app_metadata.provider` flips from "email" to "google" (last-used wins) and `auth.users.identities[]` gains a second row.

**Our `authenticateRequest` path** (`supabase-auth.ts:79-118`):

1. Line 88: `client.auth.getUser(token)` returns the same `authUser.id` (UUID) as the first sign-in.
2. Line 94: `getUserByOpenId(authUser.id)` finds the existing `public.users` row (because we keyed `openId` on `auth.users.id` UUID, not on email). **Good — no duplicate row.**
3. Line 95: `if (!appUser)` — branch is **skipped** because `appUser` is non-null. So `upsertUser` is **NOT** called on subsequent provider sign-ins.
4. We return the existing row with the original `loginMethod` (e.g., "email"), even though the user just signed in with Google. `name`, `firstName`, `lastName` are likewise frozen at first-sign-in values.

**Verdict:** Identity-linking does NOT break our flow (no orphaned row, no duplicate row), so this is **Medium**, not High. But two follow-on issues:

- **`loginMethod` is permanently stale** after the first link. Analytics that ask "which provider does this user sign in with?" will be wrong. Telemetry/funnel correctness, not security.
- **If the user signed up with email/password and the Google account was hijacked**, the attacker could complete an account takeover. Mitigation lives in Supabase: set Auth → Sign-In/Up → "Manual Linking" so users must opt-in to link a new provider. Verify in Wave 2.

**Fix in Task 19:** When `getUserByOpenId` returns an existing row but `app_metadata.provider !== existing.loginMethod`, call `upsertUser` to refresh `loginMethod`, `name` (if previously null), `firstName`/`lastName` (if previously null). Don't overwrite non-null name fields — those may have been edited by the user.

---

## pnpm audit summary

Total: **82 vulnerabilities** — 41 high, 38 moderate, 3 low. None directly in app-runtime payment/auth dependency chains.

**High-severity by package (top hits):**
- `xlsx@0.18.5` (Prototype Pollution GHSA-4r6h-8v6p-xvw6 + ReDoS GHSA-5pgg-2g8v-p4x9) — used only in `scripts/expand-library.*` lyric-library tooling, not in production runtime. **Action:** upgrade to `xlsx@>=0.20.2` or pin to `https://cdn.sheetjs.com/xlsx-0.20.3/xlsx-0.20.3.tgz` (SheetJS removed npm publishing; the npm version is permanently abandoned).
- `pnpm@10.18.0` itself (lifecycle-script bypass GHSA-379q-355j-w6rj + lockfile-integrity GHSA-7vhp-vf5g-r2fw) — bump to `>=10.26.0`.
- `tar` (multiple paths via `@capacitor/cli`, `@tailwindcss/oxide`, `@vercel/nft`) — transitive; fixes by upgrading `@vercel/node`, `@tailwindcss/vite`, `@capacitor/assets` to their latest. Risk profile: build-time arbitrary-file-write — only matters if we extract attacker-controlled tarballs, which we don't.
- `rollup@4.52.4` (path traversal GHSA-mw96-cpmx-2vgc) — bump to `>=4.59.0` via vite/tailwindcss upgrade.
- `minimatch` (multiple ReDoS) — transitive; bumps follow vercel/capacitor upgrades.

**Recommendation:** Schedule a `pnpm up --latest` for dev-toolchain packages (`vercel`, `@vercel/node`, `vite`, `@tailwindcss/vite`, `@capacitor/*`, `@trapezedev/*`, `pnpm` self) in a follow-up. None of these block the OAuth/Stripe productionization work. Re-run `pnpm audit` after the upgrade — expect to drop ~30 of the 41 highs.

---

## Coverage Gaps

- **Vercel env-var scoping** — cannot verify from repo. Wave 3 dashboard check.
- **Supabase Auth (GoTrue) version** — cannot verify from repo. Wave 2 dashboard check (need ≥ v2.176.1 for Apple issuer).
- **Supabase project Auth settings** — "Manual Linking" toggle, redirect-URL allowlist, OTP length, email rate limits — all dashboard-only.
- **iOS Capacitor wrapper** — `capacitor.config.ts` exists but native deep-link verification is out of scope for this baseline (separate audit when iOS sign-in lands).
- **Production logs** — re-confirm with Security Engineer that no PII flows to Vercel function logs in production. I confirmed the webhook handler redacts via `redact()` (`stripeWebhook.ts:22-27`) and email senders log structured fields only; live log inspection is Wave 3.
