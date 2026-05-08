# Security Engineer Lane — Baseline Scan 2026-05-08

**Branch:** `feat/2026-05-08-oauth-stripe-go-live` @ `16e07f1` (HEAD)
**Scope:** application + transport surface (tRPC, Express, Vercel functions, Helmet/CSP/CORS, Stripe webhook, Supabase auth, rate limiting, secrets-in-source).

## Methodology

Scanned (read-only):
- `server/_core/index.ts`, `stripeWebhook.ts`, `supabase-auth.ts`, `cookies.ts`, `rateLimit.ts`, `context.ts`, `trpc.ts`, `systemRouter.ts`, `oauth.ts`, `env.ts`, `llm.ts`, `sendMagicLinkEmail.ts`
- `server/app-router.ts` (entire)
- `server/routers/{admin,monetization,goldenNotes,insights,game,monetization-integration}.ts` plus router headers for the rest
- `server/stripe-integration.ts`
- `api-src/stripe/webhook.ts`, `api-src/trpc/[trpc].ts`
- `vercel.json`, `scripts/build-api.mjs`, `.env` keys (names only, redacted via `sed`)

Out of scope (other lanes / next pass):
- Drizzle SQL injection sweep (parameterized queries spot-checked only)
- iOS Capacitor wrapper
- Client-side XSS / CSP per-page audit
- Production traffic + log review
- Dependency-CVE audit (npm audit / Trivy)
- Full audit of `game.ts` 1500 lines beyond auth/IDOR scan

Severity rubric:
- **Critical** RCE, auth bypass, payment bypass, secret committed
- **High** privilege escalation, PII leak, webhook forgery, missing auth on admin route
- **Medium** info disclosure, DoS, weak headers, missing rate limit on sensitive op
- **Low** hygiene, stale comments, minor config drift
- **Info** posture observation (no action required)

**Secret-handling confirmation:** This scan never echoed an env value. The `.env` was opened only via `grep | sed -E 's/=.*/=<REDACTED>/'` to enumerate variable names. No Stripe key, JWT, signing secret, OAuth client secret, or DB connection string appears in this report.

## Findings Table

| ID    | Severity | Title                                                                                              | Location                                       | Status |
|-------|----------|----------------------------------------------------------------------------------------------------|------------------------------------------------|--------|
| SE-01 | High     | Open redirect in Stripe checkout via attacker-controlled `Origin` header                           | `server/routers/monetization.ts:269,294,315`   | Open   |
| SE-02 | High     | TOCTOU double-spend in `insights.playWeaknessPack` (non-atomic Golden Notes debit)                 | `server/routers/insights.ts:307-345`           | Open   |
| SE-03 | High     | Untrusted `x-forwarded-for` used as rate-limit identity in Vercel tRPC handler                     | `api-src/trpc/[trpc].ts:60`                    | Open   |
| SE-04 | Medium   | Helmet `Cross-Origin-Opener-Policy: same-origin` will break OAuth popups                           | `server/_core/index.ts:50-55`                  | Open (planned Task 9) |
| SE-05 | Medium   | Helmet default CSP will block Supabase + Stripe Checkout in prod                                   | `server/_core/index.ts:50-55`                  | Open (planned Task 10) |
| SE-06 | Medium   | `forge.manus.im` fallback URL — out-of-trust-boundary LLM endpoint                                 | `server/_core/llm.ts:215`                      | Open   |
| SE-07 | Medium   | State-mutating game procedures are `publicProcedure` (no consistent ownership check)               | `server/routers/game.ts:383,400,1230,1357,1379,1421` | Open   |
| SE-08 | Medium   | Express server missing `trust proxy` — `req.ip` is the load-balancer in any proxied dev/staging   | `server/_core/index.ts:41-44`                  | Open   |
| SE-09 | Medium   | Vercel checkout URL's `308 → /api/stripe/webhook` rewrite risk (no `/api/` exclusion proven)       | `vercel.json:23` + `api/stripe/webhook.mjs`    | Verify |
| SE-10 | Medium   | `insights.getMyWeaknessDiagnosis` / `playWeaknessPack` use `publicProcedure` (defense-in-depth)    | `server/routers/insights.ts:155,294`           | Open   |
| SE-11 | Medium   | Stale legacy OAuth callback route still imports `sdk.exchangeCodeForToken` / sets cookie           | `server/_core/oauth.ts:1-58`                   | Open   |
| SE-12 | Low      | `STRIPE_TEST2_KEY_STRIPE_SECRET_KEY` admin-only test-mode escape hatch                              | `server/routers/goldenNotes.ts:113-116`        | Open   |
| SE-13 | Low      | Sign-in email logged in plaintext (PII) on success path                                            | `server/_core/sendMagicLinkEmail.ts:60-66`     | Open   |
| SE-14 | Low      | `JWT_SECRET` env var read but unused (env.ts:3) — documents intent that no longer exists          | `server/_core/env.ts:3`                        | Open   |
| SE-15 | Info     | Process-local rate-limit buckets — fine for single-node Vercel today; document before scale       | `server/_core/rateLimit.ts:8`                  | Noted  |
| SE-16 | Info     | DEV bypass + dev magic-link route are correctly NODE_ENV-gated                                     | `context.ts:57-63`, `app-router.ts:271-275`    | Noted (good) |

## Per-Finding Detail

### SE-01 — Open redirect in Stripe checkout via attacker-controlled `Origin`
- **Severity:** High
- **Location:** `server/routers/monetization.ts:269` (`createSubscriptionCheckout`), `:294` (`createEntryFeeCheckout`), `:315` (`createAddOnGamesCheckout`)
- **Description:** All three monetization-checkout procedures pass `ctx.req.headers.origin || "http://localhost:3000"` directly into the Stripe `success_url` / `cancel_url`. Unlike `goldenNotes.ts:130-138` and `app-router.ts:114-117`, there is no `ALLOWED_ORIGINS` allowlist gate. CORS blocks browser-initiated cross-origin XHR, but Stripe webhooks/redirects don't depend on the browser CORS preflight — a server-to-tRPC POST with `Origin: https://evil.com` is accepted.
- **Attack scenario:** Attacker phishes a victim into clicking a link that submits a tRPC `createSubscriptionCheckout` mutation with a forged `Origin` header (via a compromised native shim or a JSON pre-flight bypass). The returned Stripe Checkout `success_url` redirects the paid-up customer to `https://evil.com/dashboard?session_id=cs_live_…`, where the attacker captures the session id (a Stripe Checkout Session id is not a secret, but the redirect can phish credentials by mimicking the post-checkout flow).
- **Suggested fix:** Reuse the validated-origin pattern from `goldenNotes.ts:130-138`: parse `ALLOWED_ORIGINS`, accept `claimedOrigin` only when `allowlist.includes(claimedOrigin)`, otherwise fall back to the canonical production host. Centralize as `resolveTrustedOrigin(ctx)` to avoid drift.

### SE-02 — TOCTOU double-spend in `insights.playWeaknessPack`
- **Severity:** High
- **Location:** `server/routers/insights.ts:307-345`
- **Description:** The Golden Notes debit reads `bal.balance`, computes `newBalance = bal.balance - PACK_PRICE_GN`, then writes `set({ balance: newBalance, … })`. Two concurrent invocations both pass the check and both write `bal.balance - 4` — the user spends 4 GN but is debited 4 GN twice (or worse: ends up paying 4 GN once and getting two practice packs). Compare to `goldenNotes.ts:203-228`, which uses `db.update().where(gte(balance, cost))` inside `db.transaction` and checks `updated.length === 0` for the race-loss case.
- **Attack scenario:** Authenticated user fires N parallel `playWeaknessPack` mutations from a script. With balance == 4, they each pass the `>= 4` check. The server inserts N transaction rows but the final balance lands at `4 - N*4` (negative possible since the column has no `>= 0` constraint visible from this code). User gets N practice rooms, including the room-creation logic that is downstream.
- **Suggested fix:** Replace the read-then-write with the atomic `update … where(and(eq(userId), gte(balance, PACK_PRICE_GN)))` pattern from `goldenNotes.ts:203-228`. Wrap the balance debit + transaction insert + room create in one `db.transaction(...)`. Bonus: add a CHECK constraint `golden_note_balances.balance >= 0` at the schema layer so even buggy code can't go negative.

### SE-03 — Vercel `[trpc].ts` reads `x-forwarded-for` directly without trust filtering
- **Severity:** High (rate-limit-bypass primitive)
- **Location:** `api-src/trpc/[trpc].ts:60`
- **Description:** The Fetch-Request → Express-Request shim assembles `ip: req.headers.get("x-forwarded-for")?.split(",")[0].trim() ?? "0.0.0.0"`. On Vercel, the leftmost X-F-F entry is set by the client and only the trailing entry (or `x-real-ip`) is added by Vercel's edge. An attacker can send `X-Forwarded-For: 1.2.3.4, …` on every request to defeat the IP-keyed rate limiters in `auth.sendMagicLink.ip`, `auth.sendPasswordReset.ip`, `auth.me`, and `submitAnswer`. Magic-link rate limit is then capped only by the per-email bucket (5/hr), letting an attacker enumerate or harass any address from infinite "fake" IPs.
- **Attack scenario:** Adversary scripts password-reset bombs against each of N target emails. The per-email bucket caps at 3/hr per email, but the per-IP bucket (20/hr) is bypassed by rotating `X-Forwarded-For`. Net: 3 emails/hr × N targets = abuse vector amplified by N.
- **Suggested fix:** On Vercel, use `req.headers.get("x-real-ip")` (Vercel-supplied), or `x-vercel-forwarded-for` (also Vercel-supplied), or `req.headers.get("x-forwarded-for")?.split(",").slice(-2,-1)[0]` (second-to-last is the most recent trusted hop). For Express, set `app.set("trust proxy", 1)` and rely on `req.ip`. Express alone won't help on Vercel because the [trpc].ts handler is the live path in prod.

### SE-04 — Helmet `Cross-Origin-Opener-Policy: same-origin` will break OAuth popups
- **Severity:** Medium (will break Task 9 functionality at deploy)
- **Location:** `server/_core/index.ts:50-55`
- **Description:** `helmet({})` sets `Cross-Origin-Opener-Policy: same-origin` by default. Google/Apple OAuth popup-flow relies on `window.opener.postMessage` between the Supabase auth popup and the parent window. With COOP `same-origin`, the popup window's `opener` is severed and Supabase's popup callback fires `postMessage` into the void.
- **Attack scenario:** Not an attack — a deployment break for the upcoming Google + Apple sign-in (Task 9). Pre-flagging so the fix lands as part of that work, not as a post-deploy fire.
- **Suggested fix:** `helmet({ crossOriginOpenerPolicy: { policy: "same-origin-allow-popups" }, … })`. Test the OAuth flow in Vercel preview before promoting to prod.

### SE-05 — Helmet default CSP will block Supabase + Stripe Checkout
- **Severity:** Medium (will break Task 10 functionality at deploy)
- **Location:** `server/_core/index.ts:50-55`
- **Description:** `contentSecurityPolicy: isProd ? undefined : false` — in prod, Helmet applies its default CSP. Default `connect-src 'self'` blocks Supabase Auth XHR to `<project>.supabase.co`. Default `script-src 'self'` blocks `https://js.stripe.com/v3/`. Default `frame-src 'self'` blocks the Stripe Checkout iframe (`hooks.stripe.com`, `js.stripe.com`, `checkout.stripe.com`).
- **Attack scenario:** Not an attack — a deployment break for OAuth + Stripe go-live (Task 10).
- **Suggested fix:** Pre-load a custom `contentSecurityPolicy.directives` object at minimum:
  ```
  defaultSrc: ["'self'"]
  scriptSrc:  ["'self'", "https://js.stripe.com"]
  connectSrc: ["'self'", "https://*.supabase.co", "https://api.stripe.com"]
  frameSrc:   ["https://js.stripe.com", "https://hooks.stripe.com", "https://checkout.stripe.com"]
  imgSrc:     ["'self'", "data:", "https:"]
  styleSrc:   ["'self'", "'unsafe-inline'"]  // only if Tailwind needs it; prefer nonce
  fontSrc:    ["'self'", "data:"]
  ```
  Validate against the live OAuth flow (Supabase auth iframe) and Stripe Checkout in a preview before promoting.

### SE-06 — `forge.manus.im` fallback URL — out-of-trust-boundary LLM endpoint
- **Severity:** Medium
- **Location:** `server/_core/llm.ts:215`
- **Description:** When `BUILT_IN_FORGE_API_URL` is unset, `resolveApiUrl()` falls back to `https://forge.manus.im/v1/chat/completions`. The Manus host is leftover from the original Manus-OAuth scaffolding that the rest of the project has retired (per `server/_core/oauth.ts` comments and Task 11 in the OAuth/Stripe plan). Sending arbitrary user-supplied text plus `BUILT_IN_FORGE_API_KEY` Bearer tokens to a third-party host is a data-exfiltration and credential-reuse risk if `BUILT_IN_FORGE_API_URL` is ever cleared in env.
- **Attack scenario:** Operator removes `BUILT_IN_FORGE_API_URL` thinking the project no longer uses it, but `BUILT_IN_FORGE_API_KEY` remains set. Every LLM call (insights diagnosis, anywhere else `invokeLLM` is used) silently exfiltrates user prompts (which can include game answers, room codes, gameplay history) and the Bearer token to `forge.manus.im`.
- **Suggested fix:** Replace the fallback with a `throw new Error("LLM endpoint not configured")` so a missing env var fails closed, not open. Alternatively, after Task 11's Manus removal, use a configurable allow-list of vendor URLs (e.g., `https://api.openai.com`, `https://api.anthropic.com`).

### SE-07 — State-mutating game procedures are `publicProcedure` without consistent ownership check
- **Severity:** Medium
- **Location:** `server/routers/game.ts` — `setReady:383`, `startGame:400`, `getNextSong:412`, `submitAnswer:877`, `nextRound:1230`, `assignTeam:1357`, `createTeams:1379`, `saveGamePrefs:1421`
- **Description:** Many room-state mutators are `publicProcedure` because guests legitimately interact with rooms via `guestToken`. The pattern is reasonable, but several procedures don't verify that the caller is actually a member of the room they're mutating:
  - `startGame` (line 400): blindly flips `room.status` to "active" given just `roomCode` — any unauthenticated client can start someone else's game.
  - `nextRound` (line 1230): blindly advances round and writes leaderboard entries given just `roomCode`.
  - `createTeams` (line 1379) / `assignTeam` (line 1357): no host/membership check.
  - `getNextSong` (line 417): mutates `usedSongIds` and `currentSongId` for any room given the code.
- **Attack scenario:** Adversary harvests a room code (6 chars from `nanoid`, ~36^6 ≈ 2.2B but easily found in URLs / shared links). Without joining, they can: spam `getNextSong` to exhaust all songs in the room (DoS), spam `nextRound` to skip ahead (game-state vandalism), spam `submitAnswer` impersonating a guest token they sniff, etc.
- **Suggested fix:** Each mutator should verify the caller has a `roomPlayers` row for the room (by `userId` or `guestToken`). For host-only ops (`startGame`, `createTeams`), require `roomPlayers.userId === gameRooms.hostUserId` (or the corresponding `guestToken === host`). The IDOR pattern at `monetization.ts:108-122` is a good model.

### SE-08 — Express server missing `trust proxy`
- **Severity:** Medium
- **Location:** `server/_core/index.ts:41-44` (no `app.set("trust proxy", …)`)
- **Description:** When the Express server runs behind a load balancer, `req.ip` returns the LB IP, defeating the per-IP rate-limit buckets in `auth.sendMagicLink.ip`, `auth.sendPasswordReset.ip`, `auth.me`, etc. On Vercel today, this code path is dormant because `[trpc].ts` is the live entry, but if local docker/staging runs Express behind a proxy the limits become effectively per-LB (i.e., one shared bucket).
- **Suggested fix:** `app.set("trust proxy", 1)` (or the loopback-only setting `app.set("trust proxy", "loopback")`) right after `const app = express()`.

### SE-09 — Verify `308 → /api/stripe/webhook` redirect doesn't strip raw body
- **Severity:** Medium (verify-only — may already be safe)
- **Location:** `vercel.json:23` (`"rewrites": [{ "source": "/((?!api/).*)", "destination": "/index.html" }]`) + `api/stripe/webhook.mjs`
- **Description:** The Vercel rewrite excludes `/api/`, so `/api/stripe/webhook` should land directly on the function. But if Stripe is configured with `https://www.playlyricpro.com/api/stripe/webhook` and the apex/`www` redirect issues a 308, Stripe will follow the 308 with the same body but sometimes browsers/curl-likes strip body on follow. Stripe's libraries don't follow redirects on POST, so a 308 means signature verification fails downstream. Worth a one-time `curl -X POST -d '{}' https://www.playlyricpro.com/api/stripe/webhook -i` in prod to confirm 200/400, not 308.
- **Suggested fix:** Configure the Stripe Dashboard webhook URL to the canonical host that doesn't redirect. Add a one-line note in the Stripe runbook.

### SE-10 — Insights router uses `publicProcedure` for what should be `protectedProcedure`
- **Severity:** Medium (defense-in-depth)
- **Location:** `server/routers/insights.ts:155` (`getMyWeaknessDiagnosis`), `:294` (`playWeaknessPack`)
- **Description:** Both procedures' first line is `if (!ctx.user?.id) return null` / `throw UNAUTHORIZED`. Functionally equivalent to `protectedProcedure`, but if a future refactor drops the in-handler guard, the auth requirement disappears silently. `protectedProcedure` makes the contract type-safe (`ctx.user` is non-null inside the handler).
- **Suggested fix:** Switch both to `protectedProcedure`. Saves the manual null-check (lines 156, 295-297).

### SE-11 — Stale legacy OAuth callback route
- **Severity:** Medium (auth confusion + stale code)
- **Location:** `server/_core/oauth.ts:1-58`
- **Description:** `registerOAuthRoutes` defines `GET /api/oauth/callback` that calls `sdk.exchangeCodeForToken` and sets the legacy `COOKIE_NAME` session cookie. The plan / comments in `app-router.ts:38-49` explicitly say the legacy Manus-OAuth callback was retired, but `oauth.ts` still exports `registerOAuthRoutes`. If anything calls it (or it's wired up in a build artifact), an attacker could potentially craft an OAuth code/state pair and have a session cookie issued for an arbitrary user.
- **Suggested fix:** Confirm `registerOAuthRoutes` is not invoked anywhere (`grep -r registerOAuthRoutes server/ api-src/`) — if not, delete the file. If still wired, replace the body with a 410 Gone.

### SE-12 — Admin-only Stripe test-mode escape hatch
- **Severity:** Low
- **Location:** `server/routers/goldenNotes.ts:113-116`
- **Description:** Admin users hit Stripe test mode via the malformed env var `STRIPE_TEST2_KEY_STRIPE_SECRET_KEY` (the doubled `_KEY` looks like a copy-paste error from the Stripe CLI's `STRIPE_TEST2_KEY` namespace). Functionally fine: admins testing checkout don't pay real money. Two concerns:
  1. A user who escalates to `role=admin` (via a compromised user_metadata path) automatically gets to test-mode Stripe, which can be used to mint Golden Notes with fake test cards if the webhook doesn't separately verify mode.
  2. The webhook handler at `stripeWebhook.ts:43-51` uses a SINGLE `STRIPE_WEBHOOK_SECRET`. If admins create real-mode-looking events from test mode that hit the same endpoint, idempotency-bypass + free-mints become a risk.
- **Suggested fix:** Rename to `STRIPE_TEST_SECRET_KEY` for hygiene. Configure two separate Stripe webhook endpoints (test + live) with separate signing secrets, and route via two webhook URLs (`/api/stripe/webhook` for live, `/api/stripe/webhook-test` for test) so test-mode events can never trigger live-mode minting in `handleCheckoutSessionCompleted`.

### SE-13 — Sign-in email logged in plaintext (PII)
- **Severity:** Low
- **Location:** `server/_core/sendMagicLinkEmail.ts:60-66`
- **Description:** On successful Resend send, the handler logs `JSON.stringify({ id: data.id, to: params.to, domain })`. The recipient email is full plaintext in Vercel logs. Same pattern repeats in `sendPasswordResetEmail.ts:41` and `sendFeedbackEmail.ts:39`. Vercel logs are not user-facing but are retained and accessible to anyone with project read access. Combined with the Resend side, this is mild PII leakage.
- **Suggested fix:** Reuse the `redact()` pattern from `stripeWebhook.ts:22-27` for the email — log domain + first 2 chars of local-part (e.g., `de…@gmail.com`). Keep the Resend `id` for support lookups.

### SE-14 — `JWT_SECRET` env var read but unused
- **Severity:** Low
- **Location:** `server/_core/env.ts:3` (`cookieSecret: process.env.JWT_SECRET ?? ""`)
- **Description:** The `cookieSecret` field is exported but no consumer remains after the Manus-auth retirement. Confusing: documents intent that doesn't exist, and operators may rotate it without knowing it's a no-op. The `.env` still defines `JWT_SECRET=…`.
- **Suggested fix:** Delete the field from `env.ts`, remove `JWT_SECRET` from `.env.example`. If keeping for future use, add a `// reserved for X` comment.

### SE-15 — Process-local rate-limit buckets
- **Severity:** Info
- **Location:** `server/_core/rateLimit.ts:8` (`const BUCKETS = new Map<…>`)
- **Description:** Buckets are per-Lambda-instance. Vercel serverless creates fresh instances under load, so the rate limit is "5/hr per email per warm instance," not "5/hr per email globally." Today's traffic does not warm enough instances for this to matter, but document the threshold (≈ 50–100 RPS sustained) at which a Redis-backed limiter (Upstash) becomes necessary. Not urgent.
- **Suggested fix:** Add a TODO comment + capacity-review checklist item when subscription volume hits 1k DAU.

### SE-16 — DEV bypass + dev magic-link route are correctly NODE_ENV-gated
- **Severity:** Info (validation — this is good)
- **Location:** `context.ts:57-63`, `app-router.ts:271-275`
- **Description:** `DEV_AUTH_BYPASS=1` only activates when `NODE_ENV !== "production"`, and `devGenerateMagicLink` `throws FORBIDDEN` in production. Confirmed defense-in-depth. Continue this pattern.

## Coverage Gaps

- **SQL injection sweep:** Drizzle `eq(…)` + `sql<>` template tags are parameterized by default; spot-checked clean. A full SAST pass (Semgrep `p/sqlinjection`) is recommended in a follow-up lane.
- **Dependency CVEs:** No `npm audit` or Trivy run — recommend in CI pipeline before go-live.
- **Client-side XSS / CSP:** Out of this lane. Re-scan after CSP is enabled (SE-05) to catch unsafe-inline regressions.
- **Production traffic / log review:** Out of scope for pre-flight; run after first 7 days post-go-live.
- **iOS Capacitor wrapper:** Not in scope.
- **`game.ts` exhaustive review:** Only auth/IDOR-relevant procedures audited; the 1500-line scoring/dedup/variant logic was not deep-reviewed for state-machine correctness.
- **Rate-limit coverage matrix:** Not all 60+ tRPC procedures verified to have buckets. Critical ones do (auth, magic link, password reset, checkout, hint, spend); a follow-up pass should produce a complete procedure-level matrix.
