# Golden Notes — Design

**What**: an in-account virtual currency. Users buy packs of Golden Notes (GN) on the web, then spend them across web and mobile to unlock extra daily games, enter special tournaments, gift to friends, and unlock advanced modes.

**Why**: monetization that survives App Store / Play review. GN are never *sold* on mobile — only displayed and spent — which keeps us out of Apple §3.1.1's "digital goods require IAP" trap.

## Key properties

- **Integer count.** No fractional notes. Display as "✨ 12 Golden Notes" or similar.
- **No cash value.** Non-redeemable, non-transferable outside the gifting path.
- **Cross-device.** Balance lives in Postgres; web and mobile both read it via the same tRPC procedure.
- **Gift lifecycle.** Gifter's balance decrements immediately; recipient gets a notification and balance credit on acceptance (or auto-accept after 7 days).
- **Expiry.** 18-month shelf life to bound long-term liability. Notification 30 days before expiry.
- **Transaction log.** Every credit/debit recorded for audit + user-facing history.
- **Stripe-backed purchases only.** Webhook is the source of truth for credits (no client-side tRPC procedure can mint notes; same discipline as the Stripe hardening we did earlier).

## Pricing

| Pack | GN | USD | Effective $/GN | Notes |
|------|----|----:|----------------|-------|
| Starter | 10 | $1.99 | $0.199 | |
| Regular | 50 | $7.99 | $0.160 | |
| Pro | 150 | $19.99 | $0.133 | best seller |
| Mega | 500 | $49.99 | $0.100 | |
| Ultra | 1200 | $99.99 | $0.083 | max pack |

## Spend paths

| Action | Cost (GN) | Notes |
|---|---:|---|
| Extra game after daily limit | 1 | |
| Special tournament entry | varies | set per-tournament in admin |
| Advanced mode session (30 min) | 5 | |
| Advanced mode day pass | 20 | |
| Gift to a friend | 10 minimum | recipient gets 10 GN |

## Data model

### `golden_note_balances`
Per-user balance. One row per user.

| Column | Type | Notes |
|---|---|---|
| userId | int PK FK users.id | |
| balance | int NOT NULL DEFAULT 0 | current GN count |
| lifetime_purchased | int NOT NULL DEFAULT 0 | for analytics |
| lifetime_spent | int NOT NULL DEFAULT 0 | |
| lifetime_gifted_sent | int NOT NULL DEFAULT 0 | |
| lifetime_gifted_received | int NOT NULL DEFAULT 0 | |
| last_purchase_at | timestamp nullable | |
| created_at | timestamp | |
| updated_at | timestamp | |

### `golden_note_transactions`
Every credit/debit. Insert-only; never updated.

| Column | Type | Notes |
|---|---|---|
| id | serial PK | |
| userId | int NOT NULL FK users.id | the account affected |
| amount | int NOT NULL | signed: positive credit, negative debit |
| kind | enum | `purchase` / `spend_extra_game` / `spend_tournament` / `spend_advanced_mode` / `gift_sent` / `gift_received` / `refund` / `expiry` / `admin_adjustment` |
| reason | varchar(256) nullable | free-text for audit |
| related_user_id | int nullable FK users.id | gift counterparty |
| stripe_payment_intent_id | varchar(256) nullable | purchase link |
| balance_after | int NOT NULL | snapshot for easy account reconstruction |
| created_at | timestamp | |

### `golden_note_gifts`
Pending gifts (if the recipient hasn't claimed yet). Removed on accept/decline/expire.

| Column | Type | Notes |
|---|---|---|
| id | serial PK | |
| sender_user_id | int NOT NULL FK | |
| recipient_user_id | int NOT NULL FK | |
| amount | int NOT NULL | |
| message | text nullable | |
| status | enum | `pending` / `accepted` / `declined` / `expired` |
| expires_at | timestamp | 7 days out |
| created_at | timestamp | |
| resolved_at | timestamp nullable | |

## tRPC surface

```
goldenNotes.getMyBalance()                        → { balance, lifetime_* }
goldenNotes.getTransactions({ limit })            → [{ amount, kind, ... }]
goldenNotes.createPurchaseCheckout({ packId })    → { checkoutUrl }   (Stripe Checkout)
goldenNotes.spend({ kind, amount, reason })       → { newBalance }    (protected; validates kind+amount)
goldenNotes.sendGift({ recipientEmail, amount, message }) → { giftId }
goldenNotes.getPendingGifts()                     → [{ sender, amount, message, expires_at }]
goldenNotes.acceptGift({ giftId })                → { newBalance }
goldenNotes.declineGift({ giftId })               → { success }
```

## Purchase flow

1. Web user clicks a pack on `/shop`.
2. `goldenNotes.createPurchaseCheckout({ packId })` → returns Stripe Checkout session URL.
3. User redirected to Stripe, pays, redirected back to `/shop?status=success`.
4. Stripe webhook fires `checkout.session.completed` with `metadata.type = "golden_notes"` and `metadata.packId`.
5. Webhook handler:
   - Looks up pack → determines GN amount.
   - Inserts a `golden_note_transactions` row (`kind: purchase`, positive amount).
   - Atomically increments `golden_note_balances.balance` and `lifetime_purchased`.
6. Client polls / refetches `getMyBalance()` → shows the new balance.

## Security posture

- **Purchase minting = webhook only.** No client-callable "credit my account" procedure exists. Matches the Stripe hardening we did earlier for add-on games and subscriptions.
- **Spend validation on server.** `spend` validates the `kind` matches a known action and the `amount` matches the server's price table (no client-supplied prices).
- **Gift race condition.** Use a transaction when sending: decrement sender balance AND insert the gift atomically. If either fails, both roll back.
- **Anti-abuse.** Rate limit `sendGift` at 20/day/user to prevent spam-gifting someone into notification hell.
- **RLS (when step 6 lands).** `golden_note_balances` and `golden_note_transactions` policies: user can SELECT their own rows only. Admin can SELECT all.

## Mobile behavior (Path 1)

- Native app **shows** balance pulled from `getMyBalance()`.
- Native app **can spend** (extra game, tournament entry, advanced mode) — these are "consumption" which Apple allows in app.
- Native app **cannot purchase**. The Shop page renders a "Visit the LyricPro Ai website to add Golden Notes to your account" message with no deep link (Apple §3.1.3(a): no in-app directions to alternative payment methods).
- Native app **cannot gift** (avoids "gifting is a purchase" edge cases). Gifts stay web-only for now.

## What this session will actually build

1. Schema migration + Drizzle types.
2. tRPC procedures (getMyBalance, getTransactions, spend, createPurchaseCheckout stub).
3. Stripe webhook branch for `golden_notes` (wired, untriggered until real keys).
4. Shop page with 5 packs, balance header.
5. Nav link to `/shop` on the top bar.
6. Gift UI + accept/decline — **deferred to a follow-up**; this session scope is purchase + balance + spend.
7. Admin page to list pending Stripe webhook events for Golden Notes — **deferred**.

Gifting is a whole auxiliary flow (notifications, claim page, expiry cron). Landing the purchase-and-spend loop first keeps this session focused.
