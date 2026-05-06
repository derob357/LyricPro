# Phase 5a — Migration Plan

How we move ~6,500 jsonb variants across ~2,174 active songs into the new
three-layer schema without breaking the live game on a single-deployment
Vercel project with one prod DB.

Design only. **No DDL has run. No data has moved.**

---

## Current state (verified read-only)

- Active approved songs: **2,174**
- Total lyric variants embedded in `songs.lyricVariants`: **6,513**
- Read sites for `lyricVariants`: 4 in `server/routers/game.ts`
  (lines 146, 184, 689, 910, 1188), plus several scripts under `scripts/`.

The four runtime read sites all flow through two helpers:

- `variantsOf(song)` — returns the jsonb array, falls back to legacy columns
- `playableVariantIndicesOf(song, difficulty)` — filters by emptiness + word count

These are the two surfaces we need to swap to the new tables.

---

## Order of operations

### Step 1 — DDL: create new tables, add new columns (online, zero-downtime)

Single migration, applied to prod via the existing
`scripts/apply-*-migration.mjs` pattern (or a fresh Drizzle-managed migration
once the schema additions land in `drizzle/schema.ts`).

```sql
-- 1. New enums
CREATE TYPE licensing_status AS ENUM
  ('pending', 'in_review', 'cleared', 'internal_only', 'rejected');
CREATE TYPE candidate_use_case AS ENUM
  ('song_id', 'artist_id', 'year_id', 'finish_the_lyric', 'multi_surface');
CREATE TYPE question_type AS ENUM
  ('song_identification', 'artist_identification',
   'year_identification', 'finish_the_lyric');
CREATE TYPE prompt_format AS ENUM ('multiple_choice', 'typed', 'voice');
CREATE TYPE qa_status AS ENUM ('pending', 'passed', 'needs_fix', 'blocked');

-- 2. Songs additions (5 new columns; defaults make this safe online)
ALTER TABLE songs
  ADD COLUMN IF NOT EXISTS featured_artist     varchar(256),
  ADD COLUMN IF NOT EXISTS licensing_status    licensing_status NOT NULL DEFAULT 'internal_only',
  ADD COLUMN IF NOT EXISTS approved_for_game   boolean          NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS in_curated_bank     boolean          NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS curator_notes       text;

-- 3. lyric_moments table (full DDL — see SCHEMA-DESIGN.md for column list)
CREATE TABLE lyric_moments ( ... );  -- abbreviated; see schema.proposed.ts
ALTER TABLE lyric_moments
  ADD CONSTRAINT lyric_moments_song_fk
    FOREIGN KEY (song_id) REFERENCES songs(id) ON DELETE CASCADE,
  ADD CONSTRAINT lyric_moments_approver_fk
    FOREIGN KEY (approved_by) REFERENCES users(id) ON DELETE SET NULL,
  ADD CONSTRAINT lyric_moments_score_ranges CHECK (...);  -- per SCHEMA-DESIGN.md

-- 4. overall_playability_score generated column
ALTER TABLE lyric_moments
  ADD COLUMN overall_playability_score smallint
  GENERATED ALWAYS AS (...) STORED;  -- formula in SCHEMA-DESIGN.md

-- 5. gameplay_items table
CREATE TABLE gameplay_items ( ... );
ALTER TABLE gameplay_items
  ADD CONSTRAINT gameplay_items_moment_fk
    FOREIGN KEY (lyric_moment_id) REFERENCES lyric_moments(id) ON DELETE RESTRICT,
  ADD CONSTRAINT gameplay_items_song_fk
    FOREIGN KEY (song_id) REFERENCES songs(id) ON DELETE CASCADE;

-- 6. Indexes (per SCHEMA-DESIGN.md)
CREATE INDEX ...;
```

This step is idempotent (`IF NOT EXISTS` on each clause), online (no
table-rewriting locks since Postgres ≥ 11 handles `ADD COLUMN` with constant
default in O(1) without a rewrite), and reversible (DROP TABLE + drop
columns).

**Estimated runtime: < 5 seconds. No downtime.**

---

### Step 2 — Backfill from existing `songs.lyricVariants`

Single script, run from a developer laptop (NOT serverless) using
`SUPABASE_SESSION_POOLER_STRING`. Pattern matches `scripts/seed-lyric-variants.mjs`.

**Mapping rule**: each entry in `songs.lyricVariants[]` becomes:

- exactly one `lyric_moments` row
- exactly one `gameplay_items` row

#### Lyric moment row mapping

For each `variant = songs.lyricVariants[i]` of song `S`:

| `lyric_moments` column   | Source                                                       |
| ------------------------ | ------------------------------------------------------------ |
| `song_id`                | `S.id`                                                       |
| `section_type`           | `variant.sectionType`                                        |
| `section_order`          | `i + 1`                                                      |
| `candidate_use_case`     | `'finish_the_lyric'` (the existing variants are all FTL-style prompts) |
| `lyric_text`             | `(variant.prompt + ' ' + variant.answer).trim()` — full line |
| `lyric_before`           | NULL                                                         |
| `lyric_after`            | NULL                                                         |
| `low_fit`                | `S.difficulty = 'low'` (best-effort inference; curator can re-flag) |
| `medium_fit`             | `S.difficulty = 'medium'`                                    |
| `hard_fit`               | `S.difficulty = 'high'`                                      |
| `song_recognition_fit`   | `true` (every legacy variant is gameplay-ready by definition)|
| `artist_recognition_fit` | `true`                                                       |
| `year_fit`               | `true`                                                       |
| `finish_the_lyric_fit`   | `true`                                                       |
| All 8 score columns      | NULL (see "Scoring backfill" below for the recommended path) |
| `reviewer_notes`         | `'Backfilled from legacy lyricVariants index ' || i`         |
| `approval_status`        | `'approved'` — these variants are already live in production |
| `approved_by`            | NULL                                                         |
| `approved_at`            | `now()` at backfill time                                     |
| `created_at`             | `now()`                                                      |

**Idempotency**: the unique index `(song_id, lyric_text)` lets the script
re-run safely with `INSERT ... ON CONFLICT DO NOTHING`.

#### Gameplay item row mapping

For each `variant = songs.lyricVariants[i]` of song `S` (after the
corresponding `lyric_moments` row exists):

| `gameplay_items` column | Source                                                |
| ----------------------- | ----------------------------------------------------- |
| `lyric_moment_id`       | the moment row's `id` (looked up by `song_id` + `lyric_text`) |
| `song_id`               | `S.id`                                                |
| `difficulty`            | `S.difficulty`                                        |
| `question_type`         | `'finish_the_lyric'`                                  |
| `prompt_format`         | `'multiple_choice'`                                   |
| `prompt_text`           | `variant.prompt`                                      |
| `correct_answer`        | `variant.answer`                                      |
| `distractor_1`          | `variant.distractors[0]` (or NULL if absent)          |
| `distractor_2`          | `variant.distractors[1]`                              |
| `distractor_3`          | `variant.distractors[2]`                              |
| `year_tolerance`        | NULL                                                  |
| `qa_status`             | `'passed'` — these are already live; `pending` would block them |
| `is_active`             | `true`                                                |
| `created_at`            | `now()`                                               |

**Estimated runtime**: 6,513 INSERTs × 2 tables ≈ 13,000 row writes. With
prepared statements + transaction batching of 500, ~30 seconds.

**Estimated downtime**: zero. The new tables are not yet read by the runtime;
the legacy jsonb is unchanged.

---

### Step 3 — Scoring backfill (RECOMMENDED: option (b) NULL + prioritized review)

The brief expects every moment to carry eight 1-5 scores. ~6,500 moments
need scoring. Three options:

#### Option (a) — One-shot Claude pass over every moment

- Prompt: brief's rubric + the lyric text + artist/title/genre context
- Cost: 6,500 calls × ~$0.003 ≈ **$20** at sonnet-4.5 pricing
- Runtime: 6,500 calls / 8 parallel × 2s ≈ **30 minutes**
- Quality: the brief itself says "AI should be used as a curation assistant,
  not the final judge" — so AI scores are not authoritative anyway
- Risk: locks in AI-only scores that humans never look at; biases the
  `overall_playability_score` toward whatever the model thinks

#### Option (b) — Default everything to NULL pending human review *(RECOMMENDED)*

- Cost: $0
- Runtime: 0 minutes
- Quality: gameplay still works because `gameplay_items` rows get created
  with `qa_status = 'passed'` directly from the legacy data — they don't
  need a parent score to be playable
- Implication: `lyric_moments.overall_playability_score` is NULL for every
  legacy moment; "best moments per song" queries return random results
  until scoring is done
- Mitigation: scoring is done as a Phase 5b task, prioritized by
  `in_curated_bank = true` (the 400-song bank-A first, ~1,200 moments;
  remaining long-tail second)

#### Option (c) — Hybrid: Claude-score the curated 400-song bank, NULL the rest

- Cost: ~1,200 moments × $0.003 ≈ **$4**
- Runtime: ~5 minutes
- Quality: the bank-A songs are the ones a player is most likely to see;
  having scores there enables "best-moment-first" selection in the hot pool
- Risk: same AI-as-judge concern, but limited to 1,200 moments and explicit
  about it; curator can later override

### Recommendation: **Option (b)**

Reasoning:
1. The brief explicitly says AI should not freely invent the taste standard.
2. Gameplay does not require scores to function — items work standalone.
3. `in_curated_bank = false` long-tail moments may never need scoring at
   all if they get retired in favor of bank-A material.
4. $0 + zero risk of bad scores influencing selection.
5. We can always run option (a) or (c) later as a separate phase — the
   schema doesn't lock us in.

The existing curator workflow continues to use the legacy `difficulty`
column on `songs` and the jsonb data, but the runtime now reads from the
new tables. Over time the curator scores moments as they review them; the
backfill becomes a continuous improvement, not a one-shot ETL.

---

### Step 4 — Read-path migration (the actual cutover)

#### Files that read `lyricVariants` today

1. `server/routers/game.ts`
   - `variantsOf(song)` (line 145) — used by `getNextSong` mutation
   - `playableVariantIndicesOf(song, difficulty)` (line 180)
   - 4 call sites: lines 593, 689, 910, 1188

2. `scripts/generate-lyric-variants.mjs` — Phase 3 generator (writing into
   jsonb). **STAYS** — Phase 3 is the last write into jsonb; once it
   completes we don't run this again.

3. `scripts/seed-lyric-variants.mjs` — initial seed. Already done; **archived**.

4. `scripts/regenerate-failing-variants.mjs` — verification + regeneration.
   **REWRITTEN** as a Phase 5b task to write into `lyric_moments` +
   `gameplay_items` instead of the jsonb.

5. `scripts/verify-lyrics.mjs` — read-only verifier. **REWRITTEN** to read
   from `gameplay_items` instead of jsonb.

6. `scripts/apply-lyric-variants-migration.mjs` — applies the original jsonb
   column. **STAYS** — historical migration, never re-run.

#### Read-path swap: replace the two helpers

Both helpers in `server/routers/game.ts` get replaced with a single new
helper that queries `gameplay_items`:

```ts
async function pickGameplayItem(
  db: DB, songId: number, difficulty: Difficulty
): Promise<GameplayItem | null> {
  const rows = await db
    .select()
    .from(gameplayItems)
    .where(
      and(
        eq(gameplayItems.songId, songId),
        eq(gameplayItems.difficulty, difficulty),
        eq(gameplayItems.isActive, true),
        eq(gameplayItems.qaStatus, "passed"),
      ),
    );
  if (rows.length === 0) return null;
  // Per-identity dedup against song_displays.gameplayItemId (new column —
  // see Step 5) goes here, then random pick.
  return rows[Math.floor(Math.random() * rows.length)];
}
```

The four call sites at lines 593, 689, 910, 1188 each get adapted:

- 593 (`getNextSong` candidate filter): "songs that have ≥1 playable item"
  becomes a `WHERE EXISTS (SELECT 1 FROM gameplay_items …)` subquery
- 689 (`getNextSong` variant pick): replaced with `pickGameplayItem(...)`
  call; the returned item carries `prompt_text`, `correct_answer`, etc.
- 910 (`submitAnswer` scoring): instead of resolving variant by index, we
  store the `gameplayItemId` in `song_displays` (new column) and look it
  up directly
- 1188 (`useHint` lyric stage): same — read `correct_answer` from the
  item, not the legacy variant array

#### `song_displays` adjustment

Add a new nullable column:
```sql
ALTER TABLE song_displays ADD COLUMN gameplay_item_id integer;
CREATE INDEX song_displays_gameplay_item_idx ON song_displays(gameplay_item_id);
```

The existing `variantIndex` column STAYS during the cutover (so legacy
displays still resolve their answers). New displays write `gameplay_item_id`;
old displays continue to work via the variantIndex fallback. After the
read-path swap is stable for ≥7 days, we drop `variantIndex`.

---

### Step 5 — Cutover strategy: feature flag + read-flag toggle

Single-deployment Vercel + one prod DB. Three options:

#### Big-bang swap

- One PR flips the read path. Deploy → all traffic on new tables instantly.
- Risk: a missed call site = broken game until rollback.
- Rollback: revert PR, redeploy. ~5 minutes.

#### Dual-write for N days

- App writes to BOTH legacy jsonb AND new tables for every change.
- Reads still hit jsonb until cutover flag flips.
- Pro: zero risk of drift between data sources.
- Con: every variant-modifying script (none active right now — Phase 3 is
  the last one) needs dual-write logic. We don't have any active scripts
  that match this pattern after Phase 3 completes.
- Verdict: **unnecessary** because there are no active jsonb-writing flows
  after Phase 3 completes.

#### Feature-flag gated read swap *(RECOMMENDED)*

- Add an env flag `LYRIC_PRO_READ_FROM_LAYER3` (default `false`).
- Both helper paths exist in code: legacy `variantsOf()` + new `pickGameplayItem()`.
- The four call sites branch on the flag.
- Deploy with flag `false`. Verify backfill, run smoke tests, then flip flag
  to `true` via Vercel env edit (no redeploy needed if we read it from
  `process.env` per request).
- Watch for 24h. If anything breaks, flip back to `false`.
- After 7 days stable: PR to delete the legacy code path entirely + drop
  `lyricVariants` jsonb + drop `lyricPrompt`/`lyricAnswer`/`distractors` legacy
  columns.

### Recommendation: **feature-flag gated read swap**

Reasoning:
1. Zero downtime: the flag flip is instantaneous.
2. Instant rollback: unflip the env var.
3. No dual-write complexity — the legacy jsonb is FROZEN after Phase 3 so
   there's nothing to keep in sync.
4. Single-deployment-Vercel reality is fine here; the env var mechanism
   IS our gradual rollout.

---

## Rollback plan

### Mid-Step 1 (DDL) failure
- Each statement is idempotent (`IF NOT EXISTS`, `CREATE TYPE` is the only
  exception — wrap in `DO $$ BEGIN … EXCEPTION WHEN duplicate_object THEN
  NULL; END $$`).
- Manual rollback: `DROP TABLE gameplay_items, lyric_moments;
  ALTER TABLE songs DROP COLUMN featured_artist, …; DROP TYPE …;`
- Time to recover: < 1 minute.

### Mid-Step 2 (backfill) failure
- The backfill script writes a checkpoint file (pattern: see
  `scripts/expand-library.checkpoint.json`).
- On crash: re-run; `ON CONFLICT DO NOTHING` makes it idempotent.
- If the data itself is wrong: `TRUNCATE lyric_moments, gameplay_items
  RESTART IDENTITY CASCADE;` then re-run with corrected mapping.
- Time to recover: < 5 minutes.

### Mid-Step 4 (read-path swap) failure
- Flip `LYRIC_PRO_READ_FROM_LAYER3 = false` in Vercel.
- Game instantly reverts to reading from jsonb.
- Time to recover: < 30 seconds (env var refresh).

### After legacy column drop
- Restore from the most recent Supabase daily backup.
- This is the only IRREVERSIBLE step. Drop only after ≥7 days of stability
  on the new path AND a verified backup taken < 24h before the drop.

---

## Risk register

| # | Risk                                                              | Likelihood | Blast radius                                | Mitigation |
| - | ----------------------------------------------------------------- | ---------- | ------------------------------------------- | --- |
| 1 | Backfill loses a variant due to mapping bug (e.g. dropped distractors) | Medium | Players see wrong distractors on affected songs | Pre-flight: write a verifier that re-reads `gameplay_items` and compares row-for-row against `lyricVariants[]` for every song. Block the read swap until 100% match. |
| 2 | Read swap goes live with stale data because backfill ran before Phase 3 finished | High if mistimed | Some songs play with old/missing variants | Hard ordering rule: Phase 3 must report DONE; verifier confirms `jsonb_array_length(lyricVariants) = COUNT(gameplay_items WHERE song_id = …)` for all 2,174 songs; only then run backfill, only then flip the read flag. |
| 3 | `getNextSong` query plan regression with new joins/subqueries     | Low        | Slow rounds across the board                | EXPLAIN ANALYZE the new query in staging using a copy of prod data. The composite index `(song_id, difficulty, question_type)` is sized for it. Watch p95 query latency for 24h post-flip. |
| 4 | song_displays.gameplay_item_id stays NULL too long after the swap (legacy variantIndex displays linger) | Medium | Hint + scoring lookup falls back to the wrong column | Keep BOTH columns through the 7-day stability window. The submit/hint lookup tries gameplay_item_id first, falls back to variantIndex. |
| 5 | overall_playability_score formula needs revision after curator review | Medium | Sort orders shift; existing approvals don't change | GENERATED column makes this an ALTER COLUMN dance, but on ~50k rows it's seconds. Document the formula in `lyric_moments` table comment. |
| 6 | Curator-only fields (curator_notes, in_curated_bank) accidentally exposed via tRPC | Low | PII / internal review notes leaked         | The tRPC router for gameplay does NOT select these columns; admin router needs explicit auth. Spot-check before deploy. |
| 7 | Foreign key cascade deletes a song and silently nukes all its moments + items | Low | Curator can't recover from a botched delete | Application-layer policy: never hard-delete a song; only `isActive = false`. Document in the admin router. Consider revoking DELETE privilege on `songs` in prod. |
| 8 | The new `lyric_text` UNIQUE constraint fails because two legacy variants happen to have identical text | Low | Backfill aborts mid-flight                  | Pre-flight: query `SELECT song_id, prompt || ' ' || answer, COUNT(*) FROM (SELECT id, jsonb_array_elements(lyricVariants) ...) GROUP BY 1, 2 HAVING COUNT(*) > 1`. If any duplicates exist, dedupe before backfill. |

---

## Summary

| Step | What                                  | Online? | Time     | Reversible? |
| ---- | ------------------------------------- | ------- | -------- | ----------- |
| 1    | DDL — new tables + columns + indexes  | yes     | < 5s     | yes         |
| 2    | Backfill — jsonb → 2 tables           | yes     | ~30s     | yes (TRUNCATE) |
| 3    | Scoring (option b: NULL)              | n/a     | 0        | n/a         |
| 4    | Read-path code change (PR + deploy)   | yes     | ~5min    | yes (env flag) |
| 5    | Read-flag flip (Vercel env)           | yes     | ~30s     | yes (env flag) |
| 6    | (after 7 days stable) Drop legacy cols| yes     | ~10s     | **NO** — restore from backup |

**Total clock time, end-to-end: ~2 weeks** (the 7-day stability window is the
biggest contributor; everything else is minutes).

**Total downtime: zero.**
