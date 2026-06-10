# Golden Notes Economy — Manual Test Checklist

Run through this signed in as a normal (non-admin) account on the deployed app. Your account has 100 earned GN from the backfill (plus any purchased GN you already had).

## Stake lifecycle

- [ ] **Setup shows the ante**: `/setup`, Solo mode — the Ante section appears between Streak Insurance and the summary, default 50, "Stakeable: ⟨your earned GN⟩" shown. Steppers move ±25, floor 0, ceiling at your earned balance. Summary grid shows "Ante · 50 GN".
- [ ] **Escrow on start**: start the game — header balance drops by the ante immediately, with the animated count-down and a floating −50.
- [ ] **Win a round** (3 or 4 of 4 correct): results screen shows "+25 GN won · ⟨N⟩ staked remaining" with the Coins icon; header ticks +25.
- [ ] **Lose a round** (0–2 correct): results show "−25 GN from stake · ⟨N⟩ staked remaining"; header does NOT move (the stake was already escrowed).
- [ ] **Finish the game**: remaining stake refunds — header ticks up by the remainder. Check Shop → Recent activity: `stake_escrow`, `stake_win` (per won round), `stake_refund` rows present; no burn rows (burns are tracked in the stake, not the ledger).
- [ ] **Ante 0**: set ante to 0 ("Playing for fun — no stake") — game plays with no stake line on results.
- [ ] **Guest check**: in a private window, guest quick-start from `/` — no ante anywhere.
- [ ] **Abandonment**: start a staked game, quit to home mid-game. The hourly cron refunds it after the 6h cutoff — verify next day, or trigger by hand: `curl -H "Authorization: Bearer $CRON_SECRET" https://playlyricpro.com/api/cron/stake-refund-sweep` (after 6h) and check the refund transaction.

## Pools & Shop

- [ ] **Pool split**: Shop balance card still shows one total. Ante max only reflects EARNED GN (purchased GN can't be staked — try a fresh account with only a Stripe pack if you want to verify the cap excludes it).
- [ ] **Advanced Mode gone**: Shop spend section has no Advanced Mode cards.
- [ ] **Extra Game**: free-tier account at the 2-games-today limit → buy Extra Game (1 GN) → a third game starts. Balance drops 1 (purchased pool first).
- [ ] **Tournament card**: single "Tournament Entry" card routes to /tournaments; joining there still debits correctly.
- [ ] **Hint + Streak Insurance** still work; Recent activity now labels them `spend_hint` / `spend_streak_insurance` (old rows keep their historical label).
- [ ] **Signup grant**: brand-new account → 100 GN appears on first sign-in ("Welcome bonus" in activity).

## Animations

- [ ] Header balance count-tweens on every change with a floating +N/−N note.
- [ ] System reduced-motion ON → numbers jump instantly (no tween), deltas still appear, confetti still skipped on results.

## Known follow-ups (not bugs)

- Velocity cap (10 staked games/hour) is advisory under extreme concurrency.
- Burns don't appear in the transaction list by design (no balance movement); the stake row is the audit.
