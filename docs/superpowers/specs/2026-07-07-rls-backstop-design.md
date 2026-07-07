# RLS Deny-All Backstop — Design

**Date:** 2026-07-07
**Status:** Approved (brainstorm complete)
**Closes:** SOC 2 gap T-03 (CC6.1 / CC6.3 — DB-layer authorization backstop)

## Purpose

Enable Postgres Row Level Security on all ~50 `public` tables as a defense-in-depth
backstop behind the RLS-bypassing service-role/pooler connection. Authorization stays
app-code-enforced (via tRPC); RLS guarantees that a leaked anon/publishable key or a
client bug cannot read or write tables directly. Deny-all-for-client-roles +
service-role-only is a defensible CC6.1/CC6.3 least-privilege control — auditors do
not mandate per-row policies (research finding #10).

## Key facts (from codebase map)

- **Clients never touch tables directly.** The browser Supabase client
  (`client/src/lib/supabase.ts`, `VITE_SUPABASE_PUBLISHABLE_KEY`) is used for **auth +
  Realtime broadcast only** — zero `supabase.from()`, `.rpc()`, or `.storage` anywhere
  in `client/src/**`. All data flows tRPC → server → pooler.
- **Server bypasses RLS.** `server/db.ts` connects via `SUPABASE_TRANSACTION_POOLER_STRING`
  as the `postgres` role (table owner → bypasses plain RLS). `server/_core/supabase-auth.ts`
  uses `SUPABASE_SECRET_KEY` (service-role, BYPASSRLS) only for `auth.getUser()` /
  `auth.admin.generateLink` — no `.from()`.
- **Realtime = broadcast on private channels**, authorized by SELECT policies on
  `realtime.messages` (installed by `drizzle_archive/0013_chat_foundation.sql` +
  `0016_match_realtime.sql`). Those policies' `EXISTS`/helper subqueries run **as the
  `authenticated` role** and read 5 `public` tables — the only tables that need real
  policies.

## Decisions (from brainstorm)

| Question | Decision |
|---|---|
| RLS depth | Deny-all backstop (not per-row everywhere) |
| Realtime-dependency tables | Narrow own-row `authenticated` SELECT policies (not SECURITY DEFINER) |
| Verification | Automated probe script + owner's 5-min two-browser smoke |
| FORCE RLS | **Never** — server pooler is the table owner and must keep bypassing |

## Policy Surface — the 5 realtime-dependency tables

These feed the `realtime.messages` channel-join policies (`game:{id}`, `chat:*`). Each
gets a narrow `authenticated` SELECT policy using the `(select …)` initplan-cached form
(research #5 — ~95% perf improvement over bare `auth.uid()`).

| Table | New `authenticated` SELECT policy | Consumed by |
|---|---|---|
| `users` | own row: `"openId" = (select auth.uid())::text` | `current_chat_user_id()`, `is_chat_admin()` |
| `room_players` | own memberships: `"userId" = (select public.current_chat_user_id())` | `game:{id}` join EXISTS (`0016`) |
| `tournament_members` | own memberships: `"userId" = (select public.current_chat_user_id())` | `chat:tournament` join EXISTS (`0013`) |
| `tournaments` | member-of: `EXISTS (SELECT 1 FROM tournament_members tm WHERE tm."tournamentId" = tournaments.id AND tm."userId" = (select public.current_chat_user_id()))` | `chat:tournament` join EXISTS |
| `chat_bans` | **already has committed policies** (`0013`) — verify active, do NOT duplicate | `is_chat_banned()` |

`chat_messages` / `chat_audit_log` also already carry policies from `0013`; the
migration re-asserts `ENABLE` idempotently and leaves their policies untouched.
`anon` gets **no** policy on any table (guests do not authenticate to Realtime;
`useRealtimeAuth` pushes an authenticated JWT only). Exact column names
(`openId`, `userId`, `tournamentId`) to be confirmed against `drizzle/schema.ts` at
plan time.

**Helper hygiene:** pin `search_path = public, pg_temp` on `current_chat_user_id()`,
`is_chat_admin()`, `is_chat_banned()` (cheap hardening; research #8 footgun class).
They stay `LANGUAGE SQL STABLE` (not SECURITY DEFINER — decision above).

## Table Inventory (~50 public tables)

**Get deny-all only (no policy):** all monetization, content/song, kpi, vendor, audit,
and non-realtime game/user tables — `guest_sessions`, `player_profiles`, `user_insights`,
`user_favorites`, `avatars`, `artist_metadata`, `genres`, `songs`, `curated_song_sets`,
`suggestion_rules`, `commentary_templates`, `game_rooms`, `teams`, `game_sessions`,
`round_results`, `daily_game_tracking`, `chat_rooms`, `chat_friends_read_state`,
`leaderboard_entries`, `banners`, `banner_impressions`, `prize_pools`, `prize_payouts`,
`stripe_accounts`, `payout_requests`, `subscriptions`, `entry_fee_games`,
`entry_fee_participants`, `addon_game_purchases`, `user_wallets`,
`processed_webhook_events`, `golden_note_balances`, `golden_note_transactions`,
`golden_note_gifts`, `rollup_runs`, `vendors`, `vendor_members`, `vendor_api_keys`.
Plus raw-SQL tables not in `drizzle/schema.ts`: `kpi_daily_metrics`,
`kpi_daily_song_stats`, `kpi_retention_cohorts`, `vendor_api_usage`, `lyric_moments`,
`gameplay_items`.

**Get policies (realtime path):** `users`, `room_players`, `tournament_members`,
`tournaments` (new); `chat_bans`, `chat_messages`, `chat_audit_log` (pre-existing).

Plan-time task 0 will `SELECT tablename FROM pg_tables WHERE schemaname='public'` against
prod to produce the authoritative list (the "44 vs 49" gap is raw-SQL tables) and confirm
`tournament_members` exists as a real table.

## Migration

One file `scripts/migrations/applied/2026-07-07-enable-rls.sql`, applied via the generic
runner `scripts/apply-kpi-migration.mjs`. Idempotent throughout
(`DO $$ … EXCEPTION WHEN duplicate_object` for policies; `ENABLE ROW LEVEL SECURITY` is
naturally idempotent). Structure:

- **§1 Policies + helper hygiene** — 4 new policies, 3 `ALTER FUNCTION … SET search_path`.
- **§2 Enable RLS** — the 5+2 policy-backed tables first, then the ~43 deny-all tables.
- **§3 Rollback block** — commented `ALTER TABLE … DISABLE ROW LEVEL SECURITY` for every
  table + `DROP POLICY` for the 4 new ones, ready to uncomment.

## Staged Rollout

Single-Supabase topology → this runs against **prod**; every stage is instantly
reversible (one `DISABLE` statement per table, no locks).

0. **Baseline probe** — run `scripts/probe-rls.mjs` before any change; record current
   anon/authenticated access matrix.
1. **Policies only** — apply §1. Inert until RLS enabled; verify app healthy.
2. **RLS on the 7 policy-backed tables** (smallest blast radius). Probe: authenticated
   reads own rows only; `game:{id}` + `chat:global` joins still authorize. **Owner runs
   the 5-min two-browser multiplayer + chat smoke here.**
3. **RLS on the remaining ~43 tables** in one batch. Probe: anon + authenticated get
   zero rows / 42501 everywhere; `pnpm test:server` green; one KPI endpoint + one admin
   tRPC call exercised live.
4. **Evidence capture** — probe output + `pg_policies` / `pg_tables(rowsecurity)` dump →
   `compliance/evidence/2026-07-07-rls/` (local-only). Flip gap assessment T-03 → **met**.
   Regenerate drizzle snapshot so `isRLSEnabled` reflects reality.

## Verification — `scripts/probe-rls.mjs` (committed)

Two supabase-js clients:
- **anon** (`VITE_SUPABASE_PUBLISHABLE_KEY`): assert every table returns empty/denied.
- **authenticated** (seeded throwaway user, `signInWithPassword` or admin-minted session):
  assert own-row reads succeed on the 5 policy tables, other-row/other-table reads deny,
  and `supabase.realtime.setAuth(jwt)` + `.channel('game:<seededRoom>', {config:{private:true}})`
  subscription reaches `SUBSCRIBED` (channel-join authorized) while a bogus
  `game:<foreignRoom>` join is rejected.

Prints a PASS/FAIL matrix; non-zero exit on any FAIL. Seeds + tears down its own throwaway
user/room/membership (namespaced `__rls_probe__`), verifies 0 residual rows. Reusable for
quarterly access-review evidence. Never prints env values.

## Rollback

Any probe FAIL or smoke failure → stop, `DISABLE ROW LEVEL SECURITY` on that stage's
tables (uncomment §3), diagnose offline. Policies are harmless while RLS is off, so
Stage 1 never needs rollback.

## Out of Scope (recorded, not dropped)

- **T-04 guestToken checks** — 4 gameplay procedures (`setReady`/`getNextSong`/
  `submitAnswer`/`assignTeam`) need app-layer membership validation. Separate small fix
  (SE-D04 in `todo.md`); RLS does not cover it (those run through the service-role server).
- **Per-row policies beyond the 5** — no client-direct read paths exist to guard.
- **`realtime.messages` policy changes** — already correct (`0013`/`0016`).
- **PostgREST `exposed_schemas` narrowing** — complementary hardening; Stage 0 probe
  reveals whether `public` is even REST-exposed. Follow-up if so.

## Security Checklist

- [ ] `ENABLE` (never `FORCE`) — server pooler is table owner, must keep bypassing
- [ ] service_role NOT named in any policy (it bypasses; naming it is a no-op / research #2)
- [ ] every Realtime-subscribed public table has an `authenticated` SELECT policy (research #3 — silent event-drop otherwise)
- [ ] `(select auth.uid())` initplan form, not bare `auth.uid()` (research #5)
- [ ] helpers pinned `search_path`; stay non-SECURITY-DEFINER
- [ ] pg_cron (`postgres` owner) + Vercel crons (pooler) unaffected — verified post-Stage-3
- [ ] no env values in migration, probe, or evidence files
- [ ] probe teardown leaves 0 `__rls_probe__` rows

## Testing

- **Probe script** (above) — the primary gate, staged.
- **`pnpm test:server`** after Stage 3 — proves server (bypass path) unaffected.
- **Owner two-browser smoke** at Stage 2 — the one thing probes can't fully prove
  (browser-client realtime event flow end-to-end).
