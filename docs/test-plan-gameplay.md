# Test Plan — Trivia-Show-Style Multiple-Choice Gameplay

Scope: the full-MC redesign of `client/src/pages/Gameplay.tsx` and
`server/routers/game.ts#getNextSong`, including the 3-stage main/artist/year
flow, shared timer, buzz-in mechanic, and single-player solo layout.

Environment: `pnpm dev`, Chromium + Safari, desktop 1440×900 + mobile 390×844
(DevTools device toolbar).

---

## 1. Server — `getNextSong` (distractor generation)

### 1.1 Four options always returned
- **Setup:** start any room with a genre/decade that has ≥4 approved songs.
- **Action:** call `game.getNextSong`.
- **Expect:** response includes `lyricOptions`, `titleOptions`, `artistOptions`, `yearOptions`, each with **exactly 4** entries.

### 1.2 Correct answer is always one of the options
- For each field, assert `options.includes(song.field)` is true.

### 1.3 No duplicate options within a field
- For each field array, `new Set(options).size === 4`.

### 1.4 Distractor pool respects genre + decade
- **Setup:** R&B / 2010s room.
- **Expect:** distractor titles/artists come from other R&B 2010s songs when ≥3 are available. When candidate pool <3, fallback to any approved song is used (verified by log or by selecting a rare genre/decade combo).

### 1.5 Year options are plausible
- Four distinct years including `releaseYear`; remaining three at offsets of roughly ±2/±4/±6; no duplicates; loop cannot run forever (bounded to 12 random attempts + deterministic top-up).

### 1.6 Unknown edge cases
- Room with exactly 1 approved song in the candidate set: still returns 4 options (distractors pulled from fallback pool).
- Room where all songs have been used (`usedSongIds` saturated): the existing fallback chain still picks a song; `getNextSong` does not throw.

---

## 2. Client — Gameplay UI

### 2.1 Visual parity with the approved mockup
- Dark blue-purple canvas, radial primary + accent orbs in the background.
- Large round-number circle (e.g. `01`) on the left with purple glow.
- Title renders as purple→cyan gradient (`text-gradient`), stage badge to the right.
- Prize value as gold text with glow (`.neon-gold`).
- Timer pill next to the value; ticks down each second.
- "Ghost" number-word (e.g. `one`, `two`) behind the content, right-aligned, very low-opacity purple.
- 4 MC options in a 2-column grid on desktop, 1-column on mobile; each option has a numbered chip `1–4` plus an uppercase cyan label.

### 2.2 Responsiveness
- At 390px width: header wraps cleanly, MC options stack, player panel(s) don't overflow.
- At 1440px: ghost number clipped on the right without causing horizontal scroll.

### 2.3 Theme
- Uses only existing CSS variables from `index.css`. No regressions on the rest of the app (check Home, Lobby, Profile still render).

---

## 3. Three-stage flow (single shared timer)

### 3.1 Stage progression — Low / Medium difficulty
- **Setup:** solo game, difficulty = medium.
- **Expect order:**
  1. Stage 1 "Name That Song!" — shows full lyric, MC of titles.
  2. On click → Stage 2 "Bonus: Who's the Artist?" — MC of artists.
  3. On click → Stage 3 "Bonus: What Year?" — MC of years.
  4. On click → submission; round-result screen appears.
- Each stage uses the correct point value badge (25/25/50 for low, 50/50/100 for medium).

### 3.2 Stage progression — High difficulty
- Stage 1 shows **partial lyric** (`lyricPrompt` with "…"), MC of lyric completions.
- Points show 50 / 100 / 200.
- Submitted answer mapped to `lyricAnswer`, not `titleAnswer`.

### 3.3 Shared timer across stages
- **Setup:** 30-second timer.
- **Action:** advance Stage 1 at ~t=25s, Stage 2 at ~t=18s, Stage 3 at ~t=10s.
- **Expect:** timer never resets between stages; continues counting down.

### 3.4 Timer expires mid-flow
- Let the timer run out during Stage 2 (user answered Stage 1 but not artist/year).
- **Expect:** submission auto-fires with `answers.title` populated, `answers.artist` and `answers.year` empty; server scores Title only; round-result screen shown.

### 3.5 All-empty timeout
- Let the timer expire without answering any stage.
- **Expect:** submission with all fields empty; score = 0; round-result screen appears.

### 3.6 Pass button
- Click "Pass this round" during any stage.
- **Expect:** skips straight to next round (bypasses round-result per existing behavior), score unchanged.

### 3.7 Correct-answer highlight (regression check)
- Round result screen still shows the correct answers for all three fields.

---

## 4. Buzz-in (multiplayer only)

### 4.1 MC is gated until buzz-in
- **Setup:** multiplayer room with ≥2 players, stage = main.
- **Expect:** "Press your buzzer key to answer" badge visible. All MC buttons are disabled.

### 4.2 Keyboard claims turn
- Press `Q` (player 1).
- **Expect:** buzz-key badge on panel 1 glows cyan (ring + glow); MC becomes clickable for **me** if I am player 1.

### 4.3 Desaturation for non-buzzers
- On a second browser/window logged in as player 2, after player 1 buzzes.
- **Expect:** player 2's screen drops to 40% saturation and 80% brightness; MC remains disabled for player 2.

### 4.4 Per-stage re-open
- Player 1 buzzes and answers Stage 1.
- **Expect:** on transition to Stage 2, `buzzedPlayerIndex` resets; desaturation clears; both players see the gate again and can buzz for Stage 2.

### 4.5 Unknown key press
- Press a key outside `q b p y w e`.
- **Expect:** no state change.

### 4.6 Player count > buzz key count
- Room with 7 players (edge).
- **Expect:** first 6 have badges; 7th has no badge and can't buzz via keyboard. (Document as known limitation.)

---

## 5. Solo mode

### 5.1 Single player panel
- **Setup:** solo room.
- **Expect:** exactly one player panel centered, no buzz-key badge, MC buttons are clickable immediately (no gate).

### 5.2 Score display
- Correctly reflects `myPlayer.currentScore` after each round, formatted as `$NN`.

### 5.3 Streak flame
- Answer ≥2 correctly in a row under `streak_bonus` mode.
- **Expect:** orange flame badge appears both in the top-bar streak indicator and the bottom-left corner of the player panel.

---

## 6. Scoring parity with Batch 6 point values

For each difficulty, answer all 3 MC questions correctly:

| Difficulty | Main | Artist | Year | Expected total |
|------------|------|--------|------|----------------|
| low        | 25   | 25     | 50   | 100            |
| medium     | 50   | 50     | 100  | 200            |
| high       | 50   | 100    | 200  | 350            |

### 6.1 Near-miss scoring preserved
- On medium difficulty, pick an incorrect year that's within 2 years of the correct one (if one exists among the MC options — rare since distractors are ±2/±4/±6).
- **Expect:** server's `yearClose2` / `yearClose3` logic still applies if the picked year is within ±2/±3. (Mostly N/A for strict MC but verify no crash.)

### 6.2 Passing logic
- Pass mid-game.
- **Expect:** `passUsed=true` on the round result; skips to next round; no celebration overlay.

---

## 7. Regressions outside Gameplay

### 7.1 Other pages render unchanged
- Home, GameSetup, Lobby, Profile, Leaderboards, UserDashboard, AdminDashboard, RoundResults, FinalResults all render without console errors.

### 7.2 Vitest scoring suite
- `pnpm test` → `server/scoring.test.ts` still passes all 54 tests.

### 7.3 Typecheck
- `pnpm check` → 0 errors.

### 7.4 Build
- `pnpm build` → succeeds; bundle size within tolerance of previous build.

---

## 8. Security / abuse

### 8.1 MC selection cannot inject HTML
- Temporarily seed a song with `title = '<script>alert(1)</script>'` in the DB (local only).
- **Expect:** the option renders the literal text; no script executes.

### 8.2 Malicious client bypassing stages
- Using DevTools, directly call `trpc.game.submitAnswer` with all four fields filled correctly, skipping the UI stages.
- **Expect:** server accepts and scores normally. (Documented accepted behavior — staging is UX only, not a security boundary.)

### 8.3 Year-options loop bounded
- Seed a song with `releaseYear = 0` (contrived) and call `getNextSong`.
- **Expect:** returns promptly with 4 year options; no hang.

### 8.4 No new public endpoints
- `grep -r "publicProcedure" server/routers/game.ts` → same count as before the change.

### 8.5 Audit trail
- Round-results table still receives an entry per submission with the same shape (no new sensitive fields leaked).

---

## 9. Cross-browser smoke

Run Sections 2, 3, 5 on:
- Chrome latest (desktop + mobile)
- Safari 17+ (macOS)
- Firefox latest (desktop)

Watch for: OKLCH color rendering, `filter: saturate()` transition, `backdrop-filter: blur` on player panels, `@keyframes` timer pulse.

---

## 10. Exit criteria

- Every Section 1–8 test passes.
- No uncaught console errors during a full 10-round solo game at each difficulty.
- Stripe-dependent test file (`auth.logout.test.ts`) either remains the same pre-existing failure or is fixed in a separate ticket; not a blocker for this change.
