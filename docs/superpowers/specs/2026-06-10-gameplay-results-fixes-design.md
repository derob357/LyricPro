# Project A — Gameplay & Results Fixes

**Date:** 2026-06-10
**Status:** Approved by Deric (brainstorming session 2026-06-10)
**Worklist items:** 1 (scoring bug), 2 (round-passed copy), 5 (difficulty descriptions), 6 (auto-advance verification), 10 (score breakdown), 11 (celebration timing)

## Goal

Fix the cluster of solo-game scoring/results bugs: incorrect match scoring in both directions, a misleading "Round Passed" banner on zero-score rounds, an incomplete score breakdown, stale difficulty copy, and a celebration that fires on the wrong event.

## 1. Scoring-match audit (item 1)

Observed: correct answers sometimes score 0; wrong answers sometimes score points. Gameplay is multiple-choice, so both directions point at two suspects:

- **Option generation** — the "correct" MC option text not string-matching the canonical answer the server compares against (punctuation, casing, featured-artist suffixes, smart quotes).
- **Matchers** — `matchLyric` / `matchArtist` / `scoreYear` in `server/_core/scoring.ts` over- or under-matching.

Design:

- Build a test suite in `server/scoring.test.ts` (extend existing) attacking both directions: leading "The", featured artists ("feat." / "ft." / "&"), apostrophes and smart quotes, accents, year as string vs number, partial-overlap false positives.
- Write a read-only analysis script sampling recent `round_results` rows joined to the songs/options actually served, flagging rows where the chosen option text equals the canonical answer but points were 0, and vice versa. (Single-Supabase topology: read-only queries only.)
- Fix the bugs the failing tests expose. The fix lands in `_core/scoring.ts` and/or the option-generation path so solo and multiplayer both inherit it.

## 2. Score breakdown shows all four rows (items 1 + 10)

`client/src/pages/RoundResults.tsx` currently hides the Lyric row except on High difficulty.

- Show **Lyric, Song Title, Artist, Release Year** rows at every difficulty, each as `earned / max`:
  - Lyric: 25 / 50 / 50 (low / medium / high)
  - Title: 25 / 50 / 50
  - Artist: 25 / 50 / 100
  - Year: 50 / 100 / 200
- Speed Bonus and Streak Bonus rows remain conditional (shown when > 0).
- Total row unchanged.

## 3. Zero-score banner (item 2)

There is no pass/skip feature in the game; the `passedRound` heuristic (`RoundResults.tsx:121`) is vestigial and fires on all-wrong rounds.

- Remove `passedRound` logic and the "Round Passed" banner entirely.
- When `result.total === 0`, show encouraging copy above the normal breakdown: **"Tough Round — no points this time. The next one's yours."** Keep the existing muted styling; outline lucide icon (no emoji, per project convention).

## 4. Difficulty descriptions (item 5)

`GameSetup.tsx` descriptions are stale ("Full lyric shown — name song, artist & year") and advertise wrong maxes (100/200/450).

- New copy per difficulty states **4 questions per round — finish the lyric, name the title, artist & year** and the true engine maxes: **125 (Low) / 250 (Medium) / 400 (High)**. The scoring engine is not changed.

## 5. Auto-advance verification (item 6)

The last-answer submit already auto-navigates to `/results/round/:roomCode` after ~600ms (`Gameplay.tsx:118`). No observed failure — this is verification only.

- Add regression tests covering: normal 4th-answer submit → navigation; timer-expiry submit path; submit mutation error (should surface a retry, not hang).
- Fix only what the tests expose.

## 6. Celebration timing (item 11)

Celebration (confetti + chime via `Celebration.tsx`) currently fires on the **Next Round** click. Move it to fire when the results screen mounts.

- Trigger celebration as soon as the round result is loaded on `RoundResults` mount, using the existing intensity levels (1–2 / 3 / 4 correct).
- "Next Round" advances immediately — no celebration gate on it.
- Audio architecture (research deltas D5):
  - Module-level **AudioContext singleton** (`client/src/lib/audioContext.ts`), never per-mount; `unlockOnGesture()` called from gameplay answer clicks.
  - **Capacitor iOS:** one-time silent `<audio>` element play on first gesture to kick the WKWebView audio session (Web Audio respects the silent switch — unfixed WebKit bug 237322).
  - `visibilitychange` listener resumes a suspended/interrupted context (Safari quirk).
- Confetti: defer first frame via `requestAnimationFrame` after mount; respect `prefers-reduced-motion` (skip particles, keep the score reveal).

## Error handling

- Scoring fixes must not throw on malformed legacy rows — unmatched shapes score as "none", logged server-side.
- Celebration/audio failures stay non-fatal (existing pattern: silently skip).

## Testing

- Unit: matcher/option-generation suite (both directions), breakdown row rendering per difficulty, zero-score copy rendering.
- Regression: auto-advance paths (normal, timer expiry, error).
- Manual: one Low and one High solo game on desktop + iOS Capacitor build — verify all four rows, celebration on results load, chime audible (silent switch on/off noted).

## Out of scope

Multiplayer reveal-screen changes; any point-value rebalance; ante/economy (Project C).
