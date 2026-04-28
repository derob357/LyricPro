# Payment Page (Tier/Rank Display) + Avatar Locker — Design

**Date**: 2026-04-27
**Status**: Drafted, awaiting review
**Builds on**: v0.3.0 Golden Notes work (`docs/golden-notes-design.md`)

---

## 1. Goals & non-goals

### In scope

1. **Modify `/shop`** — add a "Status" header showing the user's subscription tier (`free / player / pro / elite`) and rank tier (`Rookie → Legend`) above the existing Golden Notes pack grid.
2. **New `/avatars` page** ("Avatar Locker") — catalog of avatars with unlock-with-Golden-Notes and equip.
3. **Schema additions** — `avatars` catalog table, `user_avatars` ownership table, `users.equipped_avatar_id`, new enum value `spend_avatar_unlock`.
4. **New tRPC router `avatars`** — `list`, `unlock`, `equip` procedures.
5. **Render the equipped avatar everywhere a user is shown** — PersistentHeader, Profile, Leaderboards rows, Gameplay, FinalResults — via a new shared `<UserAvatar />` component.
6. **Initial catalog of 8 SVG avatars** — 2 free starters, 6 GN-locked at 25 / 25 / 50 / 50 / 100 / 200 GN. Stubs committed to `client/public/avatars/`, replaced with real artwork before launch.

### Out of scope (explicit non-goals)

- New Stripe wiring — the `goldenNotes.createPurchaseCheckout` flow from v0.3.0 stays untouched; this design only consumes it.
- Wiring the existing `goldenNotes.spend` procedure into actual gameplay buttons (extra game / advanced mode / tournament entry) — separate task, listed as a follow-up.
- AI-generated avatars, user-uploaded avatars, full avatar customizer.
- Rank- or subscription-gated avatars (decision: pure pay-to-unlock).
- Mobile-app changes beyond rendering the equipped avatar — App Store policy ban on in-app purchase still applies; `/avatars` will be web-only for unlock, view-only on native.
- "Manage plan →" link on `/shop` Status header — link target is the existing subscription surface; no new subscription UI.

---

## 2. Page structure

### `/shop` (modified)

Existing layout preserved. New "Status" strip inserted above the pack grid.

```
┌─────────────────────────────────────────────────────────┐
│ Golden Notes Shop                          ✨ Balance   │
│                                            12,500       │
│                                                         │
│ ┌──────── Status ──────────────────────────────────┐    │  ← NEW
│ │ Membership: [Pro plan]   Rank: [Expert · 2,840]  │    │
│ │ Manage plan →            View profile →          │    │
│ └───────────────────────────────────────────────────┘   │
│                                                         │
│ Buy a pack                                              │
│  [Starter] [Regular] [Pro] [Mega] [Ultra]               │  (existing)
│                                                         │
│ Looking to unlock avatars? → Visit the Avatar Locker    │  ← NEW link
│                                                         │
│ Recent activity ...                                     │  (existing)
└─────────────────────────────────────────────────────────┘
```

Tier collision callout: "Pro" exists in both scales. Labels disambiguate — `Membership: Pro plan` vs `Rank: Pro`.

### `/avatars` (new)

```
┌─────────────────────────────────────────────────────────┐
│ Avatar Locker                              ✨ 12,500    │
│                                                         │
│ Currently equipped: [🎤 Neon Mic]                       │
│                                                         │
│ Owned (3)                                               │
│ ┌────┐ ┌────┐ ┌────┐                                    │
│ │ 🎤 │ │ 🎧 │ │ 🎵 │   ← click to equip                  │
│ │ ✓  │ │    │ │    │                                    │
│ └────┘ └────┘ └────┘                                    │
│                                                         │
│ Available to unlock                                     │
│ ┌────┐  ┌────┐  ┌────┐  ┌────┐                          │
│ │ 🌟 │  │ 👑 │  │ 💎 │  │ 🔥 │                          │
│ │25✨│  │50✨│  │100✨│ │200✨│                          │
│ └────┘  └────┘  └────┘  └────┘                          │
│                                                         │
│ Need more Golden Notes? → Visit the Shop                │
└─────────────────────────────────────────────────────────┘
```

- Click an owned avatar → `avatars.equip` mutation (no GN spent).
- Click a locked avatar → confirmation modal showing price → `avatars.unlock` mutation → on success, auto-equip and refetch.
- Insufficient balance → CTA changes to "Get more Golden Notes" linking to `/shop`.

### Navigation

- **PersistentHeader (top nav)** — existing GN balance pill stays linked to `/shop`. Add "Avatars" entry to the user dropdown menu.
- **Profile page** — add a "Manage avatars" button linking to `/avatars`.

### Initial catalog (8 avatars)

| # | Slug | Name | Rarity | Price (GN) |
|---|---|---|---|---|
| 1 | `default-mic` | Default Mic | starter | 0 |
| 2 | `default-headphones` | Default Headphones | starter | 0 |
| 3 | `vinyl-spinner` | Vinyl Spinner | common | 25 |
| 4 | `neon-mic` | Neon Mic | common | 25 |
| 5 | `gold-record` | Gold Record | rare | 50 |
| 6 | `crown-singer` | Crown Singer | rare | 50 |
| 7 | `diamond-note` | Diamond Note | epic | 100 |
| 8 | `inferno-star` | Inferno Star | legendary | 200 |

New users get `default-mic` auto-granted via `acquired_via='starter'` at signup, and it's set as their `equipped_avatar_id` on signup.

---

## 3. Data model

### New: `avatars` (catalog table)

| Column | Type | Notes |
|---|---|---|
| id | serial PK | |
| slug | varchar(64) UNIQUE NOT NULL | URL/asset key, e.g. `neon-mic` |
| name | varchar(128) NOT NULL | display name |
| imageUrl | varchar(256) NOT NULL | path under `/avatars/` |
| rarity | `avatar_rarity` enum NOT NULL | for badge UI |
| priceGn | int NOT NULL DEFAULT 0 | 0 = free starter |
| isActive | boolean NOT NULL DEFAULT true | toggle off without deleting |
| sortOrder | int NOT NULL DEFAULT 0 | grid ordering |
| createdAt | timestamp NOT NULL DEFAULT now() | |

### New: `user_avatars` (ownership table)

| Column | Type | Notes |
|---|---|---|
| userId | int NOT NULL FK users.id | |
| avatarId | int NOT NULL FK avatars.id | |
| acquiredAt | timestamp NOT NULL DEFAULT now() | |
| acquiredVia | `avatar_acquired_via` enum NOT NULL | `starter` / `purchase` / `admin_grant` |
| spentGn | int NOT NULL DEFAULT 0 | snapshot of price paid |
| **PK** | `(userId, avatarId)` | composite — prevents double-ownership |

### Modified: `users`

Add column: `equipped_avatar_id int NULL FK avatars.id`. Nullable so existing users without a row default to the starter avatar in the UI.

### Modified: `golden_note_transaction_kind` enum

Add value: `spend_avatar_unlock`.

### New enums

- `avatar_rarity`: `starter / common / rare / epic / legendary`
- `avatar_acquired_via`: `starter / purchase / admin_grant`

### Migration

A single Drizzle migration:
1. Create the two new enums.
2. Create `avatars` and `user_avatars` tables.
3. Add `users.equipped_avatar_id` column.
4. `ALTER TYPE golden_note_transaction_kind ADD VALUE 'spend_avatar_unlock'`.
5. Seed the 8 catalog rows (idempotent: `INSERT ... ON CONFLICT (slug) DO NOTHING`).
6. Backfill: for every existing user, insert `(userId, default-mic.id, 'starter', 0)` into `user_avatars` `ON CONFLICT (userId, avatarId) DO NOTHING`, and set `users.equipped_avatar_id = default-mic.id` only where currently NULL. Both halves are idempotent so re-running the migration is safe.

---

## 4. Server (tRPC) surface

New router `server/routers/avatars.ts`, mounted on the app router as `avatars`.

```ts
avatars.list()
  → {
      catalog: { id, slug, name, imageUrl, rarity, priceGn, owned: boolean }[],
      equippedAvatarId: number | null,
    }

avatars.unlock({ avatarId: number })
  → { avatarId, newBalance, equipped: true }

avatars.equip({ avatarId: number })
  → { equippedAvatarId: number }
```

### `avatars.list`

- Single query joining `avatars` (active only) ⨝ `user_avatars` (filtered by `ctx.user.id`) → flag each row with `owned`.
- Returns `equippedAvatarId` from the user row.

### `avatars.unlock` — race-safe transaction

```
BEGIN
  -- 1. Lookup avatar (server-owned price; client never supplies it)
  SELECT id, slug, priceGn, isActive FROM avatars WHERE id = $avatarId;
  -- reject if not found, !isActive

  -- 2. Reject if user already owns
  -- (also enforced by composite PK on user_avatars)

  -- 3. Race-safe debit (same pattern as goldenNotes.spend)
  UPDATE golden_note_balances
    SET balance = balance - $price,
        lifetimeSpent = lifetimeSpent + $price,
        updatedAt = NOW()
    WHERE userId = $uid AND balance >= $price
    RETURNING balance;
  -- 0 rows = insufficient funds → throw BAD_REQUEST

  -- 4. Insert ownership row
  INSERT INTO user_avatars (userId, avatarId, acquiredVia, spentGn)
    VALUES ($uid, $avatarId, 'purchase', $price);

  -- 5. Audit log
  INSERT INTO golden_note_transactions (userId, amount, kind, reason, balanceAfter)
    VALUES ($uid, -$price, 'spend_avatar_unlock', 'avatar:' || $slug, $newBalance);

  -- 6. Auto-equip
  UPDATE users SET equipped_avatar_id = $avatarId WHERE id = $uid;
COMMIT
```

Rate limit: `rateLimit("avatars.unlock", ctx.user.id, { max: 30, windowMs: 60_000 })`.

### `avatars.equip`

- Verify ownership: `SELECT 1 FROM user_avatars WHERE userId=$uid AND avatarId=$avatarId`.
- If not owned → `FORBIDDEN`.
- `UPDATE users SET equipped_avatar_id = $avatarId WHERE id = $uid`.
- Idempotent.

---

## 5. UI components

### New: `<UserAvatar userId={...} size="sm|md|lg" />`

Centralizes equipped-avatar rendering. Internally:
- For `userId === ctx.user.id`: pulls `avatars.list` (cached) → uses local `equippedAvatarId`.
- For other users (leaderboards): the row data must include `equippedAvatarSlug` from a join in the leaderboard query — adding the column to the existing leaderboard tRPC return shape.
- Fallback: render `default-mic` SVG if no equipped avatar.

### Surfaces to update

| File | Change |
|---|---|
| `client/src/components/PersistentHeader.tsx` | Replace user dropdown trigger initial with `<UserAvatar size="sm" />`. Add "Avatars" entry to dropdown menu. |
| `client/src/pages/Shop.tsx` | Add Status strip above pack grid. Add "Avatar Locker" link. |
| `client/src/pages/Profile.tsx` | Replace placeholder avatar with `<UserAvatar size="lg" />`. Add "Manage avatars" button. |
| `client/src/pages/Leaderboards.tsx` | Render `<UserAvatar size="sm" />` per row. Update leaderboard query to include `equippedAvatarSlug`. |
| `client/src/pages/Gameplay.tsx` | Player corner uses `<UserAvatar size="sm" />`. |
| `client/src/pages/FinalResults.tsx` | Result card uses `<UserAvatar size="md" />`. |
| `client/src/components/DashboardLayout.tsx` | Existing radix `<Avatar>` swapped for `<UserAvatar />`. |
| `client/src/pages/Avatars.tsx` (new) | Avatar Locker page (catalog grid, equip, unlock confirm modal). |
| `client/src/App.tsx` | Add `/avatars` route. |

### Confirmation modal (avatar unlock)

```
┌──────────────────────────────────┐
│ Unlock Diamond Note?             │
│                                  │
│ [💎 Diamond Note]                │
│                                  │
│ Cost: 100 ✨                     │
│ Your balance: 12,500 → 12,400    │
│                                  │
│ Once unlocked, this avatar is    │
│ yours forever and will be auto-  │
│ equipped.                        │
│                                  │
│ [Cancel]  [Unlock for 100 ✨]    │
└──────────────────────────────────┘
```

---

## 6. Security & edge cases

- **Server-owned pricing.** Client supplies only `avatarId`; price read from `avatars.priceGn` server-side. Same discipline as `goldenNotes.spend` and `GN_PACKS`.
- **Race-safe debit.** `UPDATE ... WHERE balance >= cost RETURNING` — concurrent unlocks for the same user can't double-spend.
- **No double-purchase.** Composite PK `(userId, avatarId)` on `user_avatars`; pre-flight check returns BAD_REQUEST with friendly message.
- **Equip ownership check.** Server validates ownership before updating `users.equipped_avatar_id`. Returns FORBIDDEN otherwise.
- **Inactive avatars.** Soft-delete via `isActive=false`. `avatars.list` filters them from the catalog but `<UserAvatar />` still renders an inactive equipped avatar so existing users aren't broken.
- **Rate limits.** Unlock: 30/min/user. Equip: 60/min/user (cheap but spammy clicks).
- **Refunds.** Avatar unlocks are non-refundable digital goods (matches existing ToS for Golden Notes). Stripe-side GN-purchase refund (`charge.refunded` webhook, already wired in v0.3.0) does not auto-revoke downstream avatar unlocks — same posture as the rest of the GN system.
- **Mobile (Capacitor).** `/avatars` is rendered, owned avatars displayable and equippable, but the "Available to unlock" grid is hidden behind `CAN_PURCHASE` (same flag the Shop already uses) — Apple §3.1.1 forbids selling digital goods via non-IAP. Native users see "Unlock new avatars on the web at lyricpro-ai".
- **No client-side balance mutation.** Only the unlock procedure debits; nothing else can change the balance from the client.

---

## 7. Telemetry

The existing `golden_note_transactions` table captures every unlock with `kind='spend_avatar_unlock'` and `reason='avatar:<slug>'`. That's enough for "most-popular avatar" and "GN-from-avatars revenue" queries without new analytics tables.

---

## 8. Testing

### Unit
- `avatars.unlock` — concurrent spends for same user can't both succeed past zero balance (race-safety).
- `avatars.unlock` — rejects insufficient balance with clear message.
- `avatars.unlock` — rejects double-purchase (already owned).
- `avatars.unlock` — rejects inactive or non-existent avatar.
- `avatars.equip` — rejects equipping a non-owned avatar (FORBIDDEN).
- `avatars.equip` — idempotent (equipping the currently-equipped avatar succeeds).
- `avatars.list` — owned/available split correct; inactive hidden.

### Integration
- End-to-end: buy GN pack via Stripe Checkout (test mode) → balance credited → unlock avatar → equip → render in PersistentHeader.
- Migration: run forward + rollback against a snapshot DB; existing users get `default-mic` ownership row + equipped pointer.

### Manual
- Confirm equipped avatar shows on PersistentHeader / Profile / Leaderboards / Gameplay / FinalResults.
- Confirm `/shop` Status header shows correct subscription tier and rank tier with the disambiguating labels.
- Confirm the "Pro plan" + "Pro rank" collision case renders without confusion.

---

## 9. Follow-ups (separate work)

1. **Wire `goldenNotes.spend` into gameplay UI** — buttons in `Gameplay.tsx` for "play extra game" (1 GN), "enter advanced mode session" (5 GN), "day pass" (20 GN), and tournament-entry buttons. Backend procedure exists, only the UI hookup is missing.
2. **Replace 8 stub SVG avatars** with final designed artwork — same gold-themed style as `client/public/brand/golden-note.svg`.
3. **Admin UI** for managing the avatars catalog (add/edit/disable). Until then, catalog changes go through Drizzle migrations.
4. **Subscription tier upgrade flow** behind the "Manage plan →" link on the Shop Status header.
5. **Real-money refund path** — if avatar unlocks ever need to be reversible after a Stripe refund, add a reverse-transaction mechanism. Out of scope for now.
