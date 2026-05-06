# Phase 5a — Three-Layer Content Schema

Design-only document. No DDL has run, no rows have been written.

Translates the product brief at
`/Users/drob/Documents/Lyric Pro/lyric_pro_developer_quality_lyrics_brief.md`
into concrete Postgres + drizzle definitions that replace today's monolithic
`songs.lyricVariants` jsonb design.

The drizzle code companion lives at `drizzle/schema.proposed.ts` (not
imported anywhere — purely a side-by-side reference for the controller).

---

## Goals

1. Move the content model away from a single jsonb blob (`lyricVariants`) and
   onto discrete, queryable, scoreable rows.
2. Match the brief's three-layer model exactly. No additional layers, no
   re-imagining of fields.
3. Keep the live game playable throughout the migration. The current Phase 3
   regeneration is the LAST work that lives in the jsonb; everything after
   reads from the new tables.
4. Enforce the brief's quality-bar workflow at the schema level: a moment is
   `pending` until reviewed → `approved` / `rejected`; a gameplay item only
   exists when the moment passed and a curator chose to materialize it.

---

## Layer 1: Song Master (additions to existing `songs` table)

The existing `songs` table IS the Song Master. We add the missing brief
fields rather than replacing the table.

| Brief field         | Column                                         | Type / default                              | Notes |
| ------------------- | ---------------------------------------------- | ------------------------------------------- | --- |
| song_id             | `id` (existing)                                | `serial primary key`                        | unchanged |
| title               | `title` (existing)                             | `varchar(256) not null`                     | unchanged |
| primary_artist      | `artistName` (existing)                        | `varchar(256) not null`                     | unchanged — keep camelCase legacy column name |
| **featured_artist** | `featured_artist`                              | `varchar(256)` nullable                     | NEW |
| category            | `genre` (existing)                             | `varchar(64) not null`                      | the brief's "category" maps to existing `genre` |
| subgenre            | `subgenre` (existing)                          | `varchar(64)`                               | unchanged |
| release_year        | `releaseYear` (existing)                       | `integer not null`                          | unchanged |
| decade              | `decadeRange` (existing)                       | `varchar(32) not null`                      | unchanged (e.g. "1970–1980") |
| explicit_flag       | `explicitFlag` (existing)                      | `boolean default false`                     | unchanged |
| **licensing_status**| `licensing_status`                             | `licensing_status default 'internal_only'`  | NEW enum |
| **approved_for_game** | `approved_for_game`                          | `boolean default true`                      | NEW — gates whether the song appears at all |
| **in_curated_bank** | `in_curated_bank`                              | `boolean default false`                     | NEW — flags the bank-A 400-song set + future tiers |
| notes               | `curator_notes`                                | `text`                                      | NEW — song-level curator notes |
| (existing) approvalStatus | `approvalStatus`                         | `approval_status default 'approved'`        | unchanged — published-state, separate from `approved_for_game` |
| (existing) isActive | `isActive`                                     | `boolean default true`                      | unchanged — kill-switch |

### Why two booleans (`approved_for_game` and `isActive`) plus `approvalStatus`?

- `isActive` is the operational kill-switch (DMCA takedown, urgent removal).
- `approvalStatus` is the **content review** state from existing migrations
  (`pending` / `approved` / `rejected`).
- `approved_for_game` is the **curatorial** publish flag from the new brief —
  the controller's "yes I personally vetted this song for the game" stamp.

A song shows up in gameplay only when all three are green:
`isActive = true AND approvalStatus = 'approved' AND approved_for_game = true`.

### Legacy columns kept for the cutover, dropped after

These columns become redundant once Layer 2/3 are populated. They are NOT
dropped in Phase 5a. They get dropped in a follow-up migration after the
read-path swap and a stability window:

- `lyricPrompt`
- `lyricAnswer`
- `distractors` (jsonb)
- `lyricVariants` (jsonb) — the big one
- `lyricSectionType` (moves to `lyric_moments.section_type`)
- `difficulty` (moves to `gameplay_items.difficulty`)

---

## Layer 2: `lyric_moments`

One row per CANDIDATE lyric moment. Each row carries the brief's eight 1-5
scores plus the four surface-fit booleans, the three difficulty-fit booleans,
and the computed `overall_playability_score`.

### Columns

| Column                       | Type                              | Nullable | Notes |
| ---------------------------- | --------------------------------- | -------- | --- |
| `id`                         | `serial pk`                       | no       | = brief's `lyric_moment_id` |
| `song_id`                    | `integer`                         | no       | FK → `songs.id` ON DELETE CASCADE |
| `section_type`               | `varchar(32)`                     | no       | "chorus" / "hook" / "verse" / etc. — varchar (not enum) so we can add labels without enum migration |
| `section_order`              | `smallint`                        | yes      | 1-indexed position in track |
| `candidate_use_case`         | `candidate_use_case` enum         | no       | one of: song_id, artist_id, year_id, finish_the_lyric, multi_surface |
| `lyric_text`                 | `text`                            | no       | the displayable line — sourced from licensed text once cleared |
| `lyric_before` / `lyric_after` | `text`                          | yes      | optional context lines |
| `low_fit`, `medium_fit`, `hard_fit` | `boolean default false`    | no       | difficulty-tier fit flags (independent) |
| `song_recognition_fit`       | `boolean default false`           | no       | surface-fit flags (per brief) |
| `artist_recognition_fit`     | `boolean default false`           | no       | |
| `year_fit`                   | `boolean default false`           | no       | |
| `finish_the_lyric_fit`       | `boolean default false`           | no       | |
| `cue_obviousness_score`      | `smallint` (1-5)                  | yes      | NULL until scored |
| `lyric_vividness_score`      | `smallint` (1-5)                  | yes      | NULL until scored |
| `artist_fingerprint_score`   | `smallint` (1-5)                  | yes      | NULL until scored |
| `sayability_score`           | `smallint` (1-5)                  | yes      | "Sayability / Quote Energy" |
| `social_recognition_score`   | `smallint` (1-5)                  | yes      | NULL until scored |
| `era_signal_score`           | `smallint` (1-5)                  | yes      | NULL until scored |
| `question_variety_score`     | `smallint` (1-5)                  | yes      | NULL until scored |
| `ambiguity_risk_score`       | `smallint` (1-5)                  | yes      | NULL until scored — penalty contributor |
| `overall_playability_score`  | `smallint` GENERATED              | yes      | see formula below |
| `reviewer_notes`             | `text`                            | yes      | |
| `approval_status`            | `varchar(16) default 'pending'`   | no       | "pending" / "approved" / "rejected" |
| `approved_by`                | `integer`                         | yes      | FK → `users.id` |
| `approved_at`                | `timestamptz`                     | yes      | |
| `created_at`, `updated_at`   | `timestamptz`                     | no       | standard |

### CHECK constraints (added in DDL — drizzle-orm doesn't model these)

```sql
ALTER TABLE lyric_moments
  ADD CONSTRAINT lyric_moments_score_ranges CHECK (
    (cue_obviousness_score    IS NULL OR cue_obviousness_score    BETWEEN 1 AND 5) AND
    (lyric_vividness_score    IS NULL OR lyric_vividness_score    BETWEEN 1 AND 5) AND
    (artist_fingerprint_score IS NULL OR artist_fingerprint_score BETWEEN 1 AND 5) AND
    (sayability_score         IS NULL OR sayability_score         BETWEEN 1 AND 5) AND
    (social_recognition_score IS NULL OR social_recognition_score BETWEEN 1 AND 5) AND
    (era_signal_score         IS NULL OR era_signal_score         BETWEEN 1 AND 5) AND
    (question_variety_score   IS NULL OR question_variety_score   BETWEEN 1 AND 5) AND
    (ambiguity_risk_score     IS NULL OR ambiguity_risk_score     BETWEEN 1 AND 5)
  );
```

### Indexes

- `lyric_moments_song_id_idx` on (`song_id`) — pull all moments for a song
- `lyric_moments_approval_status_idx` on (`approval_status`) — review queue
- `lyric_moments_song_score_idx` on (`song_id`, `overall_playability_score`)
  — "best moments per song" queries
- `lyric_moments_song_lyric_unique` UNIQUE on (`song_id`, `lyric_text`) —
  prevent duplicate candidates

### overall_playability_score formula

The brief specifies:
- Recognition 20%, Vividness 15%, Fingerprint 15%, Sayability 15%,
  Social 15%, Era 5%, Question Variety 10%
- Ambiguity Risk: penalty of -5% to -15% depending on severity

Implemented as a Postgres GENERATED column. Stored as `smallint * 100`
(i.e. integer hundredths) to avoid float ORDER BY surprises.

**The brief says "Recognition" but doesn't give it a column name.** We map
"Recognition" to `cue_obviousness_score` because the scoring framework's
"Recognition" entry says "How likely the intended audience is to know the
lyric" — and the Lyric Moment Bank's `cue_obviousness_score` is the column
that captures that idea. (If the controller meant a separate
`recognition_score` column, that's a one-line schema fix; flagged below.)

Ambiguity penalty maps from severity (1-5) to weight: 1→-3%, 2→-6%, 3→-9%,
4→-12%, 5→-15%. Linear: `-0.03 * ambiguity_risk_score`.

```sql
ALTER TABLE lyric_moments
  ADD COLUMN overall_playability_score smallint
  GENERATED ALWAYS AS (
    CASE
      WHEN cue_obviousness_score IS NULL OR lyric_vividness_score IS NULL
        OR artist_fingerprint_score IS NULL OR sayability_score IS NULL
        OR social_recognition_score IS NULL OR era_signal_score IS NULL
        OR question_variety_score IS NULL OR ambiguity_risk_score IS NULL
      THEN NULL
      ELSE (
        (20 * cue_obviousness_score)
      + (15 * lyric_vividness_score)
      + (15 * artist_fingerprint_score)
      + (15 * sayability_score)
      + (15 * social_recognition_score)
      + ( 5 * era_signal_score)
      + (10 * question_variety_score)
      - ( 3 * ambiguity_risk_score)
      )
    END
  ) STORED;
```

The result is integer in [-15, 475] before any divisor; in practice typical
values land in [85, 460]. Higher = better.

> **Open question for the controller**: should `overall_playability_score` be
> recomputed when scores update? GENERATED STORED handles that automatically
> on each row write. Confirm this is desired vs. application-side computation.

### Approval workflow

- A moment row is created with `approval_status = 'pending'` and all eight
  score columns NULL.
- A reviewer (human or AI-assist) populates the eight score columns.
- A curator flips `approval_status` to `'approved'` (sets `approved_by` and
  `approved_at`) or `'rejected'`.
- Only `approval_status = 'approved'` moments may have gameplay_items rows.
  Enforced at the application layer (the moment-→item materialization tool
  refuses pending/rejected moments).

---

## Layer 3: `gameplay_items`

One row per APPROVED gameplay prompt. This is what the game runtime reads.

### Columns

| Column              | Type                              | Nullable | Notes |
| ------------------- | --------------------------------- | -------- | --- |
| `id`                | `serial pk`                       | no       | = brief's `item_id` |
| `lyric_moment_id`   | `integer`                         | no       | FK → `lyric_moments.id` ON DELETE RESTRICT |
| `song_id`           | `integer`                         | no       | FK → `songs.id` (denormalized; matches `lyric_moments.song_id`) |
| `difficulty`        | `varchar(8)`                      | no       | "low" / "medium" / "high" — explicit |
| `question_type`     | `question_type` enum              | no       | song_identification / artist_identification / year_identification / finish_the_lyric |
| `prompt_format`     | `prompt_format` enum default 'multiple_choice' | no | multiple_choice / typed / voice |
| `prompt_text`       | `text`                            | no       | the displayable prompt |
| `correct_answer`    | `text`                            | no       | the displayable answer |
| `distractor_1`      | `text`                            | yes      | (NULL allowed for typed format) |
| `distractor_2`      | `text`                            | yes      | |
| `distractor_3`      | `text`                            | yes      | |
| `year_tolerance`    | `smallint`                        | yes      | only for year_identification items |
| `qa_status`         | `qa_status` enum default 'pending'| no       | pending / passed / needs_fix / blocked |
| `qa_notes`          | `text`                            | yes      | |
| `is_active`         | `boolean default true`            | no       | kill-switch |
| `times_shown`       | `integer default 0`               | no       | analytics; song_displays remains source of truth |
| `created_at`, `updated_at` | `timestamptz`              | no       | standard |

### Indexes

- `gameplay_items_moment_id_idx` on (`lyric_moment_id`)
- `gameplay_items_song_id_idx` on (`song_id`)
- `gameplay_items_song_diff_type_idx` on (`song_id`, `difficulty`, `question_type`)
  — covers the hot-path query: "give me a playable item for (song, difficulty, question_type)"
- `gameplay_items_active_idx` on (`is_active`, `qa_status`) — admin queues

### Difficulty becomes explicit

Today: `playableVariantIndicesOf(song, difficulty)` walks the jsonb,
filtering by word count and emptiness. Difficulty is INFERRED from properties
of the variant text.

After: difficulty is an EXPLICIT column on `gameplay_items`. The runtime
query becomes:

```sql
SELECT * FROM gameplay_items
WHERE song_id = $1
  AND difficulty = $2
  AND is_active = true
  AND qa_status = 'passed'
ORDER BY random()
LIMIT 1;
```

A single `lyric_moment` can spawn N gameplay items at different difficulties
and question types (e.g. one item for `finish_the_lyric` on Hard, one for
`song_identification` on Medium).

### qa_status workflow

Distinct from `lyric_moments.approval_status`:

- `approval_status` (Layer 2) = curatorial sign-off on the moment ("this lyric
  is worth using")
- `qa_status` (Layer 3) = last-mile sanity check on the gameplay item itself
  ("the distractors are unique, the year tolerance is sensible, the prompt
  text doesn't have a typo")

A moment can be `approved` and still have items in `qa_status = 'pending'`
because the items are generated separately.

---

## Foreign keys + cascade behavior

```
songs (id) ─┬─◇ lyric_moments (song_id)        ON DELETE CASCADE
            └─◇ gameplay_items (song_id)        ON DELETE CASCADE
lyric_moments (id) ─◇ gameplay_items (lyric_moment_id)  ON DELETE RESTRICT
users (id) ─◇ lyric_moments (approved_by)       ON DELETE SET NULL
```

**Why RESTRICT on lyric_moment → gameplay_item?** Deleting a moment that has
live gameplay items would orphan game runtime data. Force the curator to
explicitly retire the items first (or `is_active = false` them) before
removing the moment.

**Why CASCADE on song → lyric_moments / gameplay_items?** If a song is hard-
deleted (rare; we usually `isActive = false` instead), all derived moments
and items should go too — they're meaningless without the parent.

---

## How brief scoring fields map to columns

Direct 1:1 mapping per the brief, with one ambiguity flagged:

| Brief term                  | Column                       |
| --------------------------- | ---------------------------- |
| Recognition                 | `cue_obviousness_score` *(see open question above)* |
| Lyric Vividness             | `lyric_vividness_score`      |
| Artist Fingerprint          | `artist_fingerprint_score`   |
| Sayability / Quote Energy   | `sayability_score`           |
| Social Recognition          | `social_recognition_score`   |
| Era Signal                  | `era_signal_score`           |
| Question Variety            | `question_variety_score`     |
| Ambiguity Risk              | `ambiguity_risk_score`       |

---

## Where overall_playability_score is computed

**Postgres GENERATED ALWAYS column, STORED.** Reasoning:

1. Sort-by-score queries are extremely common in the curation UI ("show me
   the top 10 unscored moments for this song"). Materialized = no recompute.
2. Application-side computation creates drift between the stored scores and
   the displayed playability — and the brief implies the score IS the
   ground truth, not a presentation-layer transform.
3. Trigger-based maintenance is more code than a GENERATED column for the
   same outcome.

Tradeoff: any future reweighting of the formula requires `ALTER TABLE …
DROP COLUMN … ADD COLUMN …` (cheap on this table size — under 50k rows
expected). That's an acceptable cost for the simplicity.

---

## Approval-status workflow summary

```
[lyric moment created]
       │  approval_status = 'pending', scores = NULL
       ▼
[scoring pass]                ← AI-assist or human reviewer
       │  scores 1-5 populated, approval_status still 'pending'
       │  overall_playability_score auto-computes
       ▼
[curator review]              ← decision point
       │
       ├── approved → approval_status = 'approved'
       │             approved_by, approved_at populated
       │             eligible to spawn gameplay_items
       │
       └── rejected → approval_status = 'rejected'
                     stays in DB for audit; no items spawned
```

```
[gameplay item created from approved moment]
       │  qa_status = 'pending'
       ▼
[QA pass]                     ← distractor uniqueness, year-tolerance sanity, prompt typo check
       │
       ├── passed     → qa_status = 'passed'  → eligible for gameplay
       ├── needs_fix  → qa_status = 'needs_fix' → goes back to author
       └── blocked    → qa_status = 'blocked'   → out of rotation
```

The `getNextSong` runtime query reads ONLY items with
`is_active = true AND qa_status = 'passed'` (and the parent moment's
`approval_status = 'approved'` and the parent song's
`isActive = true AND approvalStatus = 'approved' AND approved_for_game = true`).

---

## What the brief asks for that we deliberately did NOT add

- Per-moment licensing fields. The brief implies licensing lives at the SONG
  level, not the moment level. We honor that — `licensing_status` lives on
  `songs` only.
- A separate "lyric_text_source" table. The brief says "internally stored
  lyric text that came from a licensed source" — implementing as a column on
  `lyric_moments.lyric_text` is sufficient for now. A separate table would
  be over-design.
- A "moment versioning" table. If we revise a moment's lyric_text after
  licensing review, we update in place and rely on `updated_at`. Audit-trail
  versioning is a deferred Phase 6+ concern.
