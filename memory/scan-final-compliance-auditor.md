# Compliance Auditor Lane — Final Delta Scan 2026-05-11

## Methodology

Re-walked all 19 Wave-0 findings (CA-01…CA-19) against HEAD `1d038dd` on `feat/2026-05-08-oauth-stripe-go-live`. Verified each via direct file read of the touched module plus, for runtime-observable items, a live probe (Supabase REST anon, Supabase Auth `/health`, `pnpm audit`). Then ran a fresh-eyes pass for issues introduced by Waves 1–3.

No `.env` value, JWT, Stripe key, or webhook secret was echoed in this report — all citations are `file:line` only.

## Live probe results

- **Supabase REST anon probe** (Wave 0 CA-01 re-verification, anon `apikey` only): all five sampled tables returned `HTTP 200 BODY=[]` (BODY_SIZE=2) for `users`, `subscriptions`, `songs`; `goldenNoteBalances` and `entryFeeParticipants` returned `HTTP 404` (PostgREST does not expose the camelCase names — they are not in `api.exposed_schemas`). No data leakage. CA-01 stays at posture-only Medium.
- **Supabase Auth `/auth/v1/health`** — `{"version":"v2.189.0","name":"GoTrue"}` — comfortably above the v2.176.1 floor needed for the Apple `account.apple.com` issuer change. CA-18 satisfied.
- **`pnpm audit --audit-level=moderate`** — 84 total (42 high / 39 moderate / 3 low), up 2 from Wave 0's 82. Same dev-toolchain cluster (`xlsx`, `pnpm`, `tar`, `rollup`, `minimatch`, `fast-xml-parser`). No new runtime path. CA-19 unchanged.

## Baseline Diff (19 findings)

| ID | Severity | Title | Status | Evidence |
|----|----------|-------|--------|----------|
| CA-01 | Critical → Medium-posture | RLS disabled on every public table | STILL OPEN (posture) | REST anon probe returns `[]` (no leak); `drizzle/meta/0006_snapshot.json` still `isRLSEnabled:false`. Tracked `todo.md:279-281`. |
| CA-02 | High | First-sign-in name capture for Apple `SIGNED_IN` | FIXED | Commit `ef1657f`. `client/src/_core/hooks/useAuth.ts:32-44` calls `handleFirstSignInProfile` on `SIGNED_IN` events. |
| CA-03 | High | `invoice.payment_failed` unhandled | FIXED | Commit `c2cdeb0`. `server/_core/stripeWebhook.ts:196-212` flips status to `past_due` via Drizzle ORM. |
| CA-04 | High | `customer.subscription.updated` unhandled | FIXED | Commit `72f12f3`. `server/_core/stripeWebhook.ts:214-229` writes tier + widened status via `updateSubscription`. |
| CA-05 | Medium | `charge.dispute.created` unhandled | STILL OPEN | No `dispute` case in `server/_core/stripeWebhook.ts` (6 cases total). Tracked `todo.md:326`. |
| CA-06 | Medium | Refunded invoices logged but not reverted | FIXED | Commit `6bb31cb`. `server/_core/stripeWebhook.ts:280-308` resolves invoice→subscription and flips to canceled/free on full refund. |
| CA-07 | Medium | Stripe SDK `apiVersion` not pinned | FIXED | Commit `7cbb10f`. `server/stripe-integration.ts:4` + `server/routers/goldenNotes.ts:119` both pin `2026-03-25.dahlia`. |
| CA-08 | Medium | `subscription_status` enum too narrow | FIXED | Commit `6a4fdef`. `drizzle/0006_puzzling_turbo.sql` contains exactly the five `ALTER TYPE … ADD VALUE` statements (past_due, unpaid, trialing, incomplete, incomplete_expired). Clean of Phase-5b drift per inline comment. |
| CA-09 | Medium | No Stripe-customer dedup | FIXED | Commit `a41eed5`. `resolveStripeCustomer(email)` called at all four sites: `server/stripe-integration.ts:46,81,125` + `server/routers/goldenNotes.ts:136`. |
| CA-10 | Medium | Email-collision identity-link refresh | FIXED | Commit `3712238`. `server/_core/supabase-auth.ts:116-125` — when existing user signs in via different provider, `loginMethod` is refreshed via `upsertUser`. |
| CA-11 | Medium | `Sb-Forwarded-For` on Supabase admin calls | STILL OPEN | App-side rate-limiter does use `x-vercel-forwarded-for` (commit `9e61a57`, `api-src/trpc/[trpc].ts:64`) and Express trusts proxy (`d571e82`) — but neither admin client at `server/_core/supabase-auth.ts:37` nor `server/app-router.ts:133` sets `Sb-Forwarded-For`. Tracked `todo.md:327`. |
| CA-12 | Medium | No account-deletion path | STILL OPEN | No `deleteAccount` router exists. Tracked `todo.md:328` as dedicated-initiative follow-up. |
| CA-13 | Medium | Implicit OAuth flow on web client | FIXED | Commit `4f88ab9`. `client/src/lib/supabase.ts:33` — `flowType: "pkce"`. |
| CA-14 | Low | Stale Manus env vars referenced | FIXED | Commits `54cecac` (env vars), `5580478` (callback), `6e98d64` (SDK), `a17a168` (vite plugin), `0df39ba` (auto-admin), `bee0689` (docstrings). `.env.example` re-read end-to-end — zero Manus references remain. |
| CA-15 | Low | `JWT_SECRET=change-me…` placeholder in `.env.example` | FIXED | Re-read of `.env.example` (lines 1-126): `JWT_SECRET` is gone entirely; the only remaining auth bootstrap env is `DEV_AUTH_BYPASS`. |
| CA-16 | Medium | Idempotency rollback race | STILL OPEN | `server/_core/stripeWebhook.ts:62-75` insert-then-process pattern unchanged. Tracked `todo.md:325` as architectural follow-up. |
| CA-17 | Info | Vercel env-var scoping | NEEDS DASHBOARD CHECK | Cannot verify from repo; the runbook `docs/oauth-and-stripe-go-live-2026-05-08.md` instructs the operator to set scoping during Wave 2 go-live. |
| CA-18 | Info | Supabase Auth (GoTrue) version | FIXED (verified) | Live `/auth/v1/health` returns `v2.189.0` ≥ v2.176.1. |
| CA-19 | Info | `pnpm audit` baseline | UNCHANGED | 84 total (42H/39M/3L). +2 since Wave 0; still dev-toolchain only (xlsx, pnpm-self, tar, rollup, minimatch, fast-xml-parser). No `@supabase/*`, `stripe`, `express` hits. |

**Summary:** 11 FIXED, 6 STILL OPEN (all tracked in `todo.md` lines 279-328), 2 dashboard-verified (CA-17 pending operator action, CA-18 confirmed).

## New Findings

| ID | Severity | Title | Location | Status |
|----|----------|-------|----------|--------|
| CA-D01 | Low | Apex webhook URL still cited in 3 docs after Wave 2 redirect-to-www flip | `docs/oauth-and-stripe-go-live-2026-05-08.md:300`, `docs/superpowers/plans/2026-05-08-oauth-stripe-security-plan.md:1680`, `docs/superpowers/specs/2026-05-08-oauth-stripe-security-design.md:239` | NEW — docs only |
| CA-D02 | Info | Apple `client_secret` JWT 6-month rotation reminder | `docs/oauth-and-stripe-go-live-2026-05-08.md:211, 264` | TRACKED |

### CA-D01 — Apex webhook URL leftover

Production now 301-redirects `playlyricpro.com` → `www.playlyricpro.com`. Three doc locations still reference the bare-apex form `https://playlyricpro.com/api/stripe/webhook`. Stripe webhook deliveries do **not** follow 301s — they treat 3xx as a failed delivery and retry. If the operator follows the runbook literally and pastes the apex URL into the Stripe Dashboard, every webhook will fail. The user confirmed in the brief that the live Stripe Dashboard entry has been corrected to `www.playlyricpro.com`, so production is safe, but the docs are now misleading for any future re-deploy or DR rebuild.

**Fix:** s/playlyricpro\.com\/api\/stripe\/webhook/www.playlyricpro.com\/api\/stripe\/webhook/g in those three files.

### CA-D02 — Apple JWT 6-month rotation tracked

`docs/oauth-and-stripe-go-live-2026-05-08.md:211` ("Set a calendar reminder for 5 months from today") and `:264` (~2026-10-08 follow-up) capture the rotation. Not a finding — verifying it is **tracked** as the user requested.

## Definition of Done check

- **All Wave-0 Critical/High findings either fixed or downgraded with evidence:** YES. CA-01 downgraded via live probe (no leak from anon REST); CA-02 fixed; CA-03 fixed; CA-04 fixed.
- **All Wave-0 Medium findings either fixed or in `todo.md`:** YES. CA-05, CA-11, CA-12, CA-16 tracked at `todo.md:325-328`. CA-06/07/08/09/10/13 fixed.
- **No new Critical/High introduced by Wave 1–3:** Correct. The only new findings are CA-D01 (Low doc-drift) and CA-D02 (info/tracked).
- **Manus removal complete:** YES. `.env.example`, `server/_core/`, `client/src/pages/Lobby.tsx`, and SDK paths are clean.
- **Secret-handling rule observed in this report:** YES — no values echoed.

## Coverage Gaps

- **Vercel env-var scoping (CA-17)** — still out-of-repo; runbook §C.1 directs the operator to confirm during go-live. Cannot be auto-verified.
- **Supabase Dashboard auth settings** — "Manual Linking" toggle, redirect-URI allowlist, OTP length, rate-limit caps — verifiable only via dashboard. The mitigation for CA-10 (manual linking) relies on this being set; flag for operator confirmation.
- **iOS Capacitor deep-link** — out of scope for this branch.
- **CA-11 mitigation alternative** — if `Sb-Forwarded-For` isn't pursued, enable Supabase hCaptcha/Turnstile per `todo.md:327`. Either path is acceptable.
- **CA-16 architectural rewrite** — the current "rollback marker on any error" policy can still double-credit Golden Notes if a side-effect commits before the post-processing throws. The fix needs a wrapping `db.transaction` or a "leave-marked, surface-for-replay" policy switch. Not safe to mechanically patch in this wave.
