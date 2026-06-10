# Project D — Content Admin: Lyric Difficulty + Manual-Entry Cleanup

**Date:** 2026-06-10
**Status:** Approved by Deric (brainstorming session 2026-06-10)
**Worklist items:** 7 (assign difficulty to a lyric), 8 (manually added lyrics have errors)

## Goal

Give the admin direct control over per-lyric difficulty, and clean up + prevent the text/formatting errors in manually added lyrics.

## 1. Per-lyric difficulty selector (item 7)

Decision: manual control (no auto-suggest, no bulk view for now).

- `SongEdit.tsx` (`/admin/songs/:id`): each lyric variant row gets a Low/Medium/High selector writing to the corresponding `gameplay_items.difficulty`.
- `SongNew.tsx` (`/admin/songs/new`): the new-lyric form gets the same selector (defaulting to the song's difficulty).
- New/extended tRPC admin mutation with admin-role guard; updates are audited through the existing admin audit logging (Phases 0–2 infrastructure).

## 2. Manually added lyric cleanup (item 8)

Reported: text/formatting issues in lyrics Deric added via the admin form.

- **Identify:** locate manually created songs/lyrics (via `adminSongs.create` provenance — creator/source fields, falling back to creation-date window if needed).
- **Audit script** (read-only first): flag smart-quote/encoding artifacts (curly quotes, mojibake), doubled/stray whitespace, empty or suspiciously short answers, prompt/answer split anomalies (answer longer than prompt+answer/2 convention, mid-word splits).
- **Fix:** corrections applied by script with a backup table + rollback SQL (same pattern as the 2026-05-02 mass resplit). Deric reviews the flagged list before the write runs.

## 3. Form guardrails (item 8 prevention)

- Normalization on save (server-side, in the admin mutation): straighten smart quotes, collapse whitespace, trim, NFC-normalize unicode.
- Validation: non-empty prompt and answer; answer length sanity (≥1 word, ≤ the prompt's scale); reject control characters.
- **Live preview** in `SongNew`/`SongEdit`: renders the lyric exactly as the gameplay screen will show it (prompt + "..." + answer reveal) before saving.

## Error handling

- Validation failures return field-level messages to the form; nothing partially saves.
- Cleanup script is dry-run by default; the write mode requires an explicit flag and creates the backup table first (single-Supabase topology — this runs against prod).

## Testing

- Unit: normalization/validation functions (quotes, whitespace, splits).
- Integration: difficulty mutation (role-guarded, audited); create-with-validation round trip.
- Manual: Deric re-enters one previously broken lyric and confirms the preview + saved text are clean; spot-check 5 fixed lyrics in real gameplay.

## Out of scope

Bulk difficulty grid, auto-difficulty scoring, lyric content rewrites beyond formatting fixes.
