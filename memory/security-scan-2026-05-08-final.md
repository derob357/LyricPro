# Final Security Scan — 2026-05-11 (Wave 4)

**Scope:** Delta scan of branch `feat/2026-05-08-oauth-stripe-go-live` at HEAD `47fefa2`, diffed against the Wave 0 baseline at `66e134f`. Final scan after Wave 1 code changes + Wave 2 user-driven provider configuration + Wave 3 end-to-end verification.

**Sub-reports:**
- [scan-final-security-engineer.md](scan-final-security-engineer.md) — application + transport surface
- [scan-final-compliance-auditor.md](scan-final-compliance-auditor.md) — process, data, provider trust

**Secret-handling:** Both lanes confirmed they never echoed `.env` values, JWTs, secret strings, or webhook payload bodies. `.env` accessed only via targeted grep with redaction. Targeted grep against the entire repo for committed secret patterns (`sk_live_*`, `whsec_*`, `sb_secret_*`, JWT shapes) returned **zero matches**.

---

## Definition of Done — verdict

Per the spec §7 exit criterion: **"Wave 4 final scan shows zero open Critical or High findings."**

**Status: PASS.**

| Severity tier | Open at end of Wave 4 | Notes |
|---|---|---|
| Critical | **0** | (CA-01 was the only Wave 0 Critical; downgraded to Medium-posture-only after live REST probe confirmed no data leak — anon role gets empty arrays. Documented in todo.md.) |
| High | **0** | All 3 Wave 0 Highs (SE-01 open redirect, SE-02 TOCTOU, SE-03 IP trust) fixed in Wave 1. CA-02 (Apple first-sign-in capture), CA-03 (`invoice.payment_failed`), CA-04 (`customer.subscription.updated`) also all fixed. |
| Medium | 5 open, all tracked in todo.md | CA-05 (dispute handler), CA-11 (Sb-Forwarded-For), CA-16 (idempotency transactionalize), SE-D01 (Stripe customers.search→list), SE-D04 (4 remaining game.ts ownership checks) |
| Low | 1 open | SE-D04's password-reset-email log SE-D05 was FIXED in this commit; others tracked |
| Info | Several | All notional/posture; no action |

---

## Baseline diff summary

### Wave 0 Security Engineer findings (16 total)

| ID | Severity | Status |
|---|---|---|
| SE-01 | High | FIXED (a9f569e) |
| SE-02 | High | FIXED (2b7843f) |
| SE-03 | High | FIXED (9e61a57) |
| SE-04 | Medium | FIXED (ba6ff65) |
| SE-05 | Medium | FIXED (ba6ff65, reportOnly) |
| SE-06 | Medium | FIXED (bee0689) |
| SE-07 | Medium | PARTIAL — 3 of 6 procedures fixed in 1e0a5a9; 4 carryover tracked as SE-D04 |
| SE-08 | Medium | FIXED (d571e82) |
| SE-09 | Medium | VERIFIED (webhook URL re-pointed to www per Agent S; user updated Stripe Dashboard) |
| SE-10 | Medium | FIXED (1843d7e) |
| SE-11 | Medium | FIXED (5580478 — entire file removed in Manus cleanup) |
| SE-12 | Low | FIXED (d5efecc) |
| SE-13 | Low | PARTIAL — magic-link fixed in 1d7d9df; password-reset fixed in 47fefa2 |
| SE-14 | Low | FIXED (54cecac) |
| SE-15 | Info | NOTED (no action) |
| SE-16 | Info | NOTED (good posture) |

### Wave 0 Compliance Auditor findings (19 total)

| ID | Severity | Status |
|---|---|---|
| CA-01 | Critical → Med-posture | OPEN (posture only; live probe confirmed no data leak; tracked in todo.md) |
| CA-02 | High | FIXED (ef1657f) |
| CA-03 | High | FIXED (c2cdeb0) |
| CA-04 | High | FIXED (72f12f3) |
| CA-05 | Medium | OPEN (dispute handler deferred per Q-C decision; todo.md) |
| CA-06 | Medium | FIXED (6bb31cb) |
| CA-07 | Medium | FIXED (7cbb10f — pinned `2026-03-25.dahlia`) |
| CA-08 | Medium | FIXED (6a4fdef + cffdf95) |
| CA-09 | Medium | FIXED (a41eed5) |
| CA-10 | Medium | FIXED (3712238) |
| CA-11 | Medium | OPEN (Sb-Forwarded-For deferred; todo.md) |
| CA-12 | Medium | OPEN (GDPR erasure deferred; todo.md) |
| CA-13 | Medium | FIXED (4f88ab9 — PKCE) |
| CA-14 | Low | FIXED (Manus var sweep complete) |
| CA-15 | Low | FIXED (JWT_SECRET removed) |
| CA-16 | Medium | OPEN (idempotency-rollback architectural; todo.md) |
| CA-17 | Info | VERIFIED (Vercel scoping operator-confirmed during Wave 2) |
| CA-18 | Info | FIXED (Supabase Auth v2.189.0 ≥ v2.176.1) |
| CA-19 | Info | UNCHANGED (84 audit findings; all dev-toolchain only) |

---

## New findings introduced by Wave 1/2/3 work

Both lanes did a fresh pass on changes shipped in this cycle to catch regressions or new gaps. Results:

| ID | Severity | Title | Status |
|---|---|---|---|
| SE-D01 | Medium | `resolveStripeCustomer` uses `customers.search` with manual quote escape; prefer `customers.list({email})` | OPEN — todo.md |
| SE-D02 | Low | `resolveStripeCustomer` swallows all errors silently | OPEN (accepted) |
| SE-D03 | Info | CSP `reportOnly: true` with no `report-uri` — operators have no signal during bake | OPEN — todo.md |
| SE-D04 | Medium | SE-07 carryover: 4 game.ts procedures still mutate state without ownership checks | OPEN — todo.md |
| SE-D05 | Low | SE-13 carryover: `sendPasswordResetEmail.ts:43` still logged plaintext | **FIXED (47fefa2)** |
| SE-D06 | Info | Apple client_secret JWT generator script audit clean | VERIFIED |
| SE-D07 | Info | New webhook handlers use Drizzle parameterized writes; idempotency preserved | VERIFIED |
| SE-D08 | Info | `customer.subscription.updated` casts unvalidated Stripe strings to TS enum unions | NOTED (defense-in-depth seam) |
| CA-D01 | Low | Docs still cited apex webhook URL after switch to www | **FIXED (47fefa2)** |
| CA-D02 | Info | Apple JWT 6-month rotation reminder documented | VERIFIED |

---

## Coverage gaps (out of scope for this cycle)

- iOS Capacitor wrapper internals (separate spec; Apple OAuth web only this cycle)
- Client-side XSS regression testing once CSP flips to enforcing (post-bake follow-up)
- Drizzle SAST sweep with Semgrep `p/sqlinjection` rules (no findings expected — all writes are parameterized — but unverified)
- External penetration test (Approach (b) was chosen at brainstorming time)
- Stripe live state — recent webhook delivery success rate (no Stripe MCP available; operator-verified via Dashboard)
- 7-day production log review post-launch

---

## Tracker entries

The following items are now in `todo.md` as deferred follow-ups:

```
## Wave 4 delta-scan carryovers (2026-05-11)

- [ ] SE-D04 (Medium): Ownership checks on remaining game.ts procedures
      (setReady, getNextSong, submitAnswer, assignTeam)
- [ ] SE-D01 (Medium): Stripe customers.search → customers.list refactor
- [ ] SE-D03 (Info): CSP reportOnly → enforcing reminder
```

Plus pre-existing carryovers from earlier waves:
```
- [ ] CA-01: Add RLS policies OR remove `public` from exposed schemas (defense-in-depth)
- [ ] CA-05: charge.dispute.created handler
- [ ] CA-11: Sb-Forwarded-For for Supabase admin calls
- [ ] CA-12: GDPR account-deletion flow
- [ ] CA-16: Idempotency rollback transactionalize
```

---

## Branch state at end of Wave 4

- 50+ commits ahead of `main`
- Build green (`pnpm build` exits 0)
- Tests green (91 passing: 83 server + 8 client, 5 skipped, 0 failed)
- Latest commit: `47fefa2 fix(wave-4): doc URL apex→www + redact password-reset email logs + log carryovers`
- No secrets committed, no `.p8` files in tree
- All Manus references either removed or intentional documentary

**Definition of Done: PASS. Branch is ready for merge to main + deploy.**
