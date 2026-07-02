# Vendor KPI Dashboard + API — Design

**Date:** 2026-07-02
**Status:** Approved (brainstorm complete)

## Purpose

External vendors (content/music partners, advertisers/sponsors, investors/BD partners) need industry-standard mobile-app KPIs from LyricPro. Two consumption surfaces:

1. A **vendor dashboard** — tabbed visual reports inside the existing app at `/vendor`.
2. A **versioned REST API** — partners request which reports they want programmatically.

All vendor-visible data is **aggregate-only**: zero PII, minimum-cohort suppression everywhere.

## Decisions (from brainstorm)

| Question | Decision |
| --- | --- |
| Vendor types | Mix (content partners, advertisers, investors) → per-vendor scoping |
| KPI scope v1 | All four families: growth, engagement, content, monetization |
| Auth | `vendor` role (Supabase) for dashboard + admin-issued API keys for REST |
| Freshness | Daily rollups; dashboard/API read rollup tables only |
| Scoping | Per-vendor scope flags per family + optional catalog filter |
| Placement | In-app `/vendor` route section (like `/admin`) |
| API style | Versioned REST (`/api/vendor/v1/*`), JSON + CSV |

## Architecture

```text
raw tables (gameSessions, roundResults, songDisplays,
goldenNoteTransactions, subscriptions, guestSessions…)
        │  nightly rollup: Postgres function via pg_cron
        │  + thin Vercel cron reconciler/alerter (CRON_SECRET)
        ▼
rollup tables: kpi_daily_metrics, kpi_daily_song_stats,
               kpi_retention_cohorts  (+ rollup_runs watermark)
        │                          │
        ▼                          ▼
tRPC vendorRouter            REST /api/vendor/v1/*
(vendor role JWT)            (Bearer API key, SHA-256 hash lookup)
        ▼                          ▼
/vendor dashboard            partner systems / BI tools
```

Both surfaces consume one shared query module (`server/vendor/kpiQueries.ts`) so UI and API numbers cannot drift.

## Data Model (new tables — hand-written SQL migration, no drizzle-kit)

| Table | Purpose | Key columns |
| --- | --- | --- |
| `vendors` | One row per partner org | `name`, `contact_email`, `status` (active/suspended), `scope_growth`, `scope_engagement`, `scope_content`, `scope_monetization` (booleans), `catalog_filter` jsonb (song/artist allowlist; null = all), `created_at` |
| `vendor_members` | Supabase users ↔ vendor | `vendor_id`, `user_id` (unique) |
| `vendor_api_keys` | Programmatic access | `vendor_id`, `label`, `key_prefix` (e.g. `lp_live_ab12`), `last4`, `key_hash` (SHA-256), `last_used_at`, `expires_at` (optional), `revoked_at`, `created_at`. Max 2 active keys per vendor (rotation overlap). |
| `vendor_api_usage` | Audit/visibility | `key_id`, `date`, `request_count` (upsert-increment) |
| `kpi_daily_metrics` | Generic rollup | `date`, `metric` (text key, e.g. `dau`, `sessions`, `gn_purchase_amount`), `dimension` (`all`, `genre`, `tier`, …), `dimension_value`, `value` numeric, `user_count` int (for suppression). Unique on (date, metric, dimension, dimension_value). |
| `kpi_daily_song_stats` | Content performance | `date`, `song_id`, `displays`, `rounds_played`, `correct_rate`, `avg_response_time`, `user_count`. Unique on (date, song_id). |
| `kpi_retention_cohorts` | Retention | `cohort_date`, `day_offset` (1/7/30), `cohort_size`, `retained_count`. Unique on (cohort_date, day_offset). |
| `rollup_runs` | Watermark/bookkeeping | `run_date`, `status`, `started_at`, `finished_at`, `error` |

**Role:** extend `user_role` enum with `vendor` (`ALTER TYPE … ADD VALUE`). New `vendorProcedure` tRPC middleware (mirrors `adminProcedure`) that resolves `vendorId` + scope flags into context.

## Rollup Pipeline

- **Primary engine:** a Postgres function `rollup_daily_kpis(target_day date)` scheduled nightly by **Supabase pg_cron** (research: no function timeouts, no connection plumbing, run history in `cron.job_run_details`).
- **Reconciler:** thin Vercel cron `/api/cron/kpi-rollup-reconcile` (secured with `CRON_SECRET` Bearer check) that reads `rollup_runs`, re-triggers any missing days, and alerts on gaps. Accepts `?from=&to=` for backfills.
- **Idempotency:** full-day compute-then-upsert with `ON CONFLICT … DO UPDATE SET value = EXCLUDED.value` — never increments. Re-running any day or range is safe and routine.
- **Timezone:** one canonical reporting timezone — **America/New_York** — bucketed via `date_trunc('day', ts AT TIME ZONE 'America/New_York')`. Cron scheduled ≥2h after local midnight; the job computes "which local day just closed" rather than hardcoding. (Note existing gotchas: `to_char` is STABLE not IMMUTABLE; keep temporal logic out of index predicates.)
- **Backfill:** one-off script populates history day-by-day with per-day transactions.
- **Activity identity:** users via `userId`, guests via `guestToken`; a user is "active" on a day if they have a `gameSessions` row or `songDisplays` row that day (definition disclosed in footnotes).

## KPI Definitions (v1)

All definitions ship as machine-readable footnotes in `/v1/meta` and as chart footers in the UI (diligence-standard practice — unlabeled metrics are assumed inflated).

**Growth & audience** — DAU / WAU / MAU (trailing 7/30-day, calendar days in America/New_York, user+guest identity as above); stickiness = avg DAU ÷ MAU; new users (`users.created_at`); new guest sessions; guest→account conversion rate.

**Engagement & retention** — sessions/day (`gameSessions`); avg session length (`ended_at − started_at`, null-ended sessions excluded and noted); rounds per session; **classic (bounded) D1/D7/D30 retention**: % of a first-seen-date cohort active exactly on day N, day 0 = first day. Registered users only for retention (guests lack stable identity across devices); disclosed in footnote.

**Content performance** — per-song/genre/decade: displays (`songDisplays`), rounds played, correct-answer rate (`roundResults.lyricPoints > 0`), avg response time. Honors vendor `catalog_filter`.

**Monetization & economy** — ARPDAU = day's gross transactional revenue (GN purchases + add-on game purchases + entry fees) ÷ DAU, gross-of-fees, disclosed in footnote; subscription revenue reported separately as active subscriptions by tier (daily snapshot) rather than blended into ARPDAU in v1; GN purchase volume; GN spend by kind; entry-fee volume; prizes distributed. (If `songDisplays.grossRevenuePerEventMicros` is populated later it feeds content-level revenue.)

## Privacy & Suppression

- Zero PII in any vendor-visible response. Aggregates only.
- **k-anonymity threshold k = 50** (env-configurable `VENDOR_KPI_MIN_COHORT`), per big-tech norm (GA4/Privacy Sandbox). Cells computed from < k users return `null` + `"suppressed": true`.
- **Complementary suppression:** when a breakdown cell is suppressed, enough sibling cells/totals are also suppressed that the small cell cannot be derived by subtraction.
- Suppression applied at read time in `kpiQueries.ts` using the stored `user_count` per rollup row.

## REST API — `/api/vendor/v1`

Plain Express routes registered in `server/_core/index.ts` before the tRPC middleware (same pattern as the Stripe webhook). Read-only.

**Auth:** `Authorization: Bearer lp_live_<40-char base62 random>` (`lp_test_` reserved for future sandbox). Server hashes with SHA-256 → indexed lookup → resolves vendor + scopes. Uniform `401 {"error":"invalid_api_key","correlationId":…}` for missing/malformed/revoked/expired/unknown (true reason logged server-side only). `403` only for valid key + out-of-scope family. `last_used_at` updated (throttled/async).

**Rate limiting:** per-key via Upstash Redis (`@upstash/ratelimit`, sliding window) — in-process token buckets don't survive serverless instance churn. `vendor_api_usage` daily counters for audit. New env vars: `UPSTASH_REDIS_REST_URL`, `UPSTASH_REDIS_REST_TOKEN` (add to Vercel env + `.env`; never in chat/commits).

**Endpoints:**

| Endpoint | Returns |
| --- | --- |
| `GET /v1/meta` | vendor name, granted scopes, available date range, KPI definition footnotes |
| `GET /v1/metrics/growth?from&to&granularity=day\|week\|month` | growth family time series |
| `GET /v1/metrics/engagement?from&to&granularity=` | engagement + retention cohorts |
| `GET /v1/metrics/content?from&to&dimension=song\|genre\|decade&limit=` | content breakdowns (catalog-filtered) |
| `GET /v1/metrics/monetization?from&to&granularity=` | monetization family time series |
| `POST /v1/reports` | batch: `{reports:[…], from, to, granularity}` → combined document |

**Conventions:**

- `?format=json` (default) \| `csv`.
- Success envelope: `{ meta: { vendor, range, generatedAt, definitions }, data: […] }`.
- Error envelope: `{ error, correlationId }` — no stack traces, no DB text; `x-powered-by` disabled.
- Out-of-tenancy / out-of-catalog resource IDs → `404` (existence not leaked). Tenant scoping enforced server-side on every query (`vendor_id` from the authenticated key, never from params).
- Input validation with zod on all query/body params; date range capped (e.g. 400 days) to bound query cost.
- Versioned under `/v1`; breaking changes go to `/v2`.

## Vendor Dashboard — `/vendor`

- Route group in the existing React client (like `/admin`); client-gated on `role === 'vendor'`, server-gated by `vendorProcedure`.
- **Tabs = KPI families**, only in-scope families rendered. recharts (already installed): line/area for time series, bars for breakdowns, stat cards for headlines (MAU, stickiness, D7 retention, ARPDAU). Icons: outline lucide-react only.
- Shared controls: date-range picker (7d/30d/90d/custom), granularity toggle, CSV export per tab.
- Content tab: dimension switch (song/genre/decade) + top-N table, honoring `catalog_filter`.
- Chart footers show definition footnotes (same `definitions` payload as `/v1/meta`).
- **API Access page:** endpoint docs, the vendor's key prefixes/last4 + `last_used_at` (never full keys), granted scopes.
- Data via new tRPC `vendorRouter` → same `kpiQueries.ts` as REST.

## Admin — "Vendors" tab

- CRUD vendors: name, contact, status, four scope toggles, catalog filter (song/artist picker).
- Link members: attach existing user (sets role `vendor` + `vendor_members` row) or Supabase invite.
- Issue/revoke keys: **full key shown exactly once** at creation; list shows prefix/last4, created, last used, revoked. Revocation is immediate (DB is source of truth per request; no auth-decision caching > 60s).
- All mutations audited via existing `adminActions`.

## Security Checklist (per project security-first rule)

- [ ] REST routes authenticated (API key) and tRPC routes gated (`vendorProcedure` / `adminProcedure`)
- [ ] SHA-256 key hashes only at rest; show-once; `crypto.timingSafeEqual` where direct comparison occurs
- [ ] Uniform 401s; 404 for out-of-tenancy; generic error envelope + correlation ID
- [ ] Per-key rate limiting (Redis-backed); brute-force protection on key lookup path
- [ ] zod validation on all external inputs; date-range caps
- [ ] No PII in any vendor response; k=50 suppression + complementary suppression
- [ ] `CRON_SECRET` on reconciler endpoint; pg_cron function is DB-internal
- [ ] No secrets in logs/errors/commits; new env vars documented by name only

## Testing

- **Unit (fake-db harness):** `kpiQueries.ts` metric math, suppression incl. complementary, catalog filtering.
- **Rollup:** idempotency (run twice, identical rows); 3-day synthetic backfill; timezone boundary case (23:55 local event lands in correct day).
- **API:** auth matrix (no key / bad key / revoked / expired / out-of-scope / happy), envelope shape, CSV output, 404-vs-403, rate-limit 429.
- **UI:** tab visibility per scope combination.

## Phasing (each independently shippable)

1. **Data foundation** — migration (tables + enum), `rollup_daily_kpis` function, pg_cron schedule, reconciler cron, backfill script.
2. **API + admin** — key auth middleware, `kpiQueries.ts`, REST endpoints, admin Vendors tab. Partners can integrate.
3. **Dashboard** — `/vendor` route group, four tabs, API Access page. Partners self-serve visually.

## Research Deltas Folded In

- **D1:** Redis-backed per-key rate limiting (in-memory buckets reset per serverless instance).
- **D2:** dual-key rotation with overlap + `last_used_at` monitoring; `revoked_at` not row deletion.
- **D3:** uniform 401s, tenant scoping every query, 404 for out-of-tenancy, generic envelopes.
- **D4:** pg_cron primary + Vercel reconciler (Vercel cron is best-effort: silent skips + occasional duplicates).
- **D5:** classic bounded retention as default flavor; definition footnotes on every externally shared KPI.
- **D6:** k = 50 suppression (not 10) + complementary suppression.
- **D7:** canonical reporting timezone with local-day bucketing (UTC-day drift moves peak evening traffic across days).

## Out of Scope (v1)

- Real-time / current-day metrics (rollups are as-of-yesterday)
- Vendor self-signup (admin provisions all vendors)
- Webhooks / push delivery of reports
- Per-vendor white-label branding or separate portal domain
- `lp_test_` sandbox keys (format reserved, not implemented)
