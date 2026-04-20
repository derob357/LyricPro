# Changelog

All notable changes to LyricPro Ai. Format loosely follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/). Versions use
[Semantic Versioning](https://semver.org/): `major.minor.patch`.

Current version is in `package.json`. Each release section below carries
its version + date in the header. Git commits tagged with `v<version>`
on release.

---

## [Unreleased]

### Planned
- Mobile apps via Capacitor (iOS + Android). Plan in
  [docs/mobile-app-plan.md](docs/mobile-app-plan.md).
- Row-Level Security policies on every user-owned table.
- Drizzle transaction wrapper that enforces RLS per query (Option B
  from the auth discussion — DB-level second wall under the existing
  tRPC IDOR checks).
- Custom SMTP from `deric@intentionai.ai` for auth emails.
- Real Stripe test-mode key end-to-end verification.

---

## [0.2.0] — 2026-04-20

First production deployment. Migrated off Manus infrastructure onto
Supabase + Vercel. App is live at <https://lyricpro-ai.vercel.app>.

### Added
- **Vercel production deploy.** Serverless functions in `api/` (tRPC +
  Stripe webhook), static Vite client served from `dist/public`. Build
  pipeline bundles `api-src/*.ts` → `api/*.mjs` with esbuild so Node's
  ESM loader doesn't trip on extensionless imports at runtime. Security
  headers (HSTS, X-Frame-Options, Referrer-Policy, etc.) applied at the
  Vercel edge via `vercel.json`.
- **Supabase Auth.** Magic-link email sign-in wired end-to-end, Google
  and Apple OAuth provider buttons rendered (runbooks in
  [docs/oauth-setup-google.md](docs/oauth-setup-google.md) and
  [docs/oauth-setup-apple.md](docs/oauth-setup-apple.md) for external
  config). Server validates Supabase JWT via `supabase.auth.getUser(jwt)`
  and resolves to a `public.users` row, creating one on first sign-in.
- **Supabase Postgres.** 21 tables + 17 enum types + unique index on
  `songs(title, artistName)`. 834 approved songs seeded across 8 genres
  (Hip Hop 114, Country 112, Pop 106, Jazz 105, R&B 103, Gospel 102,
  Rock 98, Soul 94).
- **Initial user accounts.** `deric@intentionai.ai` (admin) and
  `derob357@yahoo.com` (user) provisioned via admin API. Idempotent
  bootstrap script in `scripts/bootstrap-auth-users.mjs`.
- **Dev tools.** Dev-only "Generate magic link URL" button on `/signin`
  that skips the email round-trip for local testing. Gated on
  `NODE_ENV !== "production"` (server) and `import.meta.env.DEV`
  (client).
- **Scripts.** `scripts/build-api.mjs` (esbuild bundler for serverless),
  `scripts/push-vercel-env.sh` (curated env var push), and
  `scripts/test-supabase-connections.mjs` (redacted connection tester).

### Changed
- **Database driver.** MySQL (`mysql2`) → Postgres (`postgres`).
- **Drizzle dialect.** `mysqlTable`/`mysqlEnum` → `pgTable`/`pgEnum`.
  `onUpdateNow()` replaced with `.$onUpdate(() => new Date())`.
- **Auth model.** Manus OAuth retired. Session cookies replaced with
  Authorization Bearer JWT on every tRPC call.
- **`server/routers.ts` → `server/app-router.ts`** to remove the
  file-vs-directory ambiguity that broke Vercel's ESM resolution.
- **`api/` restructured.** Source lives in `api-src/`; Vercel deploys
  the bundled `api/*.mjs` output.
- **Rate limiters** (`rateLimit`, checkout throttle) now no-op in
  non-production so local iteration isn't throttled.
- **`isAuthenticated`** in `useAuth` now derives from the server's
  `auth.me` response instead of the Supabase session — lets
  `DEV_AUTH_BYPASS=1` users hit Play Now without being bounced to
  `/signin`.
- **Supabase client `flowType`** switched from `pkce` to `implicit` so
  the magic-link callback works when the email opens in a different
  browser or incognito session than the one that requested it.

### Security
- Closed 5 privilege-escalation holes in earlier sessions, all of which
  allowed any authenticated client to bypass Stripe or redirect prize
  distribution: `upgradeSubscription`, `joinEntryFeeGame`,
  `purchaseAddOnGames`, `completeAddOnPurchase`, `completeGameWithPrizes`.
- IDOR fix on `createEntryFeeGame` — now verifies room.hostUserId.
- Session cookie `sameSite: "lax"` (was `"none"`).
- Stripe webhook idempotency table + refund/renewal handlers.
- Dependency upgrades closed 1 critical + 9 high CVEs (drizzle-orm,
  @trpc/*, axios, @aws-sdk/client-s3, path-to-regexp, lodash, lodash-es,
  fast-xml-parser).

### Removed
- MySQL migrations `0000`–`0007`, replaced by a single fresh Postgres
  migration `0000_conscious_shinko_yamashiro.sql`.
- Legacy one-off `migrate-*.mjs` scripts.
- Manus OAuth callback route from the Express dev server.
- Old `scripts/seed-songs.mjs` and `scripts/seed-expanded.mjs`
  (superseded by `seed-large.mjs`).

---

## [0.1.0] — Baseline

Working trivia game on the Manus platform with MySQL. Captured as the
initial git commit on 2026-04-20.

### Included at baseline
- Trivia-show-style gameplay screen with purple/cyan brand palette,
  3-stage round (main → artist bonus → year bonus), shared timer,
  buzz-in with Q/B/P keys + 60% desaturation for non-buzzers.
- Solo and multiplayer modes, team play, streak bonuses, speed bonuses.
- Guest play, onboarding, lobby, round results, final results,
  profile, leaderboards, user dashboard, admin dashboard.
- Monetization scaffolding: Stripe Checkout for subscriptions, entry
  fees, and add-on games. Prize pool aggregation. Stripe Connect
  payouts. Webhook handler.
- 900 songs seeded from `scripts/seed-large.mjs`, with idempotent
  re-runs via `ON CONFLICT DO NOTHING`.
- 54-test scoring + fuzzy-matching unit test suite (all passing).
- Docs: `docs/test-plan-gameplay.md`, `docs/client-brief-jim.md`.
