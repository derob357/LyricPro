# Project C — Golden Notes Economy: Ante, Pool Split, Shop, Tests

**Date:** 2026-06-10
**Status:** Approved by Deric (brainstorming session 2026-06-10)
**Worklist items:** 4 (Notes ante + animation, spec via Jim), 12 (test spending Notes + implement Shop purchases)
**Research deltas folded in:** D1 (App Store gambling risk), D2 (race-safe debits), D3 (escrow refunds), D6 (anti-abuse)

## Goal

Introduce a round-stake ("ante") mechanic on Golden Notes with visible balance animations, split the currency into earned vs purchased pools for App Store compliance, harden all debit paths, implement the real Shop purchases, and test every spend path.

## 1. Pool split (D1 — App Store compliance)

Apple Guideline 5.3 treats wagering real-money-purchasable currency as gambling. GN is sold via Stripe and the app ships via Capacitor, so:

- `golden_note_balances` gains `earned_balance` and `purchased_balance`. The existing `balance` column is kept and maintained as the sum of both pools (single source for all existing display/read paths; the ledger helpers update all three atomically).
- **Earned GN**: stakeable. Sources — stake winnings, practice-pack rewards (existing 4 GN moves here), one-time signup grant.
- **Purchased GN**: never stakeable. Sources — Stripe packs, admin credits. Spendable on hints, streak insurance, tournament entry, Extra Game.
- Non-stake spends draw **purchased first**, then earned (preserves stakeable funds).
- Migration: existing balances move to `purchased_balance` (provenance is overwhelmingly Stripe/admin).
- UI: header shows one total; the ante field surfaces "stakeable: N".

## 2. Earning paths + signup grant

- **+25 earned GN per won round** in a staked game (see §3).
- Practice-pack reward (4 GN, `insights.ts`) credits earned pool.
- **One-time 100 earned GN signup grant** for new accounts; one-time backfill grant of 100 earned GN to existing accounts when the feature ships (idempotent — keyed transaction kind so reruns are no-ops).

## 3. Ante mechanic (item 4 — Jim's spec, refined)

Solo games, signed-in players only (guests never see it; multiplayer staking is out of scope — economy is P5-deferred there).

- **Setup:** ante field on `GameSetup`, default **50**, adjustable in steps of 25 down to **0** (0 = casual game, no stake), capped at the player's earned balance. If earned balance is 0 the field shows 0 with a hint pointing at how to earn.
- **Escrow:** on game start the ante is debited from `earned_balance` into a `gn_stakes` row: `(id, room_id, user_id, staked, burned, won, state: active|settled|refunded, idempotency_key, created_at, settled_at)`. Debit uses the race-safe helper (§4).
- **Round resolution** (a round = 4 questions; **won = 3 or 4 correct**, lost = 0–2 correct):
  - Lost round: burn `min(25, remaining stake)` — burned GN is destroyed (deflationary sink), not paid to anyone.
  - Won round: credit **+25** to `earned_balance` immediately; exception (D6): a round with **0 correct answers never pays out** regardless of any other condition.
- **Settlement:** at game completion, remaining stake refunds to `earned_balance`; stake row → `settled`.
- **Abandonment (D3):** scheduled job (Vercel cron) refunds remaining stake on `active` stakes older than 6 hours whose game isn't completed; idempotent via state transition + unique compensating transaction.
- **Anti-abuse (D6):** max 10 staked games per account per hour (server-enforced); 0-correct rounds never pay.

## 4. Race-safe debit refactor (D2)

`game.ts` hint (≈line 960) and streak-insurance (≈line 157) debits hand-roll balance updates without a balance guard — a double-spend window. Both move onto the shared `_core/goldenNotesLedger.ts` helpers, extended to be **pool-aware**:

- `spendGoldenNotes(tx, userId, cost, kind, reason, { pool: "purchased-first" | "earned-only" })` — atomic `UPDATE … WHERE … balance >= cost RETURNING`; throws typed insufficient-funds error.
- Idempotency-key column on `golden_note_transactions` (unique, nullable) for client-retried mutations (ante debit, Extra Game).
- New transaction kinds: `stake_escrow`, `stake_burn`, `stake_win`, `stake_refund`, `signup_grant`, `spend_extra_game` (existing, finally used), and hints get their own `spend_hint` kind (today mislabeled `spend_advanced_mode`).

## 5. Balance animation (Jim)

- Header balance (`PersistentHeader`) animates on any change: count-up/down tween plus a floating `+N` / `−N` indicator with an outline lucide note icon (project rule: no emoji/filled icons).
- Round results: animated stake line — "−25 from stake" on a lost round, "+25 won" on a won round, with the running stake remaining.
- Driven by comparing previous/next values from the existing tRPC balance query (plus an optimistic event from known spends); no realtime infra needed.
- Respects `prefers-reduced-motion` (numbers update without tween).

## 6. Shop changes (item 12)

- **Remove "Advanced Mode" cards** (30 min / Full Day) — no feature exists behind them. (Decision: define later, not in this project.)
- **Gifting stays deferred** — "Coming soon" card unchanged; `golden_note_gifts` table remains dormant.
- **Tournament Entry:** wire existing server `tournaments.payEntry` (already race-safe, already splits prizes) into the Shop/Tournaments UI — join buttons with cost, insufficient-funds state, success routing.
- **Extra Game (1 GN):** new mutation — spends 1 GN (purchased-first), records `spend_extra_game`, and grants +1 play beyond the tier limit by making `subscriptionEnforcement.ts` count unconsumed `spend_extra_game` credits. Free tier (2 lifetime) and paid tiers (1/day) both honored.

## 7. Testing (item 12)

- **Unit:** pool-aware debit (sufficient/insufficient per pool, draw order), stake lifecycle (escrow → burn/win → settle; refund on abandonment; idempotent reruns), velocity cap, 0-correct no-payout, signup-grant idempotency.
- **Integration:** hint, streak insurance, tournament entry, Extra Game — each spend path end-to-end through tRPC including concurrent double-submit (idempotency).
- **Manual checklist** (committed as `docs/superpowers/specs/2026-06-10-gn-manual-test-checklist.md` during implementation): play a staked game and observe escrow/burn/win/refund + animations; buy each Shop item; verify header animation on every change.

## Error handling

- Insufficient funds → typed error, friendly client message, never a silent 0-stake game.
- Stake settlement failures must not block game completion — settlement retries via the cron path.
- All migrations hand-written `00NN` + runner (project convention); single-Supabase topology — runs apply to prod.

## Out of scope

Gifting, Advanced Mode, multiplayer staking, monthly subscription GN credits, cash-out of any kind (never).
