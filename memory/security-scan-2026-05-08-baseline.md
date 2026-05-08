# Baseline Security Scan — 2026-05-08

**Scope:** Pre-flight scan of branch `feat/2026-05-08-oauth-stripe-go-live` at HEAD `16e07f1`, banked before OAuth + Stripe productionization changes land. Two specialist subagents ran in parallel:

- `Security Engineer` — application + transport surface ([scan-baseline-security-engineer.md](scan-baseline-security-engineer.md))
- `Compliance Auditor` — process, data, provider trust ([scan-baseline-compliance-auditor.md](scan-baseline-compliance-auditor.md))

**Secret-handling:** Both subagents confirmed they never echoed `.env` values, JWTs, secret strings, or webhook payload bodies. `.env` was opened only via targeted `grep` with redaction.

---

## Severity Rubric

- **Critical** — RCE, auth bypass, payment bypass, secret committed to repo, public PII exposure
- **High** — privilege escalation, PII leak, webhook forgery, missing auth on admin routes, financial/state corruption, known production blocker
- **Medium** — info disclosure, DoS, weak headers, missing rate limit on sensitive op, missing dunning event, suboptimal patterns with limited blast radius
- **Low** — hygiene, stale comments, naming issues, deferred non-blocking improvements
- **Info** — posture observation, no action required (just noted for visibility)

---

## Consolidated Findings Table

| ID | Severity | Title | Location | Status | Disposition |
|----|----------|-------|----------|--------|-------------|
| **CA-01** | **Critical** | RLS disabled on every table in `public` schema | `drizzle/meta/*_snapshot.json` | **Open — needs user triage** | Verify PostgREST exposure in Supabase Dashboard; if exposed, emergency block |
| SE-01 | High | Open redirect in Stripe checkout via attacker-controlled `Origin` header | `server/routers/monetization.ts:269,294,315` | Open | Fix in Task 19 (mechanical) |
| SE-02 | High | TOCTOU double-spend in `insights.playWeaknessPack` (non-atomic GN debit) | `server/routers/insights.ts:307-345` | Open | Fix in Task 19 (mechanical) |
| SE-03 | High | Untrusted `x-forwarded-for` used as rate-limit identity | `api-src/trpc/[trpc].ts:60` | Open | Fix in Task 19 (mechanical) |
| CA-02 | High | First-sign-in profile-name capture missing for Apple OAuth | `server/_core/supabase-auth.ts:79-118` | Open | Already covered by **Task 8** |
| CA-03 | High | No handler for `invoice.payment_failed` | `server/_core/stripeWebhook.ts:77-256` | Open | Already covered by **Task 15** |
| CA-04 | High | No handler for `customer.subscription.updated` | `server/_core/stripeWebhook.ts:77-256` | Open | Already covered by **Task 14** |
| CA-08 | Medium → **High (blocker for Task 14/15)** | `subscription_status` enum missing `past_due`/`unpaid`/`trialing`/`incomplete`/`incomplete_expired` | `drizzle/schema.ts:81-86` | Open | Migration must precede Task 14/15 |
| CA-16 | High | Idempotency rollback re-processes partial successes → double-credit GN / double-record entry-fee | `server/_core/stripeWebhook.ts:62-75, 259-275` | Open | Fix in Task 19 (transactionalize) |
| SE-04 | Medium | Helmet `Cross-Origin-Opener-Policy: same-origin` will break OAuth popups | `server/_core/index.ts:50-55` | Open | Already covered by **Task 9** |
| SE-05 | Medium | Helmet default CSP will block Supabase + Stripe Checkout | `server/_core/index.ts:50-55` | Open | Already covered by **Task 10** |
| SE-06 | Medium | `forge.manus.im` fallback URL — out-of-trust-boundary LLM endpoint | `server/_core/llm.ts:215` | Open | Already covered by **Task 7 Step 3** |
| SE-07 | Medium | State-mutating game procedures are `publicProcedure` w/o consistent ownership check | `server/routers/game.ts:383,400,1230,1357,1379,1421` | Open | Fix in Task 19 (defense-in-depth) |
| SE-08 | Medium | Express missing `trust proxy` — `req.ip` defeated when proxied | `server/_core/index.ts:41-44` | Open | Fix in Task 19 (mechanical) |
| SE-09 | Medium | Verify 308 redirect doesn't strip raw body for `/api/stripe/webhook` | `vercel.json:23` + `api/stripe/webhook.mjs` | Verify | Will be checked by Agent S in Task 22 |
| SE-10 | Medium | `insights.getMyWeaknessDiagnosis`/`playWeaknessPack` use `publicProcedure` | `server/routers/insights.ts:155,294` | Open | Fix in Task 19 (defense-in-depth) |
| SE-11 | Medium | Stale legacy OAuth callback route still issues session cookies | `server/_core/oauth.ts:1-58` | Open | Already covered by **Task 2** |
| CA-05 | Medium | `charge.dispute.created` not handled — chargebacks don't pause access | `server/_core/stripeWebhook.ts:77-256` | Open | **Needs user decision** — add now or defer |
| CA-06 | Medium | `charge.refunded` for invoices logged "for review" only — does not flip subscription state | `server/_core/stripeWebhook.ts:241-250` | Open | Fix in Task 19 |
| CA-07 | Medium | Stripe SDK instantiated without `apiVersion` (3 sites) | `server/stripe-integration.ts:3`, `server/routers/goldenNotes.ts:123` | Open | Already covered by **Task 12** (extend to 3 sites) |
| CA-09 | Medium | No Stripe-customer dedup — only `customer_email` passed (4 sites) | `server/stripe-integration.ts:22,56,99`, `server/routers/goldenNotes.ts:143` | Open | Fix in Task 19 (D13) |
| CA-10 | Medium | Email-collision identity-linking: `loginMethod` permanently stale after second-provider sign-in (no row corruption) | `server/_core/supabase-auth.ts:94-115` | Open | Fix in Task 19 (D8) — minor severity since no corruption |
| CA-11 | Medium | No `Sb-Forwarded-For` header on Supabase admin calls — D17 IP rate-limit shared across all users | `server/app-router.ts:133`, `server/_core/supabase-auth.ts:37` | Open | Defer to follow-up per spec §10 |
| CA-12 | Medium | No account-deletion path (GDPR/CCPA) | n/a | Open | Defer per spec §1 non-goals |
| CA-13 | Medium | Web client uses `flowType: "implicit"` instead of PKCE | `client/src/lib/supabase.ts:29` | Open | **Needs user decision** — flip to PKCE now? |
| SE-12 | Low | `STRIPE_TEST2_KEY_STRIPE_SECRET_KEY` admin-only test-mode escape hatch + naming | `server/routers/goldenNotes.ts:113-116` | Open | Already covered by **Task 11** |
| SE-13 | Low | Sign-in email logged in plaintext (PII) on success path | `server/_core/sendMagicLinkEmail.ts:60-66` | Open | Fix in Task 19 (use `redact()`) |
| SE-14 | Low | `JWT_SECRET` / `cookieSecret` read but unused | `server/_core/env.ts:3` | Open | Already covered by **Task 4** |
| CA-14 | Low | Stale Manus env vars still referenced (code + `.env.example`) | multiple | Open | Already covered by **Tasks 2-4** |
| CA-15 | Low | `JWT_SECRET=change-me-…` placeholder in `.env.example:48` | `.env.example:48` | Open | Already covered by **Task 4** |
| SE-15 | Info | Process-local rate-limit buckets — fine today, document scale threshold | `server/_core/rateLimit.ts:8` | Noted | Document in todo.md follow-ups |
| SE-16 | Info | DEV bypass + dev magic-link route correctly NODE_ENV-gated | `context.ts:57-63`, `app-router.ts:271-275` | Noted (good) | None |
| CA-17 | Info | Vercel env-var scoping unverifiable from repo | n/a | Open | Verified during Wave 2 + Agent S |
| CA-18 | Info | Supabase Auth/GoTrue version unverifiable from repo (need ≥ v2.176.1) | `package.json:56` | Open | Verified during Wave 2 |
| CA-19 | Info | `pnpm audit`: 41 high / 38 moderate / 3 low — ALL dev-toolchain (xlsx, pnpm, tar, rollup, minimatch); none in `@supabase/*`, `stripe`, or `express` | repo root | Open | Document in todo.md follow-ups; not runtime-affecting |

---

## Coverage Gaps (acknowledged)

- iOS Capacitor wrapper internals — out of scope per spec
- Client-side XSS — spot-checked only, no automated DAST
- Production traffic analysis / log review — not in scope
- External penetration testing — not in scope (Approach (b))
- Vercel Dashboard configuration — verifiable only during Wave 2 + Agent S
- Supabase Dashboard configuration — verifiable only during Wave 2

---

## Net New Tasks Created by Baseline Findings

The following findings require additions/changes to the existing 23-task plan:

1. **NEW Task 1.5 (Critical, blocks all Wave 1):** Verify Supabase PostgREST/REST API exposure for the public schema. If exposed, RLS migration becomes a Wave 1 blocker (huge); if disabled (likely — all reads go through the tRPC layer with service-role), this is a documented posture finding only.
2. **NEW Task 1.6 (High, blocks Tasks 14/15):** Drizzle migration to widen `subscription_status` enum to include `past_due`, `unpaid`, `trialing`, `incomplete`, `incomplete_expired`.
3. **Task 19 expanded** — apply mechanical fixes for SE-01, SE-02, SE-03, SE-07, SE-08, SE-10, SE-13, CA-06, CA-09, CA-10, CA-16. Sketches:
   - SE-01: copy the `ALLOWED_ORIGINS` allowlist pattern from `goldenNotes.ts:130-138` to monetization.ts:269/294/315.
   - SE-02: replace read-then-write with atomic `update … where(gte(balance, cost))` pattern from `goldenNotes.ts:203-228`.
   - SE-03: switch from `x-forwarded-for` to `x-vercel-forwarded-for` (Vercel-set, not client-set).
   - SE-08: `app.set('trust proxy', 1)` in `server/_core/index.ts`.
   - SE-13: route the magic-link logger through `redact(email)` for the user-facing portion.
   - CA-16: wrap each event-type handler in a single `db.transaction` that includes the `processedWebhookEvents` insert.
4. **Task 12 expanded** — apply Stripe `apiVersion` pin to all 3 instantiation sites (was 1 in original plan).

## Decisions Needed From User

Two findings require explicit user disposition before Wave 1 starts:

- **CA-13 — `flowType: "implicit"`:** flip to PKCE now (more secure, mid-effort migration), or defer (current behavior unchanged)?
- **CA-05 — `charge.dispute.created` handler:** add now (defensive — pause access on dispute creation pending closure) or defer to follow-up?
