# Security Engineer Lane — Final Delta Scan 2026-05-11

**Branch:** `feat/2026-05-08-oauth-stripe-go-live` @ `1d038dd` (HEAD)
**Baseline:** `memory/scan-baseline-security-engineer.md` (SE-01..SE-16 @ `16e07f1`)
**Scope:** application + transport surface (same as baseline). Diff-only, read-only.

## Methodology

Diffed each baseline finding against current HEAD by re-reading:
- `server/_core/{index.ts, stripeWebhook.ts, env.ts, llm.ts, supabase-auth.ts, sendMagicLinkEmail.ts, sendPasswordResetEmail.ts}`
- `server/{stripe-integration.ts, app-router.ts}`
- `server/routers/{game.ts, insights.ts, monetization.ts, goldenNotes.ts}`
- `api-src/trpc/[trpc].ts`, `vercel.json`
- `scripts/generate-apple-client-secret.mjs`
- `client/src/pages/SignIn.tsx`, `client/src/lib/supabase.ts`

**Secret-handling confirmation:** No `.env` value, Stripe key, webhook secret, JWT, Supabase service-role key, or Apple `.p8` content was read or echoed. Findings cite `file:line` only. Targeted secret-pattern grep across `server/ client/ shared/ api-src/ scripts/ docs/ memory/` returned ZERO matches (the only hit was the literal placeholder string `"whsec_placeholder"` in `server/_core/stripeWebhook.ts:41`, which is a sentinel comparison value — not a live secret). `find . -name "*.p8"` returned ZERO matches — Apple key is not in the repo.

**Severity rubric:** unchanged from Wave 0.

## Baseline Diff (16 findings)

| ID | Severity | Title | Status | Evidence |
|----|----------|-------|--------|----------|
| SE-01 | High | Open redirect in Stripe checkout via attacker-controlled Origin | **FIXED** | `a9f569e` — `server/routers/monetization.ts:36-43` adds `safeOrigin()` allowlist gate; `:130-133` mirrors pattern in `goldenNotes.ts`. |
| SE-02 | High | TOCTOU double-spend in `insights.playWeaknessPack` | **FIXED** | `2b7843f` — `server/routers/insights.ts:320-356` wraps debit in `db.transaction` with atomic `UPDATE … WHERE gte(balance, cost)` + `updated.length === 0` race-loss branch. |
| SE-03 | High | Untrusted `x-forwarded-for` as rate-limit identity in Vercel handler | **FIXED** | `9e61a57` — `api-src/trpc/[trpc].ts:60-66` reads `x-vercel-forwarded-for` first (Vercel-set, stripped from client input), falls back to `x-forwarded-for` only when absent. |
| SE-04 | Medium | Helmet COOP `same-origin` breaks OAuth popups | **FIXED** | `server/_core/index.ts:100` — `crossOriginOpenerPolicy: { policy: "same-origin-allow-popups" }`. |
| SE-05 | Medium | Helmet default CSP would block Supabase + Stripe Checkout | **FIXED** | `server/_core/index.ts:65-92` — explicit `connect-src`, `script-src`, `frame-src`, `img-src` allowlist (Supabase host derived from `VITE_SUPABASE_PROJECT_URL`, Stripe JS/Checkout/hooks). Currently `reportOnly: true` — intentional first-deploy mode, see SE-D03. |
| SE-06 | Medium | `forge.manus.im` fallback URL — out-of-trust-boundary LLM endpoint | **FIXED** | `server/_core/llm.ts:215` — `throw new Error("BUILT_IN_FORGE_API_URL not configured")` replaces the silent vendor fallback. Fails closed. |
| SE-07 | Medium | State-mutating game procedures lacked ownership checks | **PARTIAL** | `1e0a5a9` — host-only checks added to `startGame` (`game.ts:411-416`), `createTeams` (`:1421-1426`), `nextRound` membership-check (`:1252-1263`). **Still public, no membership check:** `submitAnswer` (`:888`), `getNextSong` (`:423`), `assignTeam` (`:1384`), `setReady` (`:383`). See SE-D04. |
| SE-08 | Medium | Missing `trust proxy` | **FIXED** | `d571e82` — `server/_core/index.ts:49` — `app.set("trust proxy", 1)` with comment explaining single-hop Vercel topology. |
| SE-09 | Medium | Stripe webhook 308-redirect risk | **VERIFIED** | `vercel.json:24-28` rewrites now exclude `/api/`, `/privacy$`, `/termsofservice$` from SPA fallback — `/api/stripe/webhook` lands directly on the function. Live curl from prod still recommended (no Stripe MCP available in this env to enumerate webhook endpoints). |
| SE-10 | Medium | `insights` procedures used `publicProcedure` defense-in-depth | **FIXED** | `1843d7e` — `insights.ts:155, 292` switched to `protectedProcedure`; manual null-check removed. |
| SE-11 | Medium | Stale legacy OAuth callback (`server/_core/oauth.ts`) | **FIXED** | `0df39ba` family — `server/_core/oauth.ts` no longer exists. `grep -rn registerOAuthRoutes\|exchangeCodeForToken server/ api-src/` returns zero. |
| SE-12 | Low | `STRIPE_TEST2_KEY_STRIPE_SECRET_KEY` admin escape hatch | **FIXED** | `d5efecc` — `server/routers/goldenNotes.ts:112-119` reads only `STRIPE_SECRET_KEY`; the admin test-mode branch + malformed env name are gone. |
| SE-13 | Low | Magic-link recipient email logged in plaintext | **PARTIAL** | `1d7d9df` — `sendMagicLinkEmail.ts:75` redacts via `redactEmail()`. **Still plaintext:** `sendPasswordResetEmail.ts:43` logs full `params.to`. (Same domain-leak pattern.) See SE-D05. |
| SE-14 | Low | `JWT_SECRET` env var read but unused | **FIXED** | `server/_core/env.ts` (entire file, 6 lines) — `cookieSecret` field removed. Only `databaseUrl`, `isProduction`, `forgeApiUrl`, `forgeApiKey` remain. |
| SE-15 | Info | Process-local rate-limit buckets | **NOTED (unchanged)** | `server/_core/rateLimit.ts` still in-process. Acceptable until DAU scales; logged for Redis migration. |
| SE-16 | Info | DEV bypass + dev magic-link correctly NODE_ENV-gated | **NOTED (good)** | `context.ts:50-56` still guards `DEV_AUTH_BYPASS` behind `NODE_ENV !== "production"`. |

**Baseline outcome:** 12 FIXED (incl. all 3 Highs + all baseline Mediums in scope of Wave 1) · 2 PARTIAL (SE-07, SE-13) · 2 NOTED.

## New Findings (post-Wave-1 introductions)

| ID | Severity | Title | Location | Status |
|----|----------|-------|----------|--------|
| SE-D01 | Medium | Stripe `customers.search` query interpolates email — escaping is single-quote only | `server/stripe-integration.ts:19-22` | **Open** |
| SE-D02 | Low | `resolveStripeCustomer` swallows ALL search errors silently; rate-limit bypass on Stripe outage causes ghost customers | `server/stripe-integration.ts:26-29` | **Open (accepted risk)** |
| SE-D03 | Info | CSP is `reportOnly: true` on first deploy — intentional, but no report endpoint is configured | `server/_core/index.ts:90` | **Noted** |
| SE-D04 | Medium | Carry-over from SE-07: `submitAnswer` / `getNextSong` / `assignTeam` / `setReady` still mutate room state on `roomCode` + optional `guestToken` only | `server/routers/game.ts:383, 423, 888, 1384` | **Open (deferred to todo.md)** |
| SE-D05 | Low | Carry-over from SE-13: `sendPasswordResetEmail.ts:43` and `sendFeedbackEmail.ts` (if present) still log plaintext recipient email | `server/_core/sendPasswordResetEmail.ts:43` | **Open** |
| SE-D06 | Info | Apple `client_secret` generator script is correctly stdout-only — no file write, no remote call, missing-env exits 1 before reading `.p8` | `scripts/generate-apple-client-secret.mjs:78-79` | **Verified clean** |
| SE-D07 | Info | Webhook handler new branches (`invoice.payment_failed`, `customer.subscription.updated`) use Drizzle parameterized `update().where(eq(...))` — no injection; idempotency-row insert/rollback unchanged from baseline | `server/_core/stripeWebhook.ts:196-229` | **Verified clean** |
| SE-D08 | Info | `customer.subscription.updated` returns five non-validated string fields (`status`, `tier`) cast through TS-only assertions to enum union — a future Stripe API change could store an unexpected string. Defense-in-depth: validate at the seam. | `server/_core/stripeWebhook.ts:222-225` | **Noted** |

### Per-finding detail for new items

**SE-D01 — Stripe `customers.search` Lucene-style injection via email**
`stripe.customers.search({ query: `email:'${email.replace(/'/g, "\\'")}'` })` only escapes single quotes. Stripe's search syntax also supports operators (`AND`, `OR`, `-`, `:`) and backslashes. An email like `victim@x.com' OR email:'attacker@y.com` would be partially neutralized by the single-quote escape but a payload using whitespace and operators (no quotes needed) could match other customers and return their `cus_*` — letting an attacker tie a checkout session to a different user's saved card on file. The blast radius is small because (a) `customer_email` argument is also passed and Stripe ties the session to the customer not the email, (b) saved cards prompt for re-confirmation in Checkout; but defense-in-depth says use `stripe.customers.list({ email })` instead (exact-match, no search-syntax parsing). **Fix:** swap `customers.search(query)` → `customers.list({ email, limit: 1 })`.

**SE-D02 — Silent search-error swallow**
The `try { … } catch {}` at `stripe-integration.ts:26-28` falls back to `customer_email` on any error, including invalid input or Stripe API outages. Acceptable trade-off (don't block checkout on Stripe search 5xx), but creates a stealth de-dup bypass: an attacker who can degrade Stripe Search latency could mint duplicate customers. Recommend `console.warn` on catch + a counter so ops see the fallback rate.

**SE-D03 — CSP report-only with no report-uri**
`reportOnly: true` is correct for first-deploy validation, but without `report-uri` / `report-to` directives, violations are visible only in each visitor's browser console. Operators have no signal that a CSP rule is too tight. **Fix before switching to enforcing:** add a Vercel function or third-party (e.g., Sentry) report endpoint and a 7-day reportOnly bake.

**SE-D04 — Game procedures still open to room-code-only callers**
The Wave 1 fix correctly hardened the destructive host-only ops (`startGame`, `createTeams`) and the round-advance (`nextRound`). But four state-mutating procedures still trust `roomCode` plus an optional `guestToken` that the server never validates against `roomPlayers`:
- `submitAnswer:888` — anyone with a room code can inject answers under any guest's token they sniff (e.g., via screen-share) and influence scores.
- `getNextSong:423` — anyone with a room code can mutate `usedSongIds` / `currentSongId`, exhausting the song pool (DoS) or skipping past songs the host wanted to play.
- `assignTeam:1384` / `setReady:383` — limited blast radius (changes own team / ready state).

These remained out of Wave 1 scope per `todo.md` deferral. Recommend a follow-up pass that adds the `roomPlayers` membership check (`exists(roomPlayers where roomId=room.id and (userId=ctx.user.id or guestToken=input.guestToken))`) to all four.

**SE-D05 — Password-reset and feedback emails still PII-leak in logs**
`sendPasswordResetEmail.ts:43` was not updated alongside the magic-link redaction commit. Recommend extracting the `redactEmail` helper from `sendMagicLinkEmail.ts:19` to a shared util and applying to both sites.

## Definition of Done check

- **Zero open Critical:** PASS — no Critical findings in baseline or delta.
- **Zero open High:** PASS — SE-01 / SE-02 / SE-03 all FIXED with code evidence.
- **Open Medium:** 3 — SE-D01 (Stripe search escape), SE-D03 (CSP report-only without reporter), SE-D04 (4 game procs deferred). All have documented owners in `todo.md` per `64a3209`.
- **Open Low:** 1 — SE-D05 (password-reset email redaction follow-up).
- **No secrets committed:** PASS — secret-pattern grep returned zero; no `.p8` in tree.
- **Apple client-secret generator audited:** PASS — script writes JWT to stdout only, missing-env-vars exits cleanly before file read, validates `.p8` shape, never logs the key.
- **Webhook new branches audited:** PASS — `invoice.payment_failed` and `customer.subscription.updated` use Drizzle parameterized writes; idempotency-row delete-on-failure preserved.
- **CSP allowlist audited:** PASS — only `'self'`, Supabase project host (env-derived), `api.stripe.com`, `js.stripe.com`, `hooks.stripe.com`, `checkout.stripe.com`, `*.stripe.com` (img), `data:` (img). Zero `unsafe-inline`, zero wildcards, zero unexpected hosts.

## Coverage Gaps

- **Stripe live state:** No Stripe MCP available in this sandbox. Cannot remotely verify (a) active webhook endpoint URL matches `https://www.playlyricpro.com/api/stripe/webhook`, (b) recent delivery success rate, (c) signing-secret rotation timestamp. Recommend a one-line manual check in the runbook before flipping `reportOnly: false`.
- **iOS Capacitor wrapper:** Out of lane (Capacitor Auditor lane).
- **Drizzle SQL injection sweep:** Spot-checked only; full SAST run (Semgrep `p/sqlinjection`) deferred.
- **Dependency CVEs:** No `npm audit` / Trivy run in this lane.
- **Client-side XSS / CSP regression test:** Defer until CSP flips to enforcing.
- **`game.ts` business-logic full audit:** ~1500 lines of scoring/dedup/variant logic only spot-reviewed for auth + IDOR.
- **Production traffic / 7-day log review:** Out of pre-flight scope.

---

## Hand-off summary

Wave 1 cleanly closed **all baseline Highs and all in-scope baseline Mediums**. Two carry-overs (SE-D04 / SE-D05) are tracked. Three new lower-severity findings (SE-D01..SE-D03) emerged from the Wave 1 changes themselves. Ship blockers: none. Pre-go-live recommended: a one-line Stripe Dashboard webhook-URL verification (`curl -i -X POST` against the canonical host to confirm no 308), and the SE-D01 swap to `customers.list({ email })` (5-minute change).
