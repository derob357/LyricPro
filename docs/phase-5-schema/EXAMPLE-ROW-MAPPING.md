# Phase 5a — Example Row Mapping

Three real songs from the live `songs` table (read-only SELECT against the
session pooler). Shows the legacy row, the proposed `songs` row after
adding the new columns, and the proposed `lyric_moments` + `gameplay_items`
rows derived from each existing variant.

All eight scoring columns use `NULL` per the recommended scoring backfill
strategy (option b in `MIGRATION-PLAN.md`).

**Source data**: live SELECT, 2026-05-05. **No writes were issued.**

---

## Example 1 — Pop / song id 218 / "Dancing Queen" by ABBA

### Current row in `songs`

| column            | value                                                       |
| ----------------- | ----------------------------------------------------------- |
| id                | 218                                                         |
| title             | Dancing Queen                                               |
| artistName        | ABBA                                                        |
| genre             | Pop                                                         |
| subgenre          | NULL                                                        |
| releaseYear       | 1976                                                        |
| decadeRange       | 1970–1980                                                   |
| lyricPrompt       | You are                                                     |
| lyricAnswer       | the dancing queen                                           |
| distractors       | ["the dancing dream","the dancing scene","the dancing teen"] |
| lyricSectionType  | chorus                                                      |
| difficulty        | low                                                         |
| explicitFlag      | false                                                       |
| approvalStatus    | approved                                                    |
| isActive          | true                                                        |
| lyricVariants     | (3 entries — listed below)                                  |

### Proposed `songs` row after migration (same row, new columns added)

| new column          | proposed value                                              |
| ------------------- | ----------------------------------------------------------- |
| featured_artist     | NULL                                                        |
| licensing_status    | `internal_only` (default — flip to `cleared` once licensed) |
| approved_for_game   | true                                                        |
| in_curated_bank     | true (ABBA / Dancing Queen is a clear bank-A candidate; curator confirms) |
| curator_notes       | NULL                                                        |

Existing columns (lyricPrompt, lyricAnswer, distractors, lyricVariants,
lyricSectionType, difficulty) STAY in place during the cutover and are
dropped in the post-stability follow-up.

### Proposed `lyric_moments` rows (3 — one per existing variant)

#### Moment row 1

| column                       | value                                                       |
| ---------------------------- | ----------------------------------------------------------- |
| id                           | (auto)                                                      |
| song_id                      | 218                                                         |
| section_type                 | chorus                                                      |
| section_order                | 1                                                           |
| candidate_use_case           | `finish_the_lyric`                                          |
| lyric_text                   | You are the dancing queen                                   |
| lyric_before                 | NULL                                                        |
| lyric_after                  | NULL                                                        |
| low_fit                      | true (parent song.difficulty = low)                         |
| medium_fit                   | false                                                       |
| hard_fit                     | false                                                       |
| song_recognition_fit         | true                                                        |
| artist_recognition_fit       | true                                                        |
| year_fit                     | true                                                        |
| finish_the_lyric_fit         | true                                                        |
| (8 score columns)            | NULL                                                        |
| overall_playability_score    | NULL (auto — generated from NULL inputs)                    |
| reviewer_notes               | Backfilled from legacy lyricVariants index 0                |
| approval_status              | approved                                                    |
| approved_by                  | NULL                                                        |
| approved_at                  | now() at backfill time                                      |

#### Moment row 2

Same boilerplate, differing fields:

| column        | value                                  |
| ------------- | -------------------------------------- |
| section_type  | verse                                  |
| section_order | 2                                      |
| lyric_text    | Young and sweet, only seventeen        |
| reviewer_notes| Backfilled from legacy lyricVariants index 1 |

#### Moment row 3

| column        | value                                                                |
| ------------- | -------------------------------------------------------------------- |
| section_type  | chorus                                                               |
| section_order | 3                                                                    |
| lyric_text    | You can dance, you can jive, having the time of your life            |
| reviewer_notes| Backfilled from legacy lyricVariants index 2                         |

### Proposed `gameplay_items` rows (3 — one per moment)

| moment idx | difficulty | question_type      | prompt_text                                          | correct_answer        | distractor_1         | distractor_2          | distractor_3          |
| ---------- | ---------- | ------------------ | ---------------------------------------------------- | --------------------- | -------------------- | --------------------- | --------------------- |
| 1          | low        | finish_the_lyric   | You are                                              | the dancing queen     | NULL¹                | NULL                  | NULL                  |
| 2          | low        | finish_the_lyric   | Young and sweet, only                                | seventeen             | fifteen              | nineteen              | sixteen               |
| 3          | low        | finish_the_lyric   | You can dance, you can jive, having the              | time of your life     | night of your life   | best of your life     | prime of your life    |

¹ The legacy variant 0 has an empty `distractors` array — it was the
seed-from-legacy variant and never got AI-generated distractors. The
backfill writes NULL into the three distractor columns; the gameplay item
either gets distractors generated later as a Phase 5b QA task, or its
`prompt_format` flips to `typed` and the distractors stay NULL by design.

All three items get `qa_status = 'passed'` and `is_active = true` (they're
already live in production today).

---

## Example 2 — Hip Hop / song id 1 / "The Message" by Grandmaster Flash & The Furious Five

### Current row in `songs`

| column            | value                                                                       |
| ----------------- | --------------------------------------------------------------------------- |
| id                | 1                                                                           |
| title             | The Message                                                                 |
| artistName        | Grandmaster Flash & The Furious Five                                        |
| genre             | Hip Hop                                                                     |
| releaseYear       | 1982                                                                        |
| decadeRange       | 1980–1990                                                                   |
| lyricPrompt       | Don't push me 'cause                                                        |
| lyricAnswer       | I'm close to the edge                                                       |
| distractors       | ["I'm close to the ledge","I'm close to the ridge","I'm close to the hedge"]|
| lyricSectionType  | hook                                                                        |
| difficulty        | low                                                                         |
| explicitFlag      | false                                                                       |
| approvalStatus    | approved                                                                    |
| isActive          | true                                                                        |
| lyricVariants     | (3 entries)                                                                 |

### Proposed `songs` row after migration

| new column          | proposed value                                                          |
| ------------------- | ----------------------------------------------------------------------- |
| featured_artist     | NULL (this is a group, not an artist + feature)                         |
| licensing_status    | `internal_only` → curator flips to `cleared` per licensing review       |
| approved_for_game   | true                                                                    |
| in_curated_bank     | true (foundational hip-hop track; bank-A candidate)                     |
| curator_notes       | NULL                                                                    |

### Proposed `lyric_moments` rows (3)

| idx | section_type | section_order | lyric_text                                                                   | candidate_use_case |
| --- | ------------ | ------------- | ---------------------------------------------------------------------------- | ------------------ |
| 1   | hook         | 1             | Don't push me 'cause I'm close to the edge                                   | finish_the_lyric   |
| 2   | chorus       | 2             | It's like a jungle sometimes it makes me wonder how I keep from going under  | finish_the_lyric   |
| 3   | verse        | 3             | A child is born, with no state of mind Blind to the ways of mankind          | finish_the_lyric   |

All three: `low_fit=true`, `medium_fit=false`, `hard_fit=false`, all four
surface fits = true, all 8 scores = NULL, `approval_status='approved'`.

### Proposed `gameplay_items` rows (3)

| moment idx | difficulty | question_type    | prompt_text                                            | correct_answer                                        | distractor_1                                         | distractor_2                                       | distractor_3                                       |
| ---------- | ---------- | ---------------- | ------------------------------------------------------ | ----------------------------------------------------- | ---------------------------------------------------- | -------------------------------------------------- | -------------------------------------------------- |
| 1          | low        | finish_the_lyric | Don't push me 'cause                                   | I'm close to the edge                                 | NULL¹                                                | NULL                                               | NULL                                               |
| 2          | low        | finish_the_lyric | It's like a jungle sometimes                           | it makes me wonder how I keep from going under        | it makes me think about the things I'm running from  | it makes me feel like I'm losing my mind           | it keeps me questioning just what I'm doing wrong  |
| 3          | low        | finish_the_lyric | A child is born, with no state of mind                 | Blind to the ways of mankind                          | Lost in the darkness of time                         | Living a life so confined                          | Trapped by the sins of mankind                     |

¹ Same caveat as ABBA — legacy seed variant has empty distractor array. Gets
NULLs at backfill, queues for distractor generation as a Phase 5b QA task.

Note that the `songs.distractors` jsonb column on row 1 contains
`["I'm close to the ledge", …]` — those are the distractors for the LEGACY
question (variant 0). They re-appear in `gameplay_items` row 1's
distractors only if we choose to backfill from `songs.distractors` rather
than from `lyricVariants[0].distractors`. Recommended behavior: prefer
`lyricVariants[i].distractors`; if that's empty AND `i = 0`, fall back to
`songs.distractors`. This recovers the legacy distractors for variant 0
without duplicating them on later variants.

---

## Example 3 — R&B / song id 114 / "Let's Get It On" by Marvin Gaye

### Current row in `songs`

| column            | value                                                  |
| ----------------- | ------------------------------------------------------ |
| id                | 114                                                    |
| title             | Let's Get It On                                        |
| artistName        | Marvin Gaye                                            |
| genre             | R&B                                                    |
| releaseYear       | 1973                                                   |
| decadeRange       | 1970–1980                                              |
| lyricPrompt       | Let's get                                              |
| lyricAnswer       | it on                                                  |
| distractors       | ["it down","it in","it all night long"]                |
| lyricSectionType  | hook                                                   |
| difficulty        | low                                                    |
| explicitFlag      | false                                                  |
| approvalStatus    | approved                                               |
| isActive          | true                                                   |
| lyricVariants     | (3 entries)                                            |

### Proposed `songs` row after migration

| new column          | proposed value                                                  |
| ------------------- | --------------------------------------------------------------- |
| featured_artist     | NULL                                                            |
| licensing_status    | `internal_only`                                                 |
| approved_for_game   | true                                                            |
| in_curated_bank     | true                                                            |
| curator_notes       | NULL                                                            |

### Proposed `lyric_moments` rows (3)

| idx | section_type | section_order | lyric_text                                                                       |
| --- | ------------ | ------------- | -------------------------------------------------------------------------------- |
| 1   | hook         | 1             | Let's get it on                                                                  |
| 2   | verse        | 2             | I've been really tryin', baby Tryin' to hold back this feeling for so long       |
| 3   | chorus       | 3             | Let's get it on                                                                  |

> **Edge case flagged**: moment 1 and moment 3 produce the same
> `lyric_text` ("Let's get it on") — moment 1 derives from
> `prompt='Let's get'` + `answer='it on'`, moment 3 from
> `prompt='Let's get it'` + `answer='on'`. The proposed UNIQUE index on
> `(song_id, lyric_text)` would REJECT one of them. Backfill behavior:
> dedupe at the lyric_text level — keep moment 1 (hook), drop moment 3
> (chorus). Both gameplay items still get created, both pointing at
> moment 1's id. The dropped moment doesn't lose any data — it's the same
> line. This is the kind of cleanup the new schema's UNIQUE constraint is
> designed to encourage.
>
> Alternative: use a UNIQUE index on `(song_id, prompt_text)` from the
> `gameplay_items` side, and allow `lyric_moments` to keep duplicates.
> Recommended: keep the lyric_moments UNIQUE — moments are about the LINE,
> not about how we choose to chop it for a prompt.

### Proposed `gameplay_items` rows (3 — even after moment dedup, all 3 items survive)

| moment idx (after dedup) | difficulty | question_type    | prompt_text             | correct_answer                                  | distractor_1                                       | distractor_2                                          | distractor_3                                                |
| ------------------------ | ---------- | ---------------- | ----------------------- | ----------------------------------------------- | -------------------------------------------------- | ----------------------------------------------------- | ----------------------------------------------------------- |
| 1 (the only "Let's get…" moment) | low | finish_the_lyric | Let's get               | it on                                           | NULL                                               | NULL                                                  | NULL                                                        |
| 2 (verse moment)         | low        | finish_the_lyric | I've been really tryin', baby | Tryin' to hold back this feeling for so long | Tryin' to find a way to get you through the night  | Tryin' to keep myself from losin' my mind             | Tryin' to make you understand what I'm feelin' right        |
| 1 (same hook moment, different prompt) | low | finish_the_lyric | Let's get it      | on                                              | now                                                | strong                                                | down                                                        |

Note rows 1 and 3 both reference the same `lyric_moment_id` after dedup —
that's allowed and intentional. One lyric MOMENT can spawn multiple gameplay
ITEMS that chop the same line at different points.

---

## Backfill verifier (recommended)

After backfill, run a read-only verifier that confirms (for every active
approved song):

```sql
WITH legacy AS (
  SELECT id AS song_id, jsonb_array_length(lyric_variants_alias) AS variant_count
  FROM songs, jsonb(lyricVariants) AS lyric_variants_alias
  WHERE isActive = true
),
new AS (
  SELECT song_id, COUNT(*) AS item_count
  FROM gameplay_items
  GROUP BY song_id
)
SELECT legacy.song_id, legacy.variant_count, new.item_count
FROM legacy LEFT JOIN new USING (song_id)
WHERE legacy.variant_count IS DISTINCT FROM new.item_count;
```

Empty result = backfill complete. Any rows in the result = mapping bug;
investigate before flipping the read flag.

(Pseudo-SQL — actual jsonb_array_length syntax in the live `songs` table is
`jsonb_array_length("lyricVariants")` because the column is camelCase-quoted.)
