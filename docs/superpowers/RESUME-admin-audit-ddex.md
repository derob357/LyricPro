# RESUME NOTES — Admin Audit Log + DDEX Logging initiative

**Last updated:** 2026-05-15
**Status:** Phases 0–2 complete & tagged. Phase 3 tasks 3.1–3.5 done. Task 3.6 (sign-off) blocked on a decision, not on work.

This file is a hand-off for a fresh session. Read it top to bottom before doing anything.

---

## What this initiative is

First of six planned admin-dashboard sub-projects for LyricPro. Bundled scope:
admin audit log + DDEX-ready song usage logging + admin lyric add/edit UI + exports
(internal CSV + DDEX DSR Basic Audio Profile flat-file).

- **Spec:** `docs/superpowers/specs/2026-05-14-admin-audit-and-ddex-logging-design.md` (commit `1d07d91`)
- **Plan:** `docs/superpowers/plans/2026-05-14-admin-audit-and-ddex-logging.md` (commit `56fff97`)
- **DDEX research:** `docs/superpowers/research/2026-05-15-ddex-dsr-basic-audio-profile.md` (commit `6ead798`)
- Executed via `superpowers:subagent-driven-development` — one subagent per task.
- All work committed directly to `main` (user gave explicit consent; no feature branch).

---

## Critical environmental facts (do not re-learn these the hard way)

1. **Local == Prod.** The Supabase connection strings in local `.env` point to the SAME
   Supabase project Vercel uses for production. Running migrations / tests from the laptop
   hits prod. Phase 0's migration is therefore already live in prod. Additive schema only —
   safe so far. Anything that mutates existing data must ship via PR + Vercel deploy, not laptop.
   See memory `reference_single_supabase_topology.md`.

2. **Postgres GENERATED columns need IMMUTABLE expressions.** `to_char(timestamp/timestamptz, text)`
   is STABLE not IMMUTABLE. `song_displays.reporting_period_yyyymm` uses an `EXTRACT + lpad + ||`
   expression instead. See memory `reference_postgres_generated_column_immutability.md`.

3. **Migration tracking drift was reconciled.** `drizzle.__drizzle_migrations` was missing the
   row for `0006_puzzling_turbo`; a reconciliation row was inserted (hash
   `9d799b406a2b...`, created_at `1778256282018`). Both local and prod are now consistent
   (prod showed 8 rows including our 0007 migration).

4. **`liveDescribe` test pattern.** Server tests that need a DB use
   `const liveDescribe = DB_URL ? describe : describe.skip`. They SKIP unless the shell has
   `SUPABASE_SESSION_POOLER_STRING` (etc.) exported. To run them: `set -a; source .env; set +a; pnpm test:server`.

5. **Task 0.8 was deliberately skipped** — setting `app.user_hash_pepper` as a connection GUC.
   postgres.js 3.4.9 has no per-connection hook and Postgres rejects custom dotted GUCs as
   startup params. Not needed: app code reads `process.env.USER_HASH_PEPPER` directly.

---

## Commits (37, oldest first), grouped by phase

**Phase 0 — schema migration** (tag `phase0-admin-audit-complete`):
`3986c09` env doc · `a9228d6` enums · `462024c` songs +6 cols · `69cfc93` song_displays +12 cols ·
`acc7341` audit tables · `781ef28` migration 0007 applied · `190d017` verification script ·
`eb76c8c` TrpcContext +ip/ua/requestId/countryCode

**Phase 1 Track A — audit infra + admin tRPC** (tag `phase1-track-a-complete`):
`d3c41a5` truncateIp · `deda7e3` recordAdminAction helper · `f96f9d1` getAdminMetrics→adminProcedure ·
`156c993` songs.list · `edbcd99` songs.get · `72b96ff` songs.update+audit · `f464a1c` songs.create/disable/enable ·
`60dda66` variants.update/create/delete · `9e7f8d8` actions.list/detail/distinctActors/exportCsv ·
`e7c2acf` test stripe-mock fix

**Phase 1 Track B — display ingest + usage** (tag `phase1-track-b-complete`):
`6dab62c` populate DDEX cols in getNextSong · `d7d936e` stamp durationOfUseSeconds on submitAnswer ·
`71ad10c` usage.byLyric/availablePeriods/exportCsv

**Phase 2 — admin UI** (tag `phase2-admin-ui-complete`):
`39cd754` routes+stubs · `e3d7810` SongsList · `bfa104c` SongEdit · `753b510` SongNew ·
`12e0e6c` ActionVerbChip · `86bd4ef` dashboard tabs · `8647ce7` LogTab+drawer · `47e3e34` UsageTab ·
`101fa22` /admin/usage redirect · `5020c48` SongsList Rules-of-Hooks fix

**Phase 3 — DDEX exporter** (NOT yet tagged):
`6ead798` DDEX research doc · `178387c` ddex-exporter (generateDdexDsr) · `f27cccd` ddex-lint ·
`9c8424f` usage.exportDdex tRPC route · `fa78899` DDEX button + lint warnings in Usage tab

**Post-Phase-2 fixes (user-reported):**
`a675589` distractors raw-string input + active/disabled toggle on SongEdit

---

## OPEN ITEMS — start here on resume

### 1. Task 3.6 — Phase 3 sign-off (DECISION NEEDED, not work)

Full server suite is **129/130 passing**. The one failure:

- `contentReadMode.test.ts` → "layer-3 path returns the same prompt+answer+distractors as flag OFF"
- Fails on a **prompt mismatch**: `'Just start to chase your dreams'` vs `'Socialize, get down, let your'`
- **This is pre-existing layer-3 data drift, NOT caused by this initiative.** The test compares two
  DB data sources (legacy `songs.lyricVariants` jsonb vs `gameplay_items`/`lyric_moments` tables).
  Our admin code only ever writes `answer` / `curatorNotes`, never `prompt`. `dualWriteVariants.test.ts`
  (testing the correct `syncSongVariants` dual-writer) passes all 4 tests. Project memory says
  "Phase 5c not started yet" — the layer-3 reconciliation was never finished.
- Does NOT affect production: `LYRIC_PRO_READ_FROM_LAYER3` flag is OFF in prod, so real users
  only hit the legacy path.
- **Decision for the user:** (a) sign off Phase 3, tag `phase3-ddex-complete`, log the drift as a
  separate Phase 5c issue in `todo.md`; (b) investigate the drift's extent; or (c) fix it now
  (a separate sub-project — the unstarted Phase 5c).

### 2. Two user-reported fixes need a browser check (`a675589`)

- **Distractors input** — was un-typeable (parsed on every keystroke). Now edits a raw string,
  parses only on "Save variant". Verify on a song's edit page → Lyric variants.
- **Active/Disabled toggle** — `SongEdit` now has a status switch under the artist name; flipping
  it calls `enable`/`disable` and writes a `song.enable`/`song.disable` audit row. Verify it works.

### 3. DDEX exporter has 5 `DDEX-UNVERIFIED` soft spots

Flagged in `server/_core/ddex-exporter.ts` code comments. Real DDEX spec content was medium-high
confidence; the FOOT record layout, exact `MessageVersion` string, and `entry_fee` commercial-model
mapping are best-guesses. Before any real publisher submission, verify against a DDEX sample file.

### 4. Pre-prod note for when Phase 0+ ships

Phase 0 schema is already in prod (local==prod). The CODE (Phases 1–3) is committed to `main`
but NOT deployed — no Vercel deploy has run. Deploy via the normal Vercel pipeline when ready.

---

## How to resume cleanly

```bash
cd /Users/drob/Documents/myWork/CCS/LyricPro/lyricpro-ai-2.0
git log --oneline -5            # confirm HEAD is a675589
git tag -l "phase*"             # phase0/1a/1b/2 tagged, phase3 not yet
pnpm check                      # should be clean
set -a; source .env; set +a; pnpm test:server   # 129 pass, 1 fail (the known drift)
```

A sandbox dev server may still be running on port `3457` from the prior session.
Kill stale ones: `lsof -ti:3457 | xargs kill`.

The plan file lists every task. Phase 3 has one task left: **Task 3.6 sign-off** — and that's a
decision, not code. After that the whole initiative is done and the next step is
`superpowers:finishing-a-development-branch` (decide how to integrate / whether to deploy).

---

## Cadence note

This initiative ran ~37 commits through subagent-driven-development (one subagent per task +
controller verification). That's inherently more round-trips than inline edits — it's the
execution model the user's standing instruction mandates ("always use subagents for plan
execution"). The slow points this run were: the migration immutability bug (2 retries), the
tracking-table drift reconciliation, the local==prod topology discovery, and the DDEX research
spike. None were rework of bad code — they were genuine environmental surprises now documented
above so they don't recur.
