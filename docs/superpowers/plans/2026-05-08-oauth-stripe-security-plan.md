# OAuth + Stripe Live + Security + Manus Removal — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Take Google + Apple OAuth and Stripe from "code-complete, provider-side unconfigured" to "live in production." Remove all Manus-era legacy code. Bracket the work with a baseline + delta security scan.

**Architecture:** Five-wave execution. Wave 0 = parallel baseline scan. Wave 1 = code-side changes (Manus removal in 6 dependency-ordered steps + OAuth/Stripe adjustments + 3 new tests). Wave 2 = user-driven dashboard configuration via a runbook deliverable. Wave 3 = parallel verification subagents (one per provider). Wave 4 = delta scan against the baseline.

**Tech Stack:** TypeScript, Express on Vercel via `@vercel/node` (Express bundled into `dist/`; standalone Stripe webhook function at `api-src/stripe/webhook.ts`), tRPC, React + Vite, Drizzle ORM on Postgres (Supabase), Helmet, Stripe SDK 22.x, Supabase Auth (`@supabase/supabase-js` 2.x), Vitest.

**Spec:** [docs/superpowers/specs/2026-05-08-oauth-stripe-security-design.md](../specs/2026-05-08-oauth-stripe-security-design.md)

**Sequencing constraint:** Each wave's exit criterion must hold before the next begins. Within Wave 1, the six Manus-removal tasks must execute in order — each subsequent step exposes the next as orphaned. The OAuth/Stripe/test tasks in Wave 1 can run in any order after Manus removal completes.

**Secrets handling:** Per project memory, never paste secrets into chat. Only ask for env-var **names** to be added to `.env` and Vercel UI. When the user says "saved," read from `.env` on disk to use values. Never echo values back. Subagents must be told this explicitly.

---

## File Structure

### Files to delete

- `server/_core/oauth.ts` — dead Manus OAuth callback (Step 1)
- `server/_core/sdk.ts` — Manus SDK client (Step 2)
- `server/_core/types/manusTypes.ts` — proto-derived Manus types (Step 2)
- `client/src/components/ManusDialog.tsx` — never imported (Step 1)
- `client/public/__manus__/debug-collector.js` (Step 4)
- `ios/App/App/public/__manus__/debug-collector.js` (Step 4)
- `android/app/src/main/assets/public/__manus__/debug-collector.js` (Step 4)
- `dist/public/__manus__/debug-collector.js` (Step 4 — gitignored, optional)
- `.manus/` directory and contents (Step 5)
- `.manus-logs/` directory and contents (Step 5)

### Files to modify

- `client/src/pages/Lobby.tsx` — replace Manus portal redirect with `/signin` redirect (Step 1)
- `client/src/pages/SignIn.tsx` — Apple `scopes: 'name email'` + first-sign-in profile capture handler (Task 8)
- `server/_core/index.ts` — Helmet COOP override + CSP allowlist (Tasks 9 + 10)
- `server/_core/stripeWebhook.ts` — add `customer.subscription.updated` + `invoice.payment_failed` handlers (Tasks 14 + 15)
- `server/stripe-integration.ts` — Stripe API version pin (Task 12); also handler functions for the two new events
- `server/routers/goldenNotes.ts` — resolve `STRIPE_TEST2_KEY_STRIPE_SECRET_KEY` reference (Task 11)
- `server/auth.logout.test.ts` — change `loginMethod: "manus"` → `"supabase"` (Step 6)
- `api-src/stripe/webhook.ts` — add `maxDuration: 30` to config (Task 13)
- `.env.example` — remove Manus OAuth lines 41–48 (Step 3)
- `.gitignore` — add `.manus/` and `.manus-logs/` (Step 5)
- `package.json` — remove `vite-plugin-manus-runtime` from devDependencies (Step 4)
- `vite.config.ts` — remove `vitePluginManusRuntime` import + `vitePluginManusDebugCollector` + Manus domain allowlist (Step 4)
- `server/app-router.ts` — remove legacy `clearCookie` block (lines 35–41) (Step 3)
- `server/_core/llm.ts` — remove `forge.manus.im` fallback (Step 6)
- `server/_core/notification.ts`, `server/storage.ts`, `server/_core/map.ts` — fix stale Manus docstrings (Step 6)

### Files to create

- `server/stripe.webhook-signature.test.ts` (Task 16)
- `server/stripe.subscription-checkout.test.ts` (Task 17)
- `server/auth.first-signin-user-row.test.ts` (Task 18)
- `docs/oauth-and-stripe-go-live-2026-05-08.md` — combined runbook deliverable (Task 20)
- `/memory/security-scan-2026-05-08-baseline.md` — Wave 0 output (Task 1)
- `/memory/security-scan-2026-05-08-final.md` — Wave 4 output (Task 23)

---

## Wave 0 — Pre-flight security scan

### Task 1: Dispatch baseline security scan (parallel subagents)

**Files:**
- Create: `/memory/security-scan-2026-05-08-baseline.md`

- [ ] **Step 1: Dispatch `Security Engineer` and `Compliance Auditor` in parallel via `Agent` tool**

Each subagent must be told: read-only against current `main`; never echo `.env` values, secret strings, JWTs, or full webhook payloads in findings; cite `file:line` not value content.

`Security Engineer` lane prompt should specify:
- AuthN/AuthZ on every tRPC procedure and Express route
- Input validation (zod schemas)
- Session integrity (Supabase JWT, cookie flags, CSRF)
- Webhook signature verification unconditional; raw-body upstream of JSON parser; idempotency table integrity; 308 redirect probe of webhook URL
- Helmet config audit (specifically COOP default and CSP gaps for Supabase + Stripe)
- CORS allowlist correctness; HSTS `includeSubDomains`
- Rate limiting on auth, OTP, checkout, password reset
- Secret-leak scan (hardcoded keys, secrets in logs/error messages)
- OWASP top-10 walkthrough

`Compliance Auditor` lane prompt should specify:
- Stripe webhook event allowlist; refund/dispute handling; subscription state machine; idempotency under replay; PCI scope (SAQ-A confirmation); customer dedup pattern; API version pinning
- Supabase RLS coverage; service-role key isolation; Auth version ≥ v2.176.1
- OAuth provider trust (state validation, PKCE, redirect-URI matching, no open-redirect via `next` params, Apple private-relay handling, first-sign-in name capture, email-collision identity-linking — specifically trace whether `public.users` provisioning at [server/_core/supabase-auth.ts:79-118](../../server/_core/supabase-auth.ts#L79-L118) handles a Google-sign-in-over-existing-email/password case)
- Data lifecycle, logging hygiene, `.env.example` currency
- Vercel env-var scoping (live secrets Production-only and marked Sensitive)
- Supabase rate-limit IP forwarding (`Sb-Forwarded-For`) — currently behind Vercel/Express, all OAuth attempts share one IP
- `pnpm audit` for known-vuln deps

Severity rubric: Critical = remote code exec / auth bypass / payment bypass. High = privilege escalation / PII leak / webhook forgery. Medium = info disclosure / DoS / weak headers. Low = hygiene. Info = posture observation.

- [ ] **Step 2: Consolidate findings into `/memory/security-scan-2026-05-08-baseline.md`**

Format: methodology, findings table (`ID | Severity | Title | Location | Status`), per-finding detail (description, attack scenario, suggested fix, evidence file:line), severity rubric, coverage gaps.

- [ ] **Step 3: Surface Critical/High findings to user**

Present as a numbered list with proposed disposition for each:
- Critical → "fix in Task 19" (no exception)
- High → "fix in Task 19 if mechanical" or "needs your decision before Wave 2 — [details]"
- Medium → "batch into Task 19" or "defer with todo.md entry"

Wait for user disposition before starting Task 2.

- [ ] **Step 4: Commit the baseline report**

```bash
git add memory/security-scan-2026-05-08-baseline.md
git commit -m "chore(security): baseline scan report 2026-05-08"
```

---

## Wave 1 — Code-side work

### Manus removal — Steps in dependency order

> **Important:** Tasks 2–7 must execute in order. Each step's deletion exposes the next set of orphans. After each task's commit, run `pnpm build` and `pnpm test` to verify no breakage before moving on. If a step breaks the build, revert that step (`git reset --hard HEAD~1`) and investigate.

### Task 2: Manus removal Step 1 — top-level dead callers

**Files:**
- Delete: `server/_core/oauth.ts`
- Delete: `client/src/components/ManusDialog.tsx`
- Modify: `client/src/pages/Lobby.tsx:51` — replace Manus portal redirect with `/signin` redirect

- [ ] **Step 1: Verify nothing imports `oauth.ts` or `ManusDialog.tsx`**

```bash
grep -rn "from.*oauth['\"]" server/ client/ shared/ api-src/ 2>&1 | grep -v "supabase-auth\|node_modules"
grep -rn "ManusDialog" server/ client/ shared/ api-src/ 2>&1 | grep -v node_modules
```

Expected: no matches outside `oauth.ts`/`ManusDialog.tsx` themselves.

- [ ] **Step 2: Read [client/src/pages/Lobby.tsx](../../client/src/pages/Lobby.tsx) lines 40–60 to see the surrounding redirect logic**

- [ ] **Step 3: Replace the Manus portal redirect**

Change [client/src/pages/Lobby.tsx:51](../../client/src/pages/Lobby.tsx#L51) (the `window.location.href = ${VITE_OAUTH_PORTAL_URL}/app-auth?...` line) to a redirect to `/signin`:

```typescript
// Before
window.location.href = `${import.meta.env.VITE_OAUTH_PORTAL_URL}/app-auth?appId=${import.meta.env.VITE_APP_ID}&redirectUri=${encodeURIComponent(window.location.href)}`;

// After
window.location.href = "/signin";
```

- [ ] **Step 4: Delete the dead files**

```bash
rm server/_core/oauth.ts
rm client/src/components/ManusDialog.tsx
```

- [ ] **Step 5: Verify build passes**

```bash
pnpm build
```
Expected: clean build. If it fails, the import grep in Step 1 missed something — revisit.

- [ ] **Step 6: Verify tests pass**

```bash
pnpm test
```
Expected: green.

- [ ] **Step 7: Commit**

```bash
git add server/_core/oauth.ts client/src/components/ManusDialog.tsx client/src/pages/Lobby.tsx
git commit -m "chore(manus): remove dead OAuth callback, ManusDialog, and Lobby Manus redirect"
```

---

### Task 3: Manus removal Step 2 — orphaned SDK + types

**Files:**
- Delete: `server/_core/sdk.ts`
- Delete: `server/_core/types/manusTypes.ts`

- [ ] **Step 1: Verify nothing imports `sdk` or `manusTypes`**

```bash
grep -rn "from.*sdk['\"]" server/ shared/ api-src/ 2>&1 | grep -v node_modules
grep -rn "manusTypes" server/ shared/ api-src/ 2>&1 | grep -v node_modules
grep -rn "exchangeCodeForToken\|createSessionToken\|verifySession" server/ shared/ api-src/ 2>&1 | grep -v node_modules
```

Expected: no matches outside the files being deleted. Task 2 must have completed first; if `oauth.ts` still exists, stop and complete Task 2.

- [ ] **Step 2: Delete the files**

```bash
rm server/_core/sdk.ts
rm server/_core/types/manusTypes.ts
# Remove the empty types/ directory if no other files remain
rmdir server/_core/types 2>/dev/null || true
```

- [ ] **Step 3: Verify build + tests pass**

```bash
pnpm build && pnpm test
```

- [ ] **Step 4: Commit**

```bash
git add -A server/_core/sdk.ts server/_core/types/manusTypes.ts server/_core/types/
git commit -m "chore(manus): remove orphaned SDK client and proto types"
```

---

### Task 4: Manus removal Step 3 — env vars + legacy cookie

**Files:**
- Modify: `.env.example` (remove lines 41–48, the Manus OAuth block)
- Modify: `server/app-router.ts:35-41` (remove legacy `clearCookie` block)
- Modify: `server/_core/env.ts` if it exists and reads any of the legacy vars

- [ ] **Step 1: Inspect `.env.example` lines 35–55 to confirm the block to delete**

```bash
sed -n '35,55p' .env.example
```

Expected to see (lines 41–48):
```
# Manus OAuth. Leave blank in dev if DEV_AUTH_BYPASS=1. Will be removed
VITE_APP_ID=
VITE_OAUTH_PORTAL_URL=
OAUTH_SERVER_URL=
OWNER_OPEN_ID=
JWT_SECRET=change-me-to-a-random-32-char-string
```

- [ ] **Step 2: Delete the block from `.env.example`**

Use Edit tool to remove the comment line and all 5 var lines. Leave one blank line where the block was.

- [ ] **Step 3: Check for `env.ts` and clean any legacy-var reads**

```bash
test -f server/_core/env.ts && cat server/_core/env.ts || echo "env.ts not found"
```

If `env.ts` reads `VITE_APP_ID`, `OAUTH_SERVER_URL`, `OWNER_OPEN_ID`, `JWT_SECRET`, or `cookieSecret`, remove those entries (and any types referencing them).

- [ ] **Step 4: Read [server/app-router.ts](../../server/app-router.ts) lines 30–50 to see the legacy `clearCookie` block**

- [ ] **Step 5: Remove the legacy `clearCookie` block**

The block (around lines 35–41) reads something like "Best-effort clear of the legacy Manus-OAuth session cookie" and references `COOKIE_NAME` / `JWT_SECRET`. Remove the entire block including its comment header.

- [ ] **Step 6: Verify build + tests pass**

```bash
pnpm build && pnpm test
```

- [ ] **Step 7: Commit**

```bash
git add .env.example server/app-router.ts server/_core/env.ts
git commit -m "chore(manus): drop Manus OAuth env vars and legacy session-cookie clearing"
```

- [ ] **Step 8: Note for user — manual Vercel cleanup**

Surface to user (do not perform): "Please remove `VITE_APP_ID`, `VITE_OAUTH_PORTAL_URL`, `OAUTH_SERVER_URL`, `OWNER_OPEN_ID`, and `JWT_SECRET` from Vercel Project Settings → Environment Variables (Production + Preview + Development). I cannot do this for you."

---

### Task 5: Manus removal Step 4 — Vite plugin + debug collector

**Files:**
- Modify: `package.json` (remove `vite-plugin-manus-runtime` from devDependencies)
- Modify: `vite.config.ts` (remove `vitePluginManusRuntime` import + `vitePluginManusDebugCollector` definition + Manus domain allowlist)
- Delete: `client/public/__manus__/debug-collector.js`
- Delete: `ios/App/App/public/__manus__/debug-collector.js`
- Delete: `android/app/src/main/assets/public/__manus__/debug-collector.js`
- Delete: `dist/public/__manus__/debug-collector.js` (if present)

- [ ] **Step 1: Read [vite.config.ts](../../vite.config.ts) end-to-end**

Identify three things:
- The `vitePluginManusRuntime` import (top of file)
- The `vitePluginManusDebugCollector()` plugin definition (~lines 7–150)
- The Manus domain allowlist in the dev-server `allowedHosts` array (`*.manuspre.computer`, `*.manus.computer`, `*.manus-asia.computer`, `*.manuscomputer.ai`, `*.manusvm.computer`)

- [ ] **Step 2: Edit `vite.config.ts` to remove all three**

Remove:
- The `import vitePluginManusRuntime from "vite-plugin-manus-runtime";` line
- The `vitePluginManusDebugCollector()` function definition (entire function block)
- Any reference to `vitePluginManusDebugCollector()` and `vitePluginManusRuntime()` in the `plugins: [...]` array
- The five Manus domains from `allowedHosts`

- [ ] **Step 3: Remove `vite-plugin-manus-runtime` from `package.json`**

Edit `package.json` line 122 (devDependencies) to delete:
```json
"vite-plugin-manus-runtime": "^0.0.57",
```

- [ ] **Step 4: Delete the debug-collector.js copies**

```bash
rm client/public/__manus__/debug-collector.js
rm ios/App/App/public/__manus__/debug-collector.js
rm android/app/src/main/assets/public/__manus__/debug-collector.js
rm -f dist/public/__manus__/debug-collector.js
# Remove now-empty __manus__ directories
rmdir client/public/__manus__ ios/App/App/public/__manus__ android/app/src/main/assets/public/__manus__ 2>/dev/null || true
```

- [ ] **Step 5: Reinstall dependencies**

```bash
pnpm install
```
Expected: `vite-plugin-manus-runtime` removed from `pnpm-lock.yaml`.

- [ ] **Step 6: Clean build**

```bash
pnpm build
```
Expected: clean build with no Manus references.

- [ ] **Step 7: Run tests**

```bash
pnpm test
```

- [ ] **Step 8: Commit**

```bash
git add package.json pnpm-lock.yaml vite.config.ts client/public/ ios/App/App/public/ android/app/src/main/assets/public/
git commit -m "chore(manus): remove Vite plugin, debug collector, and host allowlist"
```

---

### Task 6: Manus removal Step 5 — diagnostic directories

**Files:**
- Delete: `.manus/`
- Delete: `.manus-logs/`
- Modify: `.gitignore` (add `.manus/` and `.manus-logs/`)

- [ ] **Step 1: Delete the directories**

```bash
rm -rf .manus .manus-logs
```

- [ ] **Step 2: Add to `.gitignore`**

Read `.gitignore`. If `.manus/` and `.manus-logs/` are not already listed, append:

```
# Manus diagnostic directories — should not be created post-removal
.manus/
.manus-logs/
```

- [ ] **Step 3: Verify build + tests still pass**

```bash
pnpm build && pnpm test
```

- [ ] **Step 4: Commit**

```bash
git add -A .gitignore .manus .manus-logs
git commit -m "chore(manus): delete diagnostic dirs and gitignore them"
```

---

### Task 7: Manus removal Step 6 — stale comments + Forge URL

**Files:**
- Modify: `server/_core/notification.ts` (stale docstring referencing "Manus Notification Service")
- Modify: `server/storage.ts` (stale "Manus WebDev Templates" comment)
- Modify: `server/_core/map.ts` (stale "Manus WebDev Templates" comment)
- Modify: `server/_core/llm.ts:215` (remove `forge.manus.im` fallback)
- Modify: `server/auth.logout.test.ts:21` (`loginMethod: "manus"` → `"supabase"`)

- [ ] **Step 1: Fix stale docstrings**

For each of `server/_core/notification.ts`, `server/storage.ts`, `server/_core/map.ts`, read the top docstring and rewrite to describe the file's actual purpose. Drop "Manus" / "Manus WebDev Templates" wording. Keep edits minimal — only change the leading comment.

- [ ] **Step 2: Read [server/_core/llm.ts](../../server/_core/llm.ts) lines 205–225**

Confirm the line at ~215 is a fallback to `https://forge.manus.im/v1/chat/completions` when `BUILT_IN_FORGE_API_URL` is unset.

- [ ] **Step 3: Remove the Manus URL fallback**

Replace the conditional that falls back to `forge.manus.im` with a strict check that throws if `BUILT_IN_FORGE_API_URL` is not set:

```typescript
// Before (around line 215)
const url = process.env.BUILT_IN_FORGE_API_URL
  ? `${process.env.BUILT_IN_FORGE_API_URL}/v1/chat/completions`
  : "https://forge.manus.im/v1/chat/completions";

// After
const url = process.env.BUILT_IN_FORGE_API_URL;
if (!url) {
  throw new Error("BUILT_IN_FORGE_API_URL not configured");
}
const fullUrl = `${url}/v1/chat/completions`;
```

(Adapt to whatever variable name and surrounding flow the file actually uses.)

- [ ] **Step 4: Update test fixture in `server/auth.logout.test.ts`**

Change line 21 (`loginMethod: "manus"`) to `loginMethod: "supabase"`.

- [ ] **Step 5: Verify build + tests pass**

```bash
pnpm build && pnpm test
```

- [ ] **Step 6: Commit**

```bash
git add server/_core/notification.ts server/storage.ts server/_core/map.ts server/_core/llm.ts server/auth.logout.test.ts
git commit -m "chore(manus): fix stale docstrings, drop forge.manus.im fallback, update test fixture"
```

> **Manus removal complete.** Re-run a final grep to confirm clean state:
> ```bash
> grep -rni "manus" --include="*.ts" --include="*.tsx" --include="*.json" --include="*.md" --include="*.example" server/ client/ shared/ api-src/ scripts/ .env.example .gitignore vite.config.ts package.json | grep -v node_modules | grep -v pnpm-lock | grep -v "Co-Authored\|CHANGELOG\|todo.md\|docs/superpowers"
> ```
> Expected: no results, or only intentional historical references in CHANGELOG/todo/docs.

---

### Task 8: Apple `name email` scope + first-sign-in profile capture

**Files:**
- Test: `client/src/pages/SignIn.apple-scope.test.tsx` (new)
- Modify: `client/src/pages/SignIn.tsx:122-140` (signInWith function)
- Test: `client/src/lib/auth-profile-capture.test.ts` (new)
- Create: `client/src/lib/auth-profile-capture.ts` (new — reusable handler)
- Modify: wherever the SignIn flow registers an `onAuthStateChange` listener (likely in App.tsx or a top-level provider; locate via grep)

- [ ] **Step 1: Locate where `onAuthStateChange` is currently registered**

```bash
grep -rn "onAuthStateChange" client/src 2>&1 | grep -v node_modules
```

Note the file and surrounding component for Step 5 wiring.

- [ ] **Step 2: Write failing test for the `signInWith('apple')` scope**

Create `client/src/pages/SignIn.apple-scope.test.tsx`. Mock `supabase.auth.signInWithOAuth`; render SignIn; click Apple button; assert call args include `options.scopes === 'name email'`.

```typescript
import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import SignIn from "./SignIn";

const signInWithOAuth = vi.fn().mockResolvedValue({ error: null });
vi.mock("@/lib/supabase", () => ({
  supabase: { auth: { signInWithOAuth } },
}));

describe("SignIn — Apple OAuth scopes", () => {
  it("requests 'name email' scopes when signing in with Apple", async () => {
    render(<SignIn />);
    fireEvent.click(screen.getByRole("button", { name: /apple/i }));
    expect(signInWithOAuth).toHaveBeenCalledWith(
      expect.objectContaining({
        provider: "apple",
        options: expect.objectContaining({ scopes: "name email" }),
      })
    );
  });

  it("does NOT request 'name email' scopes when signing in with Google", async () => {
    render(<SignIn />);
    fireEvent.click(screen.getByRole("button", { name: /google/i }));
    expect(signInWithOAuth).toHaveBeenCalledWith(
      expect.objectContaining({
        provider: "google",
        options: expect.not.objectContaining({ scopes: expect.anything() }),
      })
    );
  });
});
```

- [ ] **Step 3: Run test, verify it fails**

```bash
pnpm test client/src/pages/SignIn.apple-scope.test.tsx
```
Expected: FAIL — `signInWithOAuth` called without `scopes`.

- [ ] **Step 4: Modify `signInWith` in `SignIn.tsx`**

At [client/src/pages/SignIn.tsx:128-131](../../client/src/pages/SignIn.tsx#L128), branch on provider:

```typescript
const oauthOptions: { redirectTo: string; scopes?: string } = { redirectTo };
if (provider === "apple") {
  // Apple ONLY returns the user's name on first authorization, and only if
  // the 'name' scope is requested. Subsequent sign-ins omit name claims.
  oauthOptions.scopes = "name email";
}
const { error } = await supabase.auth.signInWithOAuth({
  provider,
  options: oauthOptions,
});
```

- [ ] **Step 5: Run test, verify it passes**

```bash
pnpm test client/src/pages/SignIn.apple-scope.test.tsx
```
Expected: PASS (both cases).

- [ ] **Step 6: Write failing test for first-sign-in profile capture**

Create `client/src/lib/auth-profile-capture.test.ts`:

```typescript
import { describe, it, expect, vi, beforeEach } from "vitest";
import { handleFirstSignInProfile } from "./auth-profile-capture";

const updateUser = vi.fn().mockResolvedValue({ data: {}, error: null });
const supabase = { auth: { updateUser } } as any;

describe("handleFirstSignInProfile", () => {
  beforeEach(() => {
    updateUser.mockClear();
    localStorage.clear();
  });

  it("captures full_name from Apple user_metadata on first sign-in", async () => {
    const session = {
      user: {
        id: "user-123",
        user_metadata: { full_name: "Jane Doe" },
        app_metadata: { provider: "apple" },
      },
    };
    await handleFirstSignInProfile(session as any, supabase);
    expect(updateUser).toHaveBeenCalledWith({ data: { full_name: "Jane Doe" } });
  });

  it("constructs full_name from given_name + family_name when not provided", async () => {
    const session = {
      user: {
        id: "user-456",
        user_metadata: { given_name: "John", family_name: "Smith" },
        app_metadata: { provider: "apple" },
      },
    };
    await handleFirstSignInProfile(session as any, supabase);
    expect(updateUser).toHaveBeenCalledWith({ data: { full_name: "John Smith" } });
  });

  it("does NOT call updateUser if user has already been profile-captured (localStorage flag)", async () => {
    localStorage.setItem("profile-captured-user-789", "1");
    const session = {
      user: {
        id: "user-789",
        user_metadata: { full_name: "Repeat User" },
        app_metadata: { provider: "apple" },
      },
    };
    await handleFirstSignInProfile(session as any, supabase);
    expect(updateUser).not.toHaveBeenCalled();
  });

  it("does NOT call updateUser when user_metadata has no name (subsequent Apple sign-in)", async () => {
    const session = {
      user: {
        id: "user-321",
        user_metadata: {},
        app_metadata: { provider: "apple" },
      },
    };
    await handleFirstSignInProfile(session as any, supabase);
    expect(updateUser).not.toHaveBeenCalled();
  });

  it("does nothing for non-Apple providers", async () => {
    const session = {
      user: {
        id: "user-555",
        user_metadata: { full_name: "Google User" },
        app_metadata: { provider: "google" },
      },
    };
    await handleFirstSignInProfile(session as any, supabase);
    expect(updateUser).not.toHaveBeenCalled();
  });
});
```

- [ ] **Step 7: Run test, verify it fails**

```bash
pnpm test client/src/lib/auth-profile-capture.test.ts
```
Expected: FAIL — module does not exist.

- [ ] **Step 8: Create `client/src/lib/auth-profile-capture.ts`**

```typescript
import type { Session, SupabaseClient } from "@supabase/supabase-js";

// Apple returns the user's name only on the first authorization. We capture
// it once into auth.users.user_metadata.full_name so subsequent sign-ins
// (which omit the name claim) don't lose it. Idempotent via a localStorage
// flag — this is best-effort UX, not security.
export async function handleFirstSignInProfile(
  session: Session,
  supabase: SupabaseClient
): Promise<void> {
  const provider = session.user.app_metadata?.provider;
  if (provider !== "apple") return;

  const flagKey = `profile-captured-${session.user.id}`;
  if (typeof localStorage !== "undefined" && localStorage.getItem(flagKey)) return;

  const meta = session.user.user_metadata ?? {};
  const fullName =
    meta.full_name ??
    [meta.given_name, meta.family_name].filter(Boolean).join(" ").trim();

  if (!fullName) return;

  await supabase.auth.updateUser({ data: { full_name: fullName } });
  if (typeof localStorage !== "undefined") localStorage.setItem(flagKey, "1");
}
```

- [ ] **Step 9: Run test, verify it passes**

```bash
pnpm test client/src/lib/auth-profile-capture.test.ts
```
Expected: PASS (5 cases).

- [ ] **Step 10: Wire `handleFirstSignInProfile` into the existing `onAuthStateChange` listener**

At the location identified in Step 1, on `SIGNED_IN` events, call `handleFirstSignInProfile(session, supabase)`. Do not block other handlers; fire-and-forget with a `.catch` that logs a warning.

```typescript
import { handleFirstSignInProfile } from "@/lib/auth-profile-capture";
// inside the existing onAuthStateChange handler:
if (event === "SIGNED_IN" && session) {
  handleFirstSignInProfile(session, supabase).catch(err =>
    console.warn("[auth] profile capture failed:", err)
  );
}
```

- [ ] **Step 11: Build + run all tests**

```bash
pnpm build && pnpm test
```

- [ ] **Step 12: Commit**

```bash
git add client/src/pages/SignIn.tsx client/src/pages/SignIn.apple-scope.test.tsx client/src/lib/auth-profile-capture.ts client/src/lib/auth-profile-capture.test.ts
# also add the wiring location identified in Step 1
git commit -m "feat(auth): Apple sign-in requests name+email scopes; capture full_name on first sign-in"
```

---

### Task 9: Helmet COOP override

**Files:**
- Modify: `server/_core/index.ts:50-55`

- [ ] **Step 1: Read [server/_core/index.ts](../../server/_core/index.ts) lines 45–60 to confirm current Helmet config**

Current state:
```typescript
app.use(
  helmet({
    contentSecurityPolicy: isProd ? undefined : false,
    crossOriginEmbedderPolicy: false,
  })
);
```

- [ ] **Step 2: Add COOP override**

Modify the helmet call to:

```typescript
app.use(
  helmet({
    contentSecurityPolicy: isProd ? undefined : false,
    crossOriginEmbedderPolicy: false,
    // Default 'same-origin' breaks Google/Apple OAuth popup flows. The OAuth
    // round-trip needs window.opener access for some browsers' postMessage
    // path. 'same-origin-allow-popups' keeps isolation for non-popup pages.
    crossOriginOpenerPolicy: { policy: "same-origin-allow-popups" },
  })
);
```

- [ ] **Step 3: Verify build + tests pass**

```bash
pnpm build && pnpm test
```

- [ ] **Step 4: Manual smoke check (locally)**

```bash
pnpm dev
```

Open `http://localhost:3000/signin` in a browser, open DevTools → Network, click Google or Apple. Confirm the OAuth round-trip starts (do not need to complete it — providers won't be configured yet). No console errors about COOP.

- [ ] **Step 5: Commit**

```bash
git add server/_core/index.ts
git commit -m "fix(headers): override Cross-Origin-Opener-Policy to allow OAuth popups"
```

---

### Task 10: CSP allowlist for Supabase + Stripe

**Files:**
- Modify: `server/_core/index.ts:50-60` (Helmet block)

- [ ] **Step 1: Build the CSP directive object**

Use `useDefaults: true` to keep Helmet's secure base; add directives for Supabase and Stripe. Start with `reportOnly: true` for the first prod deploy to surface violations without breaking the app.

```typescript
const supabaseRef = process.env.VITE_SUPABASE_PROJECT_URL ?? "";
const supabaseHost = supabaseRef.replace(/^https?:\/\//, "").replace(/\/$/, "");

const cspDirectives = isProd
  ? {
      useDefaults: true,
      directives: {
        "connect-src": [
          "'self'",
          supabaseHost ? `https://${supabaseHost}` : "",
          "https://api.stripe.com",
        ].filter(Boolean),
        "script-src": ["'self'", "https://js.stripe.com"],
        "frame-src": [
          "'self'",
          "https://js.stripe.com",
          "https://hooks.stripe.com",
          "https://checkout.stripe.com",
        ],
        "img-src": ["'self'", "data:", "https://*.stripe.com"],
      },
      reportOnly: true,
    }
  : false;
```

- [ ] **Step 2: Apply the CSP config to the helmet call**

```typescript
app.use(
  helmet({
    contentSecurityPolicy: cspDirectives,
    crossOriginEmbedderPolicy: false,
    crossOriginOpenerPolicy: { policy: "same-origin-allow-popups" },
  })
);
```

- [ ] **Step 3: Build + tests**

```bash
pnpm build && pnpm test
```

- [ ] **Step 4: Commit**

```bash
git add server/_core/index.ts
git commit -m "feat(headers): CSP allowlist for Supabase Auth + Stripe (reportOnly)"
```

- [ ] **Step 5: Note for follow-up**

Add a one-line entry to `todo.md` (create the file if missing): `- [ ] Switch CSP from reportOnly to enforcing after one production deploy with no violations observed in browser console / report endpoint.`

```bash
# If todo.md doesn't exist, create with a minimal header
test -f todo.md || echo "# TODO" > todo.md
echo "" >> todo.md
echo "- [ ] Switch CSP from reportOnly to enforcing after one production deploy with no violations observed in browser console / report endpoint." >> todo.md
git add todo.md
git commit -m "chore(todo): track CSP enforcing-mode switch"
```

---

### Task 11: Resolve `STRIPE_TEST2_KEY_STRIPE_SECRET_KEY` reference

**Context:** [server/routers/goldenNotes.ts:113-116](../../server/routers/goldenNotes.ts#L113-L116) implements an admin-only test-mode branch. The env var name `STRIPE_TEST2_KEY_STRIPE_SECRET_KEY` looks like an accidental concat (likely a stray prefix). Two viable resolutions; **surface to user and let them pick** before implementing.

- [ ] **Step 1: Read the surrounding code**

[server/routers/goldenNotes.ts](../../server/routers/goldenNotes.ts) lines 100–130. Confirm the admin-test-mode branch is the only consumer of `STRIPE_TEST2_KEY_STRIPE_SECRET_KEY`.

```bash
grep -rn "STRIPE_TEST2_KEY" --include="*.ts" --include="*.tsx" --include="*.example" --include="*.json" 2>&1 | grep -v node_modules
```

- [ ] **Step 2: Surface decision to user**

Present:
> The `STRIPE_TEST2_KEY_STRIPE_SECRET_KEY` reference at [server/routers/goldenNotes.ts:115](../../server/routers/goldenNotes.ts#L115) is an admin-only test-mode escape hatch (admins hit Stripe test mode while everyone else hits live keys). Two options:
>
> **(A) Rename to a clean env var.** Change to `STRIPE_ADMIN_TEST_SECRET_KEY`, document its purpose in `.env.example` (commented out by default). Admins can set this when they want to test Stripe flows without spending real money.
>
> **(B) Remove the admin test-mode branch entirely.** Admins use Stripe Dashboard refunds to reverse real charges, like everyone else. Simpler code, one less env var.
>
> My recommendation: **(B)** — the branch adds complexity for a rare workflow, and admins can self-refund.
>
> Which option?

- [ ] **Step 3 — IF user picks (A): rename**

Edit [server/routers/goldenNotes.ts:113-116](../../server/routers/goldenNotes.ts#L113):
```typescript
// Before
const useTestMode = ctx.user.role === "admin";
const key = useTestMode
  ? (process.env.STRIPE_TEST2_KEY_STRIPE_SECRET_KEY ?? process.env.STRIPE_SECRET_KEY)
  : process.env.STRIPE_SECRET_KEY;

// After
const useAdminTestMode = ctx.user.role === "admin" && process.env.STRIPE_ADMIN_TEST_SECRET_KEY;
const key = useAdminTestMode
  ? process.env.STRIPE_ADMIN_TEST_SECRET_KEY
  : process.env.STRIPE_SECRET_KEY;
```

Add to `.env.example` (in the Stripe section):
```
# Optional: admin-only test-mode override. When set, users with role='admin'
# hit Stripe test mode for golden-notes purchases (so admins can validate the
# checkout flow without spending real money). Leave unset in production.
# STRIPE_ADMIN_TEST_SECRET_KEY=sk_test_xxxxxxxx
```

- [ ] **Step 3 — IF user picks (B): remove**

Edit [server/routers/goldenNotes.ts:113-116](../../server/routers/goldenNotes.ts#L113):
```typescript
// Before
const useTestMode = ctx.user.role === "admin";
const key = useTestMode
  ? (process.env.STRIPE_TEST2_KEY_STRIPE_SECRET_KEY ?? process.env.STRIPE_SECRET_KEY)
  : process.env.STRIPE_SECRET_KEY;

// After
const key = process.env.STRIPE_SECRET_KEY;
```

Also remove the comment on lines 111–112 ("Admins hit Stripe test mode...").

- [ ] **Step 4: Build + tests**

```bash
pnpm build && pnpm test
```

- [ ] **Step 5: Commit**

For (A):
```bash
git add server/routers/goldenNotes.ts .env.example
git commit -m "fix(stripe): rename admin test-mode env var to STRIPE_ADMIN_TEST_SECRET_KEY"
```

For (B):
```bash
git add server/routers/goldenNotes.ts
git commit -m "refactor(stripe): remove admin test-mode branch from golden-notes checkout"
```

---

### Task 12: Stripe API version pin

**Files:**
- Test: `server/stripe.api-version.test.ts` (new)
- Modify: `server/stripe-integration.ts:3`

- [ ] **Step 1: Look up current Stripe API version**

```bash
grep -rn "Stripe.LATEST_API_VERSION\|apiVersion" node_modules/stripe/types/lib.d.ts 2>&1 | head -5
```

Or check Stripe's release notes via `pnpm view stripe@22 description`. The current pinned version as of mid-2025 is `2025-09-30.clover`. Use whatever the SDK 22.0.1 ships with as the default — **pin explicitly to that string** so future `stripe` SDK upgrades don't silently change behavior.

- [ ] **Step 2: Write failing test**

Create `server/stripe.api-version.test.ts`:

```typescript
import { describe, it, expect } from "vitest";
import Stripe from "stripe";

describe("Stripe SDK initialization", () => {
  it("pins apiVersion (does not float)", async () => {
    const mod = await import("./stripe-integration");
    // Surface the configured apiVersion. We re-construct from the SDK's
    // exposed default to ensure stripe-integration.ts uses an explicit
    // pin rather than letting the SDK float to its current default.
    const integration = await import("./stripe-integration") as Record<string, unknown>;
    // The Stripe instance is module-scoped; we infer the pin by checking
    // whether stripe-integration.ts source contains an apiVersion option.
    const fs = await import("node:fs");
    const src = fs.readFileSync("server/stripe-integration.ts", "utf8");
    expect(src).toMatch(/new Stripe\([^)]*\{\s*apiVersion:\s*["'`][\d-]+(\.[a-z]+)?["'`]/);
  });
});
```

- [ ] **Step 3: Run test, verify it fails**

```bash
pnpm test server/stripe.api-version.test.ts
```
Expected: FAIL — current source is `new Stripe(process.env.STRIPE_SECRET_KEY || "")` with no apiVersion.

- [ ] **Step 4: Pin the apiVersion**

Edit [server/stripe-integration.ts:3](../../server/stripe-integration.ts#L3):

```typescript
// Before
const stripe = new Stripe(process.env.STRIPE_SECRET_KEY || "");

// After — pin to the version the SDK was built/tested against. Update
// deliberately when migrating; do not let SDK upgrades drift this.
const stripe = new Stripe(process.env.STRIPE_SECRET_KEY || "", {
  apiVersion: "2025-09-30.clover",
});
```

(If the version string mismatches what SDK 22.0.1 expects, TypeScript will error at compile time — adjust to whichever exact string the SDK declares in its `Stripe.LatestApiVersion` type. Run `pnpm check` to see the valid options.)

- [ ] **Step 5: Run test, verify it passes**

```bash
pnpm test server/stripe.api-version.test.ts
pnpm check
```
Expected: PASS, no TS errors.

- [ ] **Step 6: Commit**

```bash
git add server/stripe-integration.ts server/stripe.api-version.test.ts
git commit -m "feat(stripe): pin apiVersion to prevent SDK-upgrade drift"
```

---

### Task 13: Webhook `maxDuration: 30`

**Files:**
- Modify: `api-src/stripe/webhook.ts:7-14`

- [ ] **Step 1: Read [api-src/stripe/webhook.ts](../../api-src/stripe/webhook.ts) (the entire file is ~46 lines)**

Current `config` export:
```typescript
export const config = {
  api: {
    bodyParser: false,
  },
  runtime: "nodejs",
};
```

- [ ] **Step 2: Add `maxDuration: 30` to config**

```typescript
export const config = {
  api: {
    bodyParser: false,
  },
  runtime: "nodejs",
  // Stripe retries after ~20s without 2xx. Cold-start + raw-body parse +
  // signature verify + DB writes can approach the default lambda timeout.
  // 30s gives headroom while staying well under Stripe's retry threshold.
  maxDuration: 30,
};
```

- [ ] **Step 3: Verify the bundled api/ output regenerates correctly**

```bash
node scripts/build-api.mjs
ls -la api/stripe/webhook.mjs
```
Expected: `webhook.mjs` regenerated, recent timestamp.

- [ ] **Step 4: Build + tests**

```bash
pnpm build && pnpm test
```

- [ ] **Step 5: Commit**

```bash
git add api-src/stripe/webhook.ts
git commit -m "fix(webhook): set maxDuration=30s to outrun Stripe retry threshold"
```

---

### Task 14: Add `customer.subscription.updated` event handler

**Files:**
- Test: `server/stripe.webhook-subscription-updated.test.ts` (new)
- Modify: `server/stripe-integration.ts` (add `handleCustomerSubscriptionUpdated` export)
- Modify: `server/_core/stripeWebhook.ts` (add case in switch + import)

- [ ] **Step 1: Write failing test**

Create `server/stripe.webhook-subscription-updated.test.ts`:

```typescript
import { describe, it, expect, vi } from "vitest";
import { handleCustomerSubscriptionUpdated } from "./stripe-integration";

describe("handleCustomerSubscriptionUpdated", () => {
  it("returns updated subscription state with status and tier", async () => {
    const subscription = {
      id: "sub_test_123",
      status: "past_due",
      current_period_end: 1893456000, // 2030-01-01
      items: {
        data: [{ price: { id: "price_pro_test" } }],
      },
      metadata: { tier: "pro", userId: "42" },
    } as any;

    const result = await handleCustomerSubscriptionUpdated(subscription);

    expect(result).toEqual({
      type: "subscription_updated",
      subscriptionId: "sub_test_123",
      status: "past_due",
      currentPeriodEnd: 1893456000,
      userId: 42,
      tier: "pro",
    });
  });

  it("handles status='active' transitions back from past_due", async () => {
    const subscription = {
      id: "sub_test_456",
      status: "active",
      current_period_end: 1893456000,
      items: { data: [{ price: { id: "price_player_test" } }] },
      metadata: { tier: "player", userId: "99" },
    } as any;

    const result = await handleCustomerSubscriptionUpdated(subscription);
    expect(result?.status).toBe("active");
    expect(result?.userId).toBe(99);
  });
});
```

- [ ] **Step 2: Run test, verify it fails**

```bash
pnpm test server/stripe.webhook-subscription-updated.test.ts
```
Expected: FAIL — `handleCustomerSubscriptionUpdated` not exported.

- [ ] **Step 3: Add the handler to `stripe-integration.ts`**

Append after `handleCustomerSubscriptionDeleted`:

```typescript
export async function handleCustomerSubscriptionUpdated(
  subscription: Stripe.Subscription
) {
  const meta = subscription.metadata ?? {};
  return {
    type: "subscription_updated" as const,
    subscriptionId: subscription.id,
    status: subscription.status,
    currentPeriodEnd: (subscription as any).current_period_end as number,
    userId: meta.userId ? parseInt(meta.userId) : undefined,
    tier: meta.tier,
  };
}
```

- [ ] **Step 4: Wire into the webhook switch**

In [server/_core/stripeWebhook.ts](../../server/_core/stripeWebhook.ts), add to the imports:
```typescript
import {
  // ...existing imports...
  handleCustomerSubscriptionUpdated,
} from "../stripe-integration";
```

Add a new case in the switch statement (after `customer.subscription.deleted` or wherever stylistically fits):

```typescript
case "customer.subscription.updated": {
  const subscription = event.data.object;
  const result = await handleCustomerSubscriptionUpdated(subscription);
  if (!result || !result.userId) break;
  console.log(
    `[Webhook] Subscription updated user=${result.userId} status=${result.status} sub=${redact(result.subscriptionId)}`
  );
  // Reflect status + period_end. updateSubscription signature is (userId, tier, stripeSubscriptionId, status?, currentPeriodEnd?) — extend if needed.
  await updateSubscription(
    result.userId,
    result.tier as "free" | "player" | "pro" | "elite",
    result.subscriptionId,
    result.status,
    new Date(result.currentPeriodEnd * 1000)
  );
  break;
}
```

> **Note:** if `updateSubscription` does not accept `status` / `currentPeriodEnd` parameters, extend its signature in `db-monetization.ts` first. Check before wiring.

- [ ] **Step 5: Run test, verify it passes**

```bash
pnpm test server/stripe.webhook-subscription-updated.test.ts
pnpm check
```
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add server/stripe-integration.ts server/_core/stripeWebhook.ts server/stripe.webhook-subscription-updated.test.ts server/db-monetization.ts
git commit -m "feat(webhook): handle customer.subscription.updated for status + plan changes"
```

---

### Task 15: Add `invoice.payment_failed` event handler

**Files:**
- Test: `server/stripe.webhook-payment-failed.test.ts` (new)
- Modify: `server/stripe-integration.ts` (add `handleInvoicePaymentFailed`)
- Modify: `server/_core/stripeWebhook.ts` (add case + import)

- [ ] **Step 1: Write failing test**

Create `server/stripe.webhook-payment-failed.test.ts`:

```typescript
import { describe, it, expect } from "vitest";
import { handleInvoicePaymentFailed } from "./stripe-integration";

describe("handleInvoicePaymentFailed", () => {
  it("returns past_due signal with subscription id", async () => {
    const invoice = {
      id: "in_test_777",
      subscription: "sub_test_777",
      amount_due: 999,
    } as any;
    const result = await handleInvoicePaymentFailed(invoice);
    expect(result).toEqual({
      type: "invoice_payment_failed",
      subscriptionId: "sub_test_777",
      invoiceId: "in_test_777",
      amountDue: 999,
    });
  });

  it("handles subscription as object instead of string", async () => {
    const invoice = {
      id: "in_test_888",
      subscription: { id: "sub_test_888" },
      amount_due: 1500,
    } as any;
    const result = await handleInvoicePaymentFailed(invoice);
    expect(result?.subscriptionId).toBe("sub_test_888");
  });
});
```

- [ ] **Step 2: Run test, verify it fails**

```bash
pnpm test server/stripe.webhook-payment-failed.test.ts
```
Expected: FAIL — `handleInvoicePaymentFailed` not exported.

- [ ] **Step 3: Add the handler**

Append to `server/stripe-integration.ts`:

```typescript
export async function handleInvoicePaymentFailed(invoice: Stripe.Invoice) {
  const subscriptionId = typeof (invoice as any).subscription === "string"
    ? (invoice as any).subscription
    : (invoice as any).subscription?.id;
  return {
    type: "invoice_payment_failed" as const,
    subscriptionId,
    invoiceId: invoice.id,
    amountDue: invoice.amount_due,
  };
}
```

- [ ] **Step 4: Wire into the webhook switch**

Import in [server/_core/stripeWebhook.ts](../../server/_core/stripeWebhook.ts):
```typescript
import {
  // ...existing imports...
  handleInvoicePaymentFailed,
} from "../stripe-integration";
```

Add a switch case:

```typescript
case "invoice.payment_failed": {
  const invoice = event.data.object;
  const result = await handleInvoicePaymentFailed(invoice);
  if (!result?.subscriptionId) break;
  console.log(
    `[Webhook] Invoice payment failed sub=${redact(result.subscriptionId)} due=${result.amountDue}`
  );
  // Mark past_due in our DB. Do NOT revoke access — Stripe Smart Retries
  // (configured via Dashboard) handles the dunning sequence; if all
  // retries fail, Stripe sends customer.subscription.deleted at which
  // point we revoke. This is intentional per spec §3.3 S2.
  await db
    .update(subscriptions)
    .set({ status: "past_due" })
    .where(eq(subscriptions.stripeSubscriptionId, result.subscriptionId));
  break;
}
```

(`db` and `subscriptions` are already imported at top of the file.)

- [ ] **Step 5: Run test, verify it passes**

```bash
pnpm test server/stripe.webhook-payment-failed.test.ts
pnpm check
```

- [ ] **Step 6: Commit**

```bash
git add server/stripe-integration.ts server/_core/stripeWebhook.ts server/stripe.webhook-payment-failed.test.ts
git commit -m "feat(webhook): handle invoice.payment_failed by marking subscription past_due"
```

---

### Task 16: Webhook signature 400 test

**Files:**
- Create: `server/stripe.webhook-signature.test.ts`

- [ ] **Step 1: Write the test**

```typescript
import { describe, it, expect, vi, beforeEach } from "vitest";
import type { Request, Response } from "express";
import { handleStripeWebhook } from "./_core/stripeWebhook";

describe("Stripe webhook signature verification", () => {
  beforeEach(() => {
    process.env.STRIPE_WEBHOOK_SECRET = "whsec_test_dummy";
  });

  function makeReqRes(body: Buffer, signature?: string) {
    const req = {
      headers: signature ? { "stripe-signature": signature } : {},
      body,
    } as unknown as Request;
    const res = {
      status: vi.fn().mockReturnThis(),
      json: vi.fn().mockReturnThis(),
    } as unknown as Response;
    return { req, res };
  }

  it("returns 400 when stripe-signature header is missing", async () => {
    const { req, res } = makeReqRes(Buffer.from("{}"));
    await handleStripeWebhook(req, res);
    expect(res.status).toHaveBeenCalledWith(400);
    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({ error: expect.stringMatching(/signature/i) })
    );
  });

  it("returns 400 when signature is invalid", async () => {
    const { req, res } = makeReqRes(
      Buffer.from(JSON.stringify({ id: "evt_test_anything" })),
      "t=1,v1=invalid"
    );
    await handleStripeWebhook(req, res);
    expect(res.status).toHaveBeenCalledWith(400);
  });

  it("returns 500 when STRIPE_WEBHOOK_SECRET is unset", async () => {
    delete process.env.STRIPE_WEBHOOK_SECRET;
    const { req, res } = makeReqRes(
      Buffer.from(JSON.stringify({ id: "evt_test_anything" })),
      "t=1,v1=anything"
    );
    await handleStripeWebhook(req, res);
    expect(res.status).toHaveBeenCalledWith(500);
  });
});
```

- [ ] **Step 2: Run test, verify it passes**

```bash
pnpm test server/stripe.webhook-signature.test.ts
```
Expected: PASS (3 cases) — the existing handler already returns 400/500 in these conditions; this test pins the behavior.

- [ ] **Step 3: Commit**

```bash
git add server/stripe.webhook-signature.test.ts
git commit -m "test(webhook): pin signature verification 400/500 contracts"
```

---

### Task 17: Subscription-checkout creation test

**Files:**
- Create: `server/stripe.subscription-checkout.test.ts`

- [ ] **Step 1: Write the test**

```typescript
import { describe, it, expect, vi, beforeEach } from "vitest";

const sessionsCreate = vi.fn().mockResolvedValue({
  id: "cs_test_xyz",
  url: "https://checkout.stripe.com/c/cs_test_xyz",
});

vi.mock("stripe", () => {
  const Stripe = vi.fn().mockImplementation(() => ({
    checkout: { sessions: { create: sessionsCreate } },
    webhooks: { constructEvent: vi.fn() },
  }));
  return { default: Stripe };
});

describe("createSubscriptionCheckout", () => {
  beforeEach(() => {
    sessionsCreate.mockClear();
    process.env.STRIPE_PRICE_PLAYER = "price_live_player_xxx";
    process.env.STRIPE_PRICE_PRO = "price_live_pro_xxx";
    process.env.STRIPE_PRICE_ELITE = "price_live_elite_xxx";
  });

  it("creates a subscription Checkout session with the correct price for player tier", async () => {
    const { createSubscriptionCheckout } = await import("./stripe-integration");
    await createSubscriptionCheckout(42, "user@example.com", "player", "https://playlyricpro.com");

    expect(sessionsCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        mode: "subscription",
        customer_email: "user@example.com",
        line_items: [
          expect.objectContaining({
            price: "price_live_player_xxx",
            quantity: 1,
          }),
        ],
        success_url: expect.stringContaining("https://playlyricpro.com/dashboard"),
        cancel_url: "https://playlyricpro.com/dashboard",
        client_reference_id: "42",
        allow_promotion_codes: true,
        metadata: expect.objectContaining({
          userId: "42",
          tier: "player",
          type: "subscription",
        }),
      })
    );
  });

  it("uses the pro price ID when tier is pro", async () => {
    const { createSubscriptionCheckout } = await import("./stripe-integration");
    await createSubscriptionCheckout(7, "u@x.io", "pro", "https://playlyricpro.com");
    expect(sessionsCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        line_items: [expect.objectContaining({ price: "price_live_pro_xxx" })],
      })
    );
  });

  it("uses the elite price ID when tier is elite", async () => {
    const { createSubscriptionCheckout } = await import("./stripe-integration");
    await createSubscriptionCheckout(7, "u@x.io", "elite", "https://playlyricpro.com");
    expect(sessionsCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        line_items: [expect.objectContaining({ price: "price_live_elite_xxx" })],
      })
    );
  });
});
```

- [ ] **Step 2: Run test, verify it passes**

```bash
pnpm test server/stripe.subscription-checkout.test.ts
```
Expected: PASS (3 cases).

- [ ] **Step 3: Commit**

```bash
git add server/stripe.subscription-checkout.test.ts
git commit -m "test(stripe): pin subscription-checkout config (mode, price IDs, metadata)"
```

---

### Task 18: First-sign-in user-row creation test

**Files:**
- Create: `server/auth.first-signin-user-row.test.ts`

> **Note:** This test mocks Supabase admin client and the DB layer. The exact mock surface depends on what [server/_core/supabase-auth.ts](../../server/_core/supabase-auth.ts) imports. Read that file first to align mocks.

- [ ] **Step 1: Read [server/_core/supabase-auth.ts](../../server/_core/supabase-auth.ts) lines 1–120**

Identify:
- The Supabase admin client import path
- The DB helper that inserts into `public.users`
- The function name (`authenticateRequest`)
- The shape of the user row that gets created (id, email, role default, etc.)

- [ ] **Step 2: Write the test**

Create `server/auth.first-signin-user-row.test.ts`. Adapt mock paths/shapes from Step 1.

```typescript
import { describe, it, expect, vi, beforeEach } from "vitest";

// Mock the Supabase admin client to return a "real" auth.users row.
const getUser = vi.fn();
vi.mock("@supabase/supabase-js", () => ({
  createClient: vi.fn().mockReturnValue({
    auth: { getUser },
  }),
}));

// Mock the DB layer. Adapt the import path to what supabase-auth.ts uses.
const dbSelect = vi.fn();
const dbInsert = vi.fn();
vi.mock("../db", () => ({
  getDb: vi.fn().mockResolvedValue({
    select: () => ({
      from: () => ({
        where: () => ({
          limit: () => dbSelect(),
        }),
      }),
    }),
    insert: () => ({
      values: dbInsert,
    }),
  }),
}));

describe("authenticateRequest first-sign-in user-row creation", () => {
  beforeEach(() => {
    getUser.mockClear();
    dbSelect.mockClear();
    dbInsert.mockClear();
    process.env.VITE_SUPABASE_PROJECT_URL = "https://test.supabase.co";
    process.env.SUPABASE_SECRET_KEY = "test_secret";
  });

  it("creates a public.users row when Supabase returns a valid JWT for a new user", async () => {
    getUser.mockResolvedValue({
      data: {
        user: {
          id: "supabase-uuid-123",
          email: "newuser@example.com",
          user_metadata: { full_name: "New User" },
        },
      },
      error: null,
    });
    dbSelect.mockResolvedValue([]); // no existing row
    dbInsert.mockResolvedValue([{ id: 1 }]);

    const { authenticateRequest } = await import("./_core/supabase-auth");
    const req = {
      headers: { authorization: "Bearer fake-jwt-token" },
      cookies: {},
    } as any;

    const user = await authenticateRequest(req);

    expect(getUser).toHaveBeenCalledWith("fake-jwt-token");
    expect(dbInsert).toHaveBeenCalledWith(
      expect.objectContaining({
        email: "newuser@example.com",
      })
    );
    expect(user).not.toBeNull();
  });

  it("creates a row even when email is an Apple private-relay address", async () => {
    getUser.mockResolvedValue({
      data: {
        user: {
          id: "supabase-uuid-456",
          email: "abc123xyz@privaterelay.appleid.com",
          user_metadata: {},
        },
      },
      error: null,
    });
    dbSelect.mockResolvedValue([]);
    dbInsert.mockResolvedValue([{ id: 2 }]);

    const { authenticateRequest } = await import("./_core/supabase-auth");
    const req = {
      headers: { authorization: "Bearer fake-jwt" },
      cookies: {},
    } as any;

    const user = await authenticateRequest(req);

    expect(dbInsert).toHaveBeenCalledWith(
      expect.objectContaining({
        email: "abc123xyz@privaterelay.appleid.com",
      })
    );
    expect(user).not.toBeNull();
  });

  it("does not insert when the user already exists in public.users", async () => {
    getUser.mockResolvedValue({
      data: {
        user: { id: "supabase-uuid-789", email: "existing@example.com", user_metadata: {} },
      },
      error: null,
    });
    dbSelect.mockResolvedValue([{ id: 99, email: "existing@example.com" }]);

    const { authenticateRequest } = await import("./_core/supabase-auth");
    const req = {
      headers: { authorization: "Bearer fake-jwt" },
      cookies: {},
    } as any;

    await authenticateRequest(req);

    expect(dbInsert).not.toHaveBeenCalled();
  });
});
```

- [ ] **Step 3: Run test, adjust mocks until it passes**

```bash
pnpm test server/auth.first-signin-user-row.test.ts
```

If the mock shapes don't match what `supabase-auth.ts` actually does, adjust the test (not the source) until it accurately exercises the auto-provisioning path.

- [ ] **Step 4: Commit**

```bash
git add server/auth.first-signin-user-row.test.ts
git commit -m "test(auth): pin first-sign-in public.users provisioning (incl. Apple private-relay)"
```

---

### Task 19: Apply mechanical fixes from Wave 0 baseline

> **Note:** This task is content-driven by Task 1 findings. The exact diffs depend on what the baseline scan flagged. The pattern is the same for each: write a focused test if applicable, fix, run tests, commit.

**Categories likely to surface (fix all that apply):**

- A tRPC procedure missing `protectedProcedure` / `adminProcedure` wrap → wrap it.
- A zod schema missing on a tRPC input → add it.
- A header missing or mis-set in `helmet` config → fix.
- An HSTS `includeSubDomains` flag missing → add.
- A rate-limit bucket missing on a sensitive operation → add.
- A `console.log` that prints a JWT, secret, or full webhook body → redact (use the existing `redact()` helper in stripeWebhook.ts as a pattern).
- An out-of-date `pnpm audit` finding fixable by a non-breaking dep bump → bump.
- Email-collision identity-linking trigger missing on `auth.identities` (D8) → add migration if scan flagged.
- Customer dedup on Checkout (D13) → add user→`stripe_customer_id` mapping if scan flagged.

For each finding fixed:

- [ ] **Step 1: Write a regression test pinning the fix (if testable in unit-test scope)**
- [ ] **Step 2: Make the change**
- [ ] **Step 3: Run `pnpm build && pnpm test`**
- [ ] **Step 4: Commit with a focused message** — `fix(security): <what + why, citing finding ID from Wave 0 report>`

If a finding is **not mechanical** (architectural, requires user decision), surface to user with proposed options before proceeding.

---

## Wave 2 — Provider dashboard configuration

### Task 20: Generate combined runbook deliverable

**Files:**
- Create: `docs/oauth-and-stripe-go-live-2026-05-08.md`

- [ ] **Step 1: Capture project-specific values**

```bash
grep "VITE_SUPABASE_PROJECT_URL" .env 2>/dev/null | head -1 | sed 's/.*=//' | sed 's/https:\/\///' | sed 's/\.supabase\.co.*/\.supabase.co/'
```

Note: do **not** echo the URL back to the user in chat — capture the value privately for use in the runbook file (the URL is non-secret but treat it consistently with the secrets policy). Read once from `.env`, write to the runbook, do not display.

- [ ] **Step 2: Write the runbook**

Use the structure from spec §4 ([docs/superpowers/specs/2026-05-08-oauth-stripe-security-design.md](../specs/2026-05-08-oauth-stripe-security-design.md) §§4.1–4.3) verbatim, with placeholders replaced:

- `[YOUR_SUPABASE_REF]` → actual project ref from Step 1
- Service ID convention: `ai.intentionai.lyricpro.web` (already in spec)
- Webhook URL: `https://www.playlyricpro.com/api/stripe/webhook` (confirm from `vercel.json` rewrites + `api-src/stripe/webhook.ts` location)
- Redirect URLs allow-list: pre-fill prod + localhost + Vercel preview wildcard

Include the secrets-handling reminder at the top of the runbook.

Include all six webhook events: `checkout.session.completed`, `invoice.paid`, `invoice.payment_failed`, `customer.subscription.updated`, `customer.subscription.deleted`, `charge.refunded`.

Include the Smart Retries opt-in step (§4.3 step 5b).

Include the env-var **names** to add to Vercel (no values), with Sensitive flags called out:
- `STRIPE_SECRET_KEY` (live, **Sensitive**, **Production only**)
- `STRIPE_WEBHOOK_SECRET` (live, **Sensitive**, **Production only**)
- `STRIPE_PRICE_PLAYER`, `STRIPE_PRICE_PRO`, `STRIPE_PRICE_ELITE` (Production only)
- Confirm `SUPABASE_SERVICE_ROLE_KEY` is marked **Sensitive**

- [ ] **Step 3: Commit the runbook**

```bash
git add docs/oauth-and-stripe-go-live-2026-05-08.md
git commit -m "docs(go-live): combined runbook for Google + Apple + Stripe live config"
```

### Task 21: Stand by for user dashboard work

- [ ] **Step 1: Surface the runbook to the user**

> "Runbook ready at [docs/oauth-and-stripe-go-live-2026-05-08.md](docs/oauth-and-stripe-go-live-2026-05-08.md). Walk through Section A (Google), then Section B (Apple), then Section C (Stripe live). Each ends with a green-light test. When you're ready, tell me which section you're starting and I'll be on standby for questions. After you finish a section, paste only the env-var **names** you've added to `.env` — never the values — and I'll continue with verification."

- [ ] **Step 2: Wait for user signal that all three providers are configured**

When user signals "all three done" or equivalent, proceed to Wave 3.

If user reports a problem with a specific section, debug interactively without leaving this task.

---

## Wave 3 — End-to-end verification

### Task 22: Dispatch verification subagents (parallel)

**Files:**
- No new files; subagent reports returned inline.

- [ ] **Step 1: Dispatch `Agent G`, `Agent A`, `Agent S` in parallel via three `Agent` tool calls in a single message**

Each subagent prompt must include:
- The constraint that it never echoes secret values, JWT tokens, `.p8` contents, or webhook payload bodies
- Read-only against the live state
- Must return a structured PASS/FAIL report with evidence

`Agent G` (Google) checks:
- Google Cloud Console redirect URI matches Supabase callback exactly
- Supabase Provider config for Google enabled
- Manual sign-in test (user signs in while subagent watches server logs / DB writes)
- Evidence required: server log line confirming Supabase JWT validated; `auth.users` row exists; `public.users` row created; correct post-sign-in route
- Failure modes: redirect URI mismatch, Supabase Redirect URLs missing prod or using single `*`, OAuth client still in Testing mode, missing `email` scope

`Agent A` (Apple) checks:
- Services ID matches Supabase
- Return URL on Services ID matches Supabase callback exactly
- `.p8` accepted (Supabase surfaces "JWT generation failed" if not)
- Team ID + Key ID correct
- Auth version ≥ v2.176.1
- Evidence required: Supabase JWT issued; `auth.users` row; `public.users` row. **Specifically test the private-relay email path**. **Specifically test the first-sign-in name capture** — `user_metadata.full_name` populated and persisted
- Failure modes: malformed `.p8`, Services ID mismatch, return URL trailing-slash, missing `name` scope, `account.apple.com` issuer rejection on old GoTrue

`Agent S` (Stripe) checks (in this order):
1. Test card `4242 4242 4242 4242` on prod returns decline `test_mode_live_card` (proves live keys flipped)
2. Real subscription purchase → webhook delivers (200) → `subscriptions` row written with live `stripeSubscriptionId`
3. Cancel from Stripe Dashboard → `customer.subscription.deleted` fires → status='canceled' in DB
4. Refund the charge → `charge.refunded` fires → state reverts
5. Probe webhook URL for 308 redirects (apex↔www, trailing slash)
- Evidence: response codes, log lines, DB row contents (cited as `<row exists>` not full content)
- Failure modes: webhook secret mismatch (silent until first event), price ID env var mismatch (checkout 500s), webhook URL pointing at preview, trailing-slash 308

- [ ] **Step 2: Consolidate the three reports**

Write a brief consolidated summary (~200 words) to chat:
- All three PASS → proceed to Wave 4
- Any FAIL → fix the specific item, re-dispatch only the failing agent, do not re-run the others

- [ ] **Step 3: If any FAIL, surface the specific failure to user with a fix proposal**

Once fixed, re-dispatch only the failing agent.

- [ ] **Step 4: Once all three PASS, commit any code-fix that came out of failures**

```bash
git add -A
git commit -m "fix(go-live): <specific item from Agent X failure>"
```

If no code fixes were needed, no commit; just proceed to Wave 4.

---

## Wave 4 — Delta security scan

### Task 23: Dispatch delta security scan

**Files:**
- Create: `/memory/security-scan-2026-05-08-final.md`

- [ ] **Step 1: Dispatch `Security Engineer` and `Compliance Auditor` in parallel**

Same lanes as Task 1, with one additional instruction: **diff against** `/memory/security-scan-2026-05-08-baseline.md`. For each finding:
- **Fixed in this cycle** — list with verification evidence (cite the commit + file:line where the fix landed)
- **New since baseline** — driven mostly by new env vars, new provider trust, new code paths in Wave 1
- **Pre-existing, still open** — anything we deferred, with the reason and a tracker pointer in `todo.md`

Same secret-handling rules as Task 1 (no value echoing).

- [ ] **Step 2: Consolidate diff into `/memory/security-scan-2026-05-08-final.md`**

Same format as the baseline plus a "Diff" section.

- [ ] **Step 3: Verify Definition of Done**

All four must hold:
1. Three Wave 3 verification reports all PASS
2. Wave 4 final scan shows zero open Critical or High findings
3. `pnpm build` and `pnpm test` green on the merged branch
4. `git log` shows clean conventional commits, no Manus references in subjects, no `Co-Authored-By: Claude` trailer

```bash
pnpm build && pnpm test
git log --oneline main..HEAD | grep -iE "manus|claude" || echo "clean"
```

- [ ] **Step 4: If any finding is Critical or High and unfixed, surface to user**

Do **not** declare done. Either fix immediately (if mechanical) or defer with explicit user acknowledgment.

- [ ] **Step 5: Commit the final report**

```bash
git add memory/security-scan-2026-05-08-final.md
git commit -m "chore(security): final scan report 2026-05-08 — diff against baseline"
```

- [ ] **Step 6: Surface completion to user**

Brief end-of-project summary: what shipped, what's deferred (with `todo.md` entries), Definition of Done checklist confirmed. Keep under 200 words. Then prompt the user to log time spent (per project memory: end-of-session time logging applies to all `myWork` projects).

---

## Self-Review

This plan was checked against the spec section-by-section. Spec coverage:
- Spec §1 goals → Tasks 1–23 (full coverage)
- Spec §2 wave sequencing → enforced by task order; Tasks 1, 22, 23 dispatch parallel subagents
- Spec §3.1 Manus removal (6 steps) → Tasks 2–7 (one task per step)
- Spec §3.2 OAuth code adjustments O1–O6 → Task 8 (O1), Task 9 (O2), Task 10 (O3), Task 19 conditionally (O4), Task 22 verification (O5), Task 20 runbook (O6)
- Spec §3.3 Stripe code adjustments S1–S6 → Task 11 (S1), Tasks 14+15+20 (S2 + S3), Task 12 (S4), Task 13 (S5), Task 19 conditionally (S6)
- Spec §3.4 three new tests → Tasks 16–18
- Spec §3.5 mechanical fixes → Task 19
- Spec §4 runbook → Task 20
- Spec §5 verification → Task 22
- Spec §6 scan methodology → Tasks 1 and 23 with full lanes
- Spec §7 Definition of Done → Task 23 Step 3
- Spec §8 risks → mitigations referenced in their respective tasks
- Spec §9 wall-clock estimate → matches plan task count
- Spec §10 out-of-scope follow-ups → tracked via `todo.md` entries (Task 10 Step 5 and Task 19)

No placeholders found in tasks. Type/symbol consistency: `handleCustomerSubscriptionUpdated` (Task 14) and `handleInvoicePaymentFailed` (Task 15) names are consistent across imports and tests. Method signatures (`updateSubscription`) noted in Task 14 with explicit "extend if needed" cue.
