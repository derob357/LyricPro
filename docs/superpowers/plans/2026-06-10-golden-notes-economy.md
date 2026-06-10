# Golden Notes Economy Implementation Plan (Project C)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Split Golden Notes into earned/purchased pools (App Store compliance), add the ante/stake mechanic with animations, harden every debit path, implement the real Shop purchases, and test all spend paths.

**Architecture:** Pure stake/pool math lives in a new `server/_core/stakeMath.ts` (unit-testable, no DB); the ledger (`goldenNotesLedger.ts`) becomes pool-aware with atomic single-statement debits + idempotency keys; a new `server/_core/stakeEngine.ts` owns escrow→burn/win→settle→refund; hooks land in createRoom / submitAnswer / nextRound; an idempotent Vercel cron sweeps abandoned stakes. Client: ante stepper in GameSetup, stake line in RoundResults, animated balance in PersistentHeader, Shop cleanup.

**Tech Stack:** TypeScript, tRPC, Drizzle/Postgres (hand-written migrations ONLY; local `.env` DB **is prod** — subagents never run migrations or backfills; the controller does), vitest (`pnpm test:server`, `pnpm test:client`; DB-gated tests use the existing `liveDescribe = DB_URL ? describe : describe.skip` pattern — find it in any `*.live.test.ts` / skipped server test and copy it).

**Spec:** `docs/superpowers/specs/2026-06-10-golden-notes-economy-design.md`
**Branch:** cut `feat/gn-economy` from `main`.

**Spec deviations locked in this plan (already validated against the code):**
1. The spec said practice-pack rewards become earned-GN. Reality: the practice/weakness pack is a **spend** (`PACK_PRICE_GN = 4`, `insights.ts:23,377`) — there is no practice reward. Earned-pool sources are: **stake wins + signup grant (+ backfill)**. Practice pack spends draw purchased-first like every other non-stake spend.
2. The spec said "wire Tournament Entry into the Shop/Tournaments UI". Reality: `Tournaments.tsx` already has a working `Join ({entryCostGn} GN)` button calling `payEntry`. The Shop's static tournament cards become a single "Browse Tournaments →" navigation card.

**Project conventions binding every task:** outline lucide icons only (no emoji); no `Co-Authored-By` trailers; subagents never read/echo `.env`, never run migrations/backfills/crons against the DB.

---

## Background for the implementer

- Ledger: `server/_core/goldenNotesLedger.ts` — `spendGoldenNotes(tx, userId, cost, kind, reason)` (atomic `balance`-guarded decrement, throws TRPCError on insufficient) and `creditGoldenNotes(tx, userId, amount, kind, reason, relatedUserId?)`. Both write `goldenNoteTransactions` rows with `balanceAfter`.
- Schema (`drizzle/schema.ts`): `goldenNoteBalances` (lines ~892-904: userId PK, balance, lifetimePurchased, lifetimeSpent, …); `goldenNoteTransactions` (~911-921: signed `amount`, `kind` **pgEnum** `golden_note_transaction_kind` with values purchase/spend_extra_game/spend_tournament/spend_advanced_mode/spend_avatar_unlock/gift_sent/gift_received/refund/expiry/admin_adjustment, `reason`, `balanceAfter`); `gameRooms` (status enum waiting/active/finished, currentRound, roundsTotal, mode, difficulty, streakInsurance); `roomPlayers` (roomId, userId, guestToken, currentScore, currentStreak).
- Latest migration on main: `drizzle/0019_marketing_consent.sql`. This project adds `0020`. Apply-script patterns: `scripts/apply-answer-method-mc-migration.mjs` (non-transactional, for `ALTER TYPE ADD VALUE`) and `scripts/apply-marketing-consent-migration.mjs` (transactional + hard-fail verification).
- Hand-rolled debits to refactor (D2): streak insurance `server/routers/game.ts:163-200` (3 GN, kind mislabeled `spend_advanced_mode`); hint `game.ts:964-1059` (1 GN, also `spend_advanced_mode`); practice pack `server/routers/insights.ts:~350-383` (4 GN, also `spend_advanced_mode`, inside a `db.transaction` with a hand-rolled balance update).
- `createRoom` (`game.ts:143-232`): publicProcedure, zod input incl. `streakInsurance`; solo guests allowed.
- `submitAnswer` (`game.ts:672+`): scores a round; computes `correctCount`; response feeds `RoundResults` via sessionStorage. `nextRound` (`game.ts:1062-1148`): `isGameOver = nextRound > room.roundsTotal`; sets status `finished`; updates stats.
- `goldenNotes` router (`server/routers/goldenNotes.ts`): `GN_PACKS`, `GN_SPEND_COSTS` (extra game 1, tournament 5/25/100, advanced-mode 5/20), `getMyBalance` (protected), `getTransactions`, `createPurchaseCheckout`, generic `spend`.
- Subscription gating: `server/routers/subscriptionEnforcement.ts` — `checkGameEligibility(userId, requestedRounds, entryFee)` enforces daily/lifetime game limits per tier; read it carefully before Task 9 (the explore reports disagree on free-tier semantics — trust the code).
- Tournaments: `payEntry` (`tournaments.ts:80-176`) is complete + race-safe; client `Tournaments.tsx` already joins.
- Shop: `client/src/pages/Shop.tsx` — spend section lines ~292-369 (Extra Game, Advanced Mode ×2, Tournament ×3, Gift "Coming soon"); balance via `goldenNotes.getMyBalance`.
- Header balance: `client/src/components/PersistentHeader.tsx:14` (query) and `:71-83` (Music2 icon + number).
- GameSetup: ante section slots between Streak Insurance (~line 501) and Game Summary (~line 504); createRoom payload at ~161-170.
- Crons: `vercel.json` `crons` array (2 existing chat crons, daily); handlers live in `api-src/cron/` (bundled to `api/` by `scripts/build-api.mjs`). Read an existing cron handler (e.g. chat-retention-sweep) for the auth pattern (Vercel cron sends `Authorization: Bearer $CRON_SECRET` when configured — mirror whatever the existing handlers do).
- User creation: `server/db.ts:43-116` `upsertUser` (INSERT … ON CONFLICT (openId) DO UPDATE).
- Client test patterns: `client/src/pages/RoundResults.breakdown.test.tsx`, `Home.hero.test.tsx`.

Economy constants (single source of truth, defined in Task 2): `DEFAULT_ANTE=50`, `ANTE_STEP=25`, `ROUND_WIN_REWARD=25`, `ROUND_LOSS_BURN=25`, `WIN_THRESHOLD_CORRECT=3`, `SIGNUP_GRANT=100`, `STAKED_GAMES_PER_HOUR_CAP=10`, `ABANDON_HOURS=6`.

---

### Task 1: Migration 0020 — pools, stakes table, enum values, idempotency

**Files:**
- Modify: `drizzle/schema.ts`
- Create: `drizzle/0020_gn_economy.sql`
- Create: `scripts/apply-gn-economy-migration.mjs`

- [ ] **Step 1: schema.ts changes**

`goldenNoteBalances` — add after `balance`:

```typescript
  // Pool split (App Store 5.3 compliance): earned GN is stakeable; purchased GN never is.
  // balance is ALWAYS earnedBalance + purchasedBalance — the ledger updates all three atomically.
  earnedBalance: integer("earnedBalance").default(0).notNull(),
  purchasedBalance: integer("purchasedBalance").default(0).notNull(),
```

`goldenNoteTransactionKindEnum` — append values: `"stake_escrow"`, `"stake_win"`, `"stake_refund"`, `"signup_grant"`, `"spend_hint"`, `"spend_streak_insurance"`, `"spend_practice_pack"`.

`goldenNoteTransactions` — add after `balanceAfter`:

```typescript
  // Client-retry dedupe for money-moving mutations (ante escrow, extra game).
  idempotencyKey: varchar("idempotencyKey", { length: 64 }).unique(),
```

New table + enum after the gifts table:

```typescript
export const gnStakeStateEnum = pgEnum("gn_stake_state", ["active", "settled", "refunded"]);

/** One row per staked solo game (accounts only). Escrow model: the ante leaves
 *  earnedBalance at game start; burns reduce the eventual refund; wins credit
 *  earnedBalance immediately; settle refunds (staked - burned). */
export const gnStakes = pgTable("gn_stakes", {
  id: serial("id").primaryKey(),
  roomId: integer("roomId").notNull(),
  userId: integer("userId").notNull(),
  staked: integer("staked").notNull(),
  burned: integer("burned").default(0).notNull(),
  wonRounds: integer("wonRounds").default(0).notNull(),
  state: gnStakeStateEnum("state").default("active").notNull(),
  createdAt: createdAtColumn(),
  settledAt: timestamp("settledAt", { withTimezone: true }),
}, (t) => [
  uniqueIndex("gn_stakes_room_user").on(t.roomId, t.userId),
  index("gn_stakes_active_created").on(t.state, t.createdAt),
]);
```

(Match the file's existing index-definition style — third-argument array vs object — copy from a nearby table.)

- [ ] **Step 2: `drizzle/0020_gn_economy.sql`**

```sql
-- 0020: GN economy — pool split, stake escrow table, new transaction kinds,
-- idempotency keys. ALTER TYPE ADD VALUE cannot run inside a transaction,
-- so this file is applied non-transactionally (every statement idempotent).

ALTER TYPE golden_note_transaction_kind ADD VALUE IF NOT EXISTS 'stake_escrow';
ALTER TYPE golden_note_transaction_kind ADD VALUE IF NOT EXISTS 'stake_win';
ALTER TYPE golden_note_transaction_kind ADD VALUE IF NOT EXISTS 'stake_refund';
ALTER TYPE golden_note_transaction_kind ADD VALUE IF NOT EXISTS 'signup_grant';
ALTER TYPE golden_note_transaction_kind ADD VALUE IF NOT EXISTS 'spend_hint';
ALTER TYPE golden_note_transaction_kind ADD VALUE IF NOT EXISTS 'spend_streak_insurance';
ALTER TYPE golden_note_transaction_kind ADD VALUE IF NOT EXISTS 'spend_practice_pack';

ALTER TABLE golden_note_balances
  ADD COLUMN IF NOT EXISTS "earnedBalance" integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS "purchasedBalance" integer NOT NULL DEFAULT 0;

-- Existing balances are overwhelmingly Stripe/admin in origin → purchased pool.
-- Idempotent: only rows where the split hasn't been initialized.
UPDATE golden_note_balances
  SET "purchasedBalance" = balance
  WHERE "purchasedBalance" = 0 AND "earnedBalance" = 0 AND balance > 0;

ALTER TABLE golden_note_transactions
  ADD COLUMN IF NOT EXISTS "idempotencyKey" varchar(64);
CREATE UNIQUE INDEX IF NOT EXISTS golden_note_transactions_idem
  ON golden_note_transactions ("idempotencyKey") WHERE "idempotencyKey" IS NOT NULL;

DO $$ BEGIN
  CREATE TYPE gn_stake_state AS ENUM ('active', 'settled', 'refunded');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

CREATE TABLE IF NOT EXISTS gn_stakes (
  id serial PRIMARY KEY,
  "roomId" integer NOT NULL,
  "userId" integer NOT NULL,
  staked integer NOT NULL,
  burned integer NOT NULL DEFAULT 0,
  "wonRounds" integer NOT NULL DEFAULT 0,
  state gn_stake_state NOT NULL DEFAULT 'active',
  "createdAt" timestamptz NOT NULL DEFAULT now(),
  "settledAt" timestamptz
);
CREATE UNIQUE INDEX IF NOT EXISTS gn_stakes_room_user ON gn_stakes ("roomId", "userId");
CREATE INDEX IF NOT EXISTS gn_stakes_active_created ON gn_stakes (state, "createdAt");
```

(Adjust `createdAtColumn()` semantics: check what default the helper emits and mirror it. Verify the pg table name for balances/transactions — first arg of pgTable — and adjust if not `golden_note_balances`/`golden_note_transactions`.)

- [ ] **Step 3: apply script** `scripts/apply-gn-economy-migration.mjs` — copy `apply-answer-method-mc-migration.mjs` (non-transactional, statement-by-statement: split the file on `;` boundaries is fragile with the DO block — instead run the whole file via `sql.unsafe(ddl).simple()` WITHOUT a wrapping transaction, as the 0018 script does). Post-apply verification: SELECT the two new columns + `to_regclass('gn_stakes')` + enum values; hard-fail (exit 1) if anything missing.

- [ ] **Step 4:** `pnpm exec tsc --noEmit` clean; `node --check` the script. **DO NOT run the migration** (controller applies).

- [ ] **Step 5: Commit**

```bash
git add drizzle/schema.ts drizzle/0020_gn_economy.sql scripts/apply-gn-economy-migration.mjs
git commit -m "feat(economy): migration 0020 — GN pool split, gn_stakes escrow table, new txn kinds"
```

---

### Task 2: Pure economy math — `stakeMath.ts` (TDD)

**Files:**
- Create: `server/_core/stakeMath.ts`
- Create: `server/stakeMath.test.ts`

- [ ] **Step 1: failing tests** (`server/stakeMath.test.ts`)

```typescript
import { describe, it, expect } from "vitest";
import {
  computePoolDebit, resolveStakeOutcome, clampAnte,
  DEFAULT_ANTE, ANTE_STEP, ROUND_WIN_REWARD, ROUND_LOSS_BURN,
  WIN_THRESHOLD_CORRECT, SIGNUP_GRANT, STAKED_GAMES_PER_HOUR_CAP, ABANDON_HOURS,
} from "./_core/stakeMath";

describe("computePoolDebit", () => {
  it("purchased-first: drains purchased before touching earned", () => {
    expect(computePoolDebit(30, 100, 50, "purchased-first")).toEqual({ fromPurchased: 30, fromEarned: 20 });
  });
  it("purchased covers everything when sufficient", () => {
    expect(computePoolDebit(80, 100, 50, "purchased-first")).toEqual({ fromPurchased: 50, fromEarned: 0 });
  });
  it("earned-only never touches purchased", () => {
    expect(computePoolDebit(500, 60, 50, "earned-only")).toEqual({ fromPurchased: 0, fromEarned: 50 });
  });
  it("throws on insufficient total (purchased-first)", () => {
    expect(() => computePoolDebit(10, 10, 50, "purchased-first")).toThrow(/insufficient/i);
  });
  it("throws on insufficient earned (earned-only) even when purchased is plentiful", () => {
    expect(() => computePoolDebit(500, 20, 50, "earned-only")).toThrow(/insufficient/i);
  });
});

describe("resolveStakeOutcome", () => {
  const stake = { staked: 50, burned: 0 };
  it("won round (3 of 4 correct): +25 win, no burn", () => {
    expect(resolveStakeOutcome(stake, 3)).toEqual({ win: ROUND_WIN_REWARD, burn: 0 });
  });
  it("perfect round (4): also a win", () => {
    expect(resolveStakeOutcome(stake, 4)).toEqual({ win: 25, burn: 0 });
  });
  it("lost round (2 correct): burns 25 from remaining stake", () => {
    expect(resolveStakeOutcome(stake, 2)).toEqual({ win: 0, burn: ROUND_LOSS_BURN });
  });
  it("0 correct never pays and burns (anti-abuse D6)", () => {
    expect(resolveStakeOutcome(stake, 0)).toEqual({ win: 0, burn: 25 });
  });
  it("burn is capped by remaining stake", () => {
    expect(resolveStakeOutcome({ staked: 50, burned: 40 }, 1)).toEqual({ win: 0, burn: 10 });
  });
  it("exhausted stake burns nothing further", () => {
    expect(resolveStakeOutcome({ staked: 50, burned: 50 }, 0)).toEqual({ win: 0, burn: 0 });
  });
});

describe("clampAnte", () => {
  it("defaults to 50 when earned allows", () => expect(clampAnte(undefined, 200)).toBe(DEFAULT_ANTE));
  it("steps down to the largest multiple of 25 within earned", () => expect(clampAnte(undefined, 40)).toBe(25));
  it("zero earned → zero ante", () => expect(clampAnte(undefined, 0)).toBe(0));
  it("explicit ante is validated: multiple of step, ≤ earned, ≥ 0", () => {
    expect(clampAnte(75, 200)).toBe(75);
    expect(clampAnte(75, 60)).toBe(50);
    expect(clampAnte(-25, 200)).toBe(0);
    expect(clampAnte(30, 200)).toBe(25); // snaps down to step
  });
});
```

- [ ] **Step 2: run** `pnpm test:server -- stakeMath.test.ts` — FAIL (module missing).

- [ ] **Step 3: implement** `server/_core/stakeMath.ts`

```typescript
/** Pure GN-economy math (no DB). Single source of truth for stake constants.
 *  The SQL in goldenNotesLedger.ts must implement the same pool-draw order —
 *  computePoolDebit is the executable specification (and is used directly
 *  by the ledger to pre-compute the split inside a row-locked transaction). */

export const DEFAULT_ANTE = 50;
export const ANTE_STEP = 25;
export const ROUND_WIN_REWARD = 25;
export const ROUND_LOSS_BURN = 25;
export const WIN_THRESHOLD_CORRECT = 3; // of 4 questions
export const SIGNUP_GRANT = 100;        // earned GN, once per account
export const STAKED_GAMES_PER_HOUR_CAP = 10;
export const ABANDON_HOURS = 6;

export type PoolMode = "purchased-first" | "earned-only";

export function computePoolDebit(
  purchased: number,
  earned: number,
  cost: number,
  mode: PoolMode,
): { fromPurchased: number; fromEarned: number } {
  if (cost <= 0) return { fromPurchased: 0, fromEarned: 0 };
  if (mode === "earned-only") {
    if (earned < cost) throw new Error(`Insufficient earned Golden Notes: have ${earned}, need ${cost}`);
    return { fromPurchased: 0, fromEarned: cost };
  }
  if (purchased + earned < cost) {
    throw new Error(`Insufficient Golden Notes: have ${purchased + earned}, need ${cost}`);
  }
  const fromPurchased = Math.min(purchased, cost);
  return { fromPurchased, fromEarned: cost - fromPurchased };
}

export function resolveStakeOutcome(
  stake: { staked: number; burned: number },
  correctCount: number,
): { win: number; burn: number } {
  // 0-correct rounds never pay out (anti-abuse, D6) — subsumed by the win
  // threshold, stated for the contract.
  if (correctCount >= WIN_THRESHOLD_CORRECT) return { win: ROUND_WIN_REWARD, burn: 0 };
  const remaining = Math.max(0, stake.staked - stake.burned);
  return { win: 0, burn: Math.min(ROUND_LOSS_BURN, remaining) };
}

export function clampAnte(requested: number | undefined, earnedBalance: number): number {
  const maxSteps = Math.floor(Math.max(0, earnedBalance) / ANTE_STEP);
  const max = maxSteps * ANTE_STEP;
  const want = requested === undefined ? DEFAULT_ANTE : requested;
  const snapped = Math.floor(Math.max(0, want) / ANTE_STEP) * ANTE_STEP;
  return Math.min(snapped, max);
}
```

- [ ] **Step 4: run** — PASS. **Step 5: Commit**

```bash
git add server/_core/stakeMath.ts server/stakeMath.test.ts
git commit -m "feat(economy): pure stake/pool math with locked constants (TDD)"
```

---

### Task 3: Pool-aware ledger + D2 refactor of hand-rolled debits

**Files:**
- Modify: `server/_core/goldenNotesLedger.ts`
- Modify: `server/routers/game.ts` (insurance ~163-200, hint ~964-1059)
- Modify: `server/routers/insights.ts` (~350-383)
- Modify: `server/routers/goldenNotes.ts` (getMyBalance + spend kinds)
- Test: `server/goldenNotesLedger.live.test.ts` (DB-gated, new)

- [ ] **Step 1: extend the ledger** (`goldenNotesLedger.ts`)

Read the current file first. Reshape (keeping existing exports working):

```typescript
import { computePoolDebit, type PoolMode } from "./stakeMath";

export type SpendKind =
  | "spend_extra_game" | "spend_tournament" | "spend_advanced_mode"
  | "spend_avatar_unlock" | "spend_hint" | "spend_streak_insurance" | "spend_practice_pack"
  | "stake_escrow";
export type CreditKind =
  | "purchase" | "refund" | "admin_adjustment" | "gift_received"
  | "stake_win" | "stake_refund" | "signup_grant";

export interface SpendOptions {
  pool?: PoolMode;           // default "purchased-first"; stake_escrow MUST pass "earned-only"
  idempotencyKey?: string;   // unique across all transactions; replays return the recorded result
}

export async function spendGoldenNotes(
  tx: any, userId: number, cost: number, kind: SpendKind,
  reason: string | null, opts: SpendOptions = {},
): Promise<{ newBalance: number; deduped: boolean }> { ... }
```

Implementation requirements (adapt to the file's existing SQL style — it already does ensure-row + atomic update; extend, don't rewrite):
1. If `opts.idempotencyKey`: `SELECT` an existing transaction with that key first; if found, return `{ newBalance: found.balanceAfter, deduped: true }` (no double spend on client retry).
2. Lock the balance row (`FOR UPDATE` via the existing pattern or `select ... for("update")`), read `purchasedBalance`/`earnedBalance`, call `computePoolDebit` (throws → convert to the existing `TRPCError BAD_REQUEST` with the helper's message), then a single UPDATE setting `purchasedBalance -= fromPurchased`, `earnedBalance -= fromEarned`, `balance -= cost`, `lifetimeSpent += cost` with `WHERE userId = ... AND balance >= cost` guard; if 0 rows, throw the insufficient error (belt-and-braces against drift).
3. Insert the transaction row with `idempotencyKey` (catch unique-violation → treat as deduped: re-select and return).

`creditGoldenNotes` gains `opts: { pool?: "earned" | "purchased"; idempotencyKey?: string }` (default `"purchased"` — preserves current behavior for purchase/refund/admin/gift). Earned credits (`stake_win`, `stake_refund`, `signup_grant`) must pass `pool: "earned"`. Same idempotency replay semantics. All three balance columns updated atomically (`balance += amount`, chosen pool `+= amount`).

- [ ] **Step 2: D2 refactor — replace the three hand-rolled debits**

- Streak insurance (`game.ts:163-200`) → inside a `db.transaction`, `await spendGoldenNotes(tx, ctx.user.id, STREAK_INSURANCE_PRICE_GN, "spend_streak_insurance", "Streak Insurance")`. Preserve the PAYMENT_REQUIRED error code: catch the ledger's BAD_REQUEST and rethrow as PAYMENT_REQUIRED with the original user-facing message format.
- Hint (`game.ts:~994-1009`) → `spendGoldenNotes(tx, userId, HINT_PRICE_GN, "spend_hint", \`Hint: ${input.stage}\`)` in a transaction (same error-code preservation).
- Practice pack (`insights.ts` ~350-383) → replace the hand-rolled update+insert inside its existing `db.transaction` with `spendGoldenNotes(tx, userId, PACK_PRICE_GN, "spend_practice_pack", packReason)`.

- [ ] **Step 3: getMyBalance exposes pools** (`goldenNotes.ts:60-70`): add `earnedBalance: bal.earnedBalance, purchasedBalance: bal.purchasedBalance` to the return.

- [ ] **Step 4: DB-gated integration test** `server/goldenNotesLedger.live.test.ts` — copy the `liveDescribe` gating from an existing live test. Tests (each creates a throwaway user-id row in golden_note_balances with known pools, cleans up after):
  - purchased-first spend splits correctly across pools and `balance` stays equal to the sum;
  - earned-only spend with insufficient earned throws even when purchased covers it;
  - idempotencyKey replay returns deduped without double-debit;
  - earned credit lands in earnedBalance.
  Use negative/sentinel user ids (e.g. `-9999`) and delete the rows in `afterEach` — this runs against prod.

- [ ] **Step 5:** `pnpm test:server` green (live tests skip without DB env; they'll run on the controller's machine), `pnpm exec tsc --noEmit` clean, `pnpm test:client` green.

- [ ] **Step 6: Commit**

```bash
git add server/_core/goldenNotesLedger.ts server/routers/game.ts server/routers/insights.ts server/routers/goldenNotes.ts server/goldenNotesLedger.live.test.ts
git commit -m "feat(economy): pool-aware ledger with idempotency; hint/insurance/pack debits on the shared helper (D2)"
```

---

### Task 4: Stake engine — escrow, resolve, settle, sweep

**Files:**
- Create: `server/_core/stakeEngine.ts`
- Test: `server/stakeEngine.live.test.ts` (DB-gated)

- [ ] **Step 1: implement** `server/_core/stakeEngine.ts`

```typescript
/** Stake lifecycle for solo staked games (accounts only).
 *  Escrow model: ante leaves earnedBalance at createRoom; burns only reduce
 *  the eventual refund (no balance movement — the GN already left); wins
 *  credit earnedBalance immediately; settle refunds staked-burned; the sweep
 *  refunds abandoned actives. Every mutation is idempotent or state-guarded. */
import { and, eq, lt, sql as dsql } from "drizzle-orm";
import { gnStakes, gameRooms } from "../../drizzle/schema";
import { spendGoldenNotes, creditGoldenNotes } from "./goldenNotesLedger";
import { resolveStakeOutcome, ABANDON_HOURS, STAKED_GAMES_PER_HOUR_CAP } from "./stakeMath";

export async function escrowStake(tx: any, userId: number, roomId: number, ante: number) {
  if (ante <= 0) return null;
  // Velocity cap (D6): max N staked games per rolling hour.
  const recent = await tx.select({ n: dsql<number>`count(*)::int` }).from(gnStakes)
    .where(and(eq(gnStakes.userId, userId), dsql`${gnStakes.createdAt} > now() - interval '1 hour'`));
  if ((recent[0]?.n ?? 0) >= STAKED_GAMES_PER_HOUR_CAP) {
    throw new Error(`Stake limit: max ${STAKED_GAMES_PER_HOUR_CAP} staked games per hour.`);
  }
  await spendGoldenNotes(tx, userId, ante, "stake_escrow", `Game stake (room ${roomId})`, {
    pool: "earned-only",
    idempotencyKey: `stake-escrow-${roomId}-${userId}`,
  });
  await tx.insert(gnStakes).values({ roomId, userId, staked: ante }).onConflictDoNothing();
  return { staked: ante };
}

/** Called from submitAnswer after scoring. Returns the UI payload (null = unstaked game). */
export async function resolveRoundStake(db: any, roomId: number, userId: number, correctCount: number, roundNumber: number) {
  return db.transaction(async (tx: any) => {
    const [stake] = await tx.select().from(gnStakes)
      .where(and(eq(gnStakes.roomId, roomId), eq(gnStakes.userId, userId), eq(gnStakes.state, "active")))
      .for("update");
    if (!stake) return null;
    const { win, burn } = resolveStakeOutcome(stake, correctCount);
    if (burn > 0) {
      await tx.update(gnStakes).set({ burned: stake.burned + burn }).where(eq(gnStakes.id, stake.id));
    }
    if (win > 0) {
      await tx.update(gnStakes).set({ wonRounds: stake.wonRounds + 1 }).where(eq(gnStakes.id, stake.id));
      await creditGoldenNotes(tx, userId, win, "stake_win", `Round ${roundNumber} won (room ${roomId})`, undefined, {
        pool: "earned",
        idempotencyKey: `stake-win-${roomId}-${userId}-r${roundNumber}`,
      });
    }
    return { staked: stake.staked, burned: stake.burned + burn, win, burn,
             remaining: Math.max(0, stake.staked - stake.burned - burn) };
  });
}

/** Called when a game finishes (nextRound → isGameOver). Idempotent via state guard. */
export async function settleStake(db: any, roomId: number, userId: number) {
  return db.transaction(async (tx: any) => {
    const updated = await tx.update(gnStakes)
      .set({ state: "settled", settledAt: new Date() })
      .where(and(eq(gnStakes.roomId, roomId), eq(gnStakes.userId, userId), eq(gnStakes.state, "active")))
      .returning();
    const stake = updated[0];
    if (!stake) return null;
    const refund = Math.max(0, stake.staked - stake.burned);
    if (refund > 0) {
      await creditGoldenNotes(tx, userId, refund, "stake_refund", `Stake refund (room ${roomId})`, undefined, {
        pool: "earned",
        idempotencyKey: `stake-refund-${roomId}-${userId}`,
      });
    }
    return { refund, burned: stake.burned, wonRounds: stake.wonRounds };
  });
}

/** Cron sweep: refund stakes whose game never finished. Idempotent (state guard + idem keys). */
export async function sweepAbandonedStakes(db: any): Promise<{ refunded: number }> {
  const cutoff = dsql`now() - interval '${dsql.raw(String(ABANDON_HOURS))} hours'`;
  const candidates = await db.select({ roomId: gnStakes.roomId, userId: gnStakes.userId })
    .from(gnStakes)
    .innerJoin(gameRooms, eq(gameRooms.id, gnStakes.roomId))
    .where(and(eq(gnStakes.state, "active"), lt(gnStakes.createdAt, cutoff),
               dsql`${gameRooms.status} != 'finished'`));
  let refunded = 0;
  for (const c of candidates) {
    const r = await db.transaction(async (tx: any) => {
      const updated = await tx.update(gnStakes)
        .set({ state: "refunded", settledAt: new Date() })
        .where(and(eq(gnStakes.roomId, c.roomId), eq(gnStakes.userId, c.userId), eq(gnStakes.state, "active")))
        .returning();
      const stake = updated[0];
      if (!stake) return false;
      const refund = Math.max(0, stake.staked - stake.burned);
      if (refund > 0) {
        await creditGoldenNotes(tx, c.userId, refund, "stake_refund", `Abandoned game refund (room ${c.roomId})`, undefined, {
          pool: "earned", idempotencyKey: `stake-refund-${c.roomId}-${c.userId}`,
        });
      }
      return true;
    });
    if (r) refunded++;
  }
  return { refunded };
}
```

(Adapt: drizzle import paths/idioms to match the codebase — check how other `_core` modules import schema; the `creditGoldenNotes` signature order must match Task 3's actual implementation — if you gave it `(tx, userId, amount, kind, reason, relatedUserId?, opts?)` keep calls consistent. The settle path uses the SAME idempotency key as the sweep (`stake-refund-room-user`) — deliberate: whichever runs first wins, the other dedupes.)

- [ ] **Step 2: DB-gated tests** `server/stakeEngine.live.test.ts` (liveDescribe; sentinel negative userIds + a throwaway gameRooms row; full cleanup):
  - escrow debits earned-only and creates the row; second escrow call dedupes (idempotency);
  - resolve win credits +25 earned and increments wonRounds; resolve loss burns 25; burn caps at remaining;
  - settle refunds staked-burned exactly once (second call returns null);
  - sweep refunds an aged active stake on an unfinished room and is idempotent;
  - velocity cap throws on the 11th stake within an hour (insert 10 rows directly, then escrow).

- [ ] **Step 3:** suites + tsc green. **Step 4: Commit**

```bash
git add server/_core/stakeEngine.ts server/stakeEngine.live.test.ts
git commit -m "feat(economy): stake engine — escrow, round resolution, settlement, abandonment sweep"
```

---

### Task 5: Wire the stake into the game flow (createRoom / submitAnswer / nextRound)

**Files:**
- Modify: `server/routers/game.ts`

- [ ] **Step 1: createRoom** (input at ~143-155): add `ante: z.number().int().min(0).max(1000).default(0),`. After the streak-insurance block, before room insert… the stake needs `roomId`, so escrow AFTER the room+player rows are created, in the same flow:

```typescript
      // Ante escrow (solo, signed-in only). Guests and multiplayer ignore ante.
      if (input.ante > 0 && input.mode === "solo" && ctx.user?.id) {
        const anteOk = await db.transaction(async (tx) => {
          const [bal] = await tx.select().from(goldenNoteBalances)
            .where(eq(goldenNoteBalances.userId, ctx.user!.id)).for("update");
          const clamped = clampAnte(input.ante, bal?.earnedBalance ?? 0);
          if (clamped <= 0) return null;
          return escrowStake(tx, ctx.user!.id, room.id, clamped);
        });
        // anteOk may be null (earned balance dropped to <25 between UI and submit) — game proceeds unstaked.
      }
```

Imports: `escrowStake` from `../_core/stakeEngine`, `clampAnte` from `../_core/stakeMath`. Velocity-cap errors from escrowStake must abort room creation with a TRPCError BAD_REQUEST (wrap and rethrow). Note the spec choice: a stale/over-balance ante CLAMPS silently rather than failing the game start.

- [ ] **Step 2: submitAnswer** — after the round result is computed/inserted and `correctCount` is known (find where the response object is built, both return paths), for solo + signed-in:

```typescript
      let stakeLine: Awaited<ReturnType<typeof resolveRoundStake>> = null;
      if (room.mode === "solo" && userId) {
        stakeLine = await resolveRoundStake(db, room.id, userId, correctCount, room.currentRound);
      }
```

Add `stake: stakeLine` to BOTH response objects (authed + fallback; fallback has no userId so it's null there by construction — still include `stake: null` for shape stability).

- [ ] **Step 3: nextRound** — in the `isGameOver` branch (~1089-1134), after stats updates:

```typescript
        // Settle solo stakes for signed-in players (refund staked - burned).
        for (const p of players) {
          if (p.userId) await settleStake(db, room.id, p.userId);
        }
```

(`players` — reuse whatever collection the leaderboard loop already iterates; otherwise select roomPlayers for the room.)

- [ ] **Step 4:** tsc + `pnpm test:server` green (no new tests here — engine covered in Task 4; flow verified in Task 11 manual checklist + the existing game tests must stay green).

- [ ] **Step 5: Commit**

```bash
git add server/routers/game.ts
git commit -m "feat(economy): ante escrow on room creation, per-round stake resolution, settlement on game end"
```

---

### Task 6: Signup grant (idempotent) + backfill script

**Files:**
- Modify: `server/db.ts` (upsertUser, ~43-116)
- Create: `scripts/backfill-signup-grant.mjs`
- Test: extend `server/goldenNotesLedger.live.test.ts`

- [ ] **Step 1: grant on auth** — at the end of `upsertUser` (after the upsert, for the resolved userId), fire-and-forget-safe idempotent grant:

```typescript
  // One-time signup grant: 100 earned GN (idempotent via the unique
  // idempotency key — every login attempts it, only the first ever lands).
  try {
    await db.transaction(async (tx) => {
      await creditGoldenNotes(tx, user.id, SIGNUP_GRANT, "signup_grant", "Welcome bonus", undefined, {
        pool: "earned",
        idempotencyKey: `signup-grant-${user.id}`,
      });
    });
  } catch {
    /* grant must never block auth */
  }
```

(Adapt names to the function's actual local variables; import SIGNUP_GRANT from `./_core/stakeMath` and creditGoldenNotes from the ledger — check relative paths from server/db.ts.) IMPORTANT: the dedupe path inside creditGoldenNotes must make the replay a clean no-op (returns deduped) — verify Task 3 implemented credit-side idempotency; if it only did spend-side, add the same SELECT-first + unique-catch to credit now.

- [ ] **Step 2: backfill script** `scripts/backfill-signup-grant.mjs` — connection pattern from the 0019 apply script. `--dry-run` default behavior: print the count of users lacking a `signup_grant` transaction. Real run (`--apply` flag REQUIRED): for each user id in `SELECT id FROM users WHERE id NOT IN (SELECT "userId" FROM golden_note_transactions WHERE kind='signup_grant')`, insert the grant the same way (single SQL per user: update balances + insert txn with `signup-grant-{id}` key, ON CONFLICT ("idempotencyKey") DO NOTHING). Print granted count. Controller runs it.

- [ ] **Step 3: live test:** grant lands in earned pool once; second call dedupes.

- [ ] **Step 4:** suites + tsc + `node --check`. **Step 5: Commit**

```bash
git add server/db.ts scripts/backfill-signup-grant.mjs server/goldenNotesLedger.live.test.ts
git commit -m "feat(economy): one-time 100 earned-GN signup grant + idempotent backfill script"
```

---

### Task 7: Abandonment sweep cron endpoint

**Files:**
- Create: `api-src/cron/stake-refund-sweep.ts` (mirror an existing cron handler's shape EXACTLY — read `api-src/cron/chat-retention-sweep.ts` first: export shape, auth check, db bootstrap)
- Modify: `vercel.json` (crons array)
- Modify: `scripts/build-api.mjs` ONLY IF cron entries are listed explicitly there (read it; the chat crons may be auto-discovered)

- [ ] **Step 1:** implement the handler calling `sweepAbandonedStakes(db)` and returning `{ refunded }` JSON; reuse the existing handler's auth guard verbatim (whatever it does — CRON_SECRET bearer check or Vercel-internal header).

- [ ] **Step 2:** `vercel.json` crons array — add:

```json
    {
      "path": "/api/cron/stake-refund-sweep",
      "schedule": "15 * * * *"
    }
```

(hourly at :15 — abandoned stakes refund within ~1-7h of the 6h cutoff.)

- [ ] **Step 3:** if `scripts/build-api.mjs` enumerates entrypoints, add this one the same way the chat crons are added; if it globs `api-src/`, no change. Run the build script locally to verify the bundle is produced (`node scripts/build-api.mjs` — it writes into gitignored `api/`).

- [ ] **Step 4:** tsc green. **Step 5: Commit**

```bash
git add api-src/cron/stake-refund-sweep.ts vercel.json scripts/build-api.mjs
git commit -m "feat(economy): hourly cron sweeps abandoned stakes back to players"
```

(drop build-api.mjs from the add list if unchanged.)

---

### Task 8: GameSetup ante stepper

**Files:**
- Modify: `client/src/pages/GameSetup.tsx` (between Streak Insurance ~501 and Game Summary ~504; payload ~161-170)
- Test: `client/src/pages/GameSetup.ante.test.tsx` (new)

- [ ] **Step 1: failing tests** — mock pattern from `Home.hero.test.tsx` (wouter + useAuth + trpc). Mock `trpc.goldenNotes.getMyBalance.useQuery` → `{ data: { balance: 130, earnedBalance: 80, purchasedBalance: 50 } }` plus whatever hooks GameSetup already needs (read the file; reconcile from errors and report). Tests:

```typescript
  it("ante stepper renders for signed-in solo with default 50 and shows stakeable", () => {
    // earned=80 → default 50 fits; "Stakeable: 80" visible
    render(<GameSetup />);
    expect(screen.getByTestId("ante-value").textContent).toBe("50");
    expect(screen.getByText(/stakeable/i).textContent).toMatch(/80/);
  });
  it("ante steps by 25 and clamps at earned balance", () => {
    render(<GameSetup />);
    fireEvent.click(screen.getByTestId("ante-up"));   // 75
    expect(screen.getByTestId("ante-value").textContent).toBe("75");
    fireEvent.click(screen.getByTestId("ante-up"));   // would be 100 > 80 → stays 75
    expect(screen.getByTestId("ante-value").textContent).toBe("75");
    fireEvent.click(screen.getByTestId("ante-down")); // 50
    fireEvent.click(screen.getByTestId("ante-down")); // 25
    fireEvent.click(screen.getByTestId("ante-down")); // 0 (play for fun)
    fireEvent.click(screen.getByTestId("ante-down")); // floor at 0
    expect(screen.getByTestId("ante-value").textContent).toBe("0");
  });
  it("createRoom payload includes the ante", () => {
    // fill required fields per the page's flow, click start, assert mutate called with ante: 50
  });
  it("guests see no ante section", () => {
    // authState unauthenticated → queryByTestId("ante-value") is null
  });
```

(Complete the payload test against the page's actual required-field flow — read how the existing GameSetup state initializes; if filling the whole form in jsdom is impractical, assert via the component's `createRoomMutation.mutate` mock after pressing Start with defaults, reporting any adaptation.)

- [ ] **Step 2:** run — FAIL. **Step 3: implement.** New section between Streak Insurance and Game Summary:

```tsx
          {/* Ante — stake earned Golden Notes on this game (solo, signed-in) */}
          {isAuthenticated && mode === "solo" && (
            <section className="glass rounded-xl p-4">
              <div className="flex items-center justify-between gap-4 flex-wrap">
                <div>
                  <h3 className="font-display font-semibold flex items-center gap-2">
                    <Coins className="w-4 h-4 text-yellow-400" /> Ante
                  </h3>
                  <p className="text-muted-foreground text-xs mt-1">
                    Stake Golden Notes: win a round (3+ of 4 correct) +25, lose a round −25 from your stake.
                    Unused stake comes back at the end. Stakeable: {earnedBalance}
                  </p>
                </div>
                <div className="flex items-center gap-3">
                  <Button type="button" variant="outline" size="icon" data-testid="ante-down"
                    onClick={() => setAnte(a => Math.max(0, a - 25))}>
                    <Minus className="w-4 h-4" />
                  </Button>
                  <span data-testid="ante-value" className="font-display font-bold text-xl text-yellow-400 w-12 text-center">
                    {ante}
                  </span>
                  <Button type="button" variant="outline" size="icon" data-testid="ante-up"
                    onClick={() => setAnte(a => Math.min(maxAnte, a + 25))}>
                    <Plus className="w-4 h-4" />
                  </Button>
                </div>
              </div>
              {ante === 0 && <p className="text-xs text-muted-foreground mt-2">Playing for fun — no stake.</p>}
            </section>
          )}
```

State: query `trpc.goldenNotes.getMyBalance` (enabled when authenticated); `const earnedBalance = balanceData?.earnedBalance ?? 0;` `const maxAnte = Math.floor(earnedBalance / 25) * 25;` `const [ante, setAnte] = useState<number | null>(null);` — effective ante `ante ?? Math.min(50, maxAnte)` (default 50 clamped); keep the stepper operating on the effective value (initialize state from the balance once loaded — simplest: `useEffect` setting initial ante when data arrives and state is null). Payload adds `ante: mode === "solo" && isAuthenticated ? effectiveAnte : 0`. Icons: `Coins`, `Plus`, `Minus` from lucide-react (outline). Also surface the ante in the Game Summary grid ("Ante · 50 GN") following the summary's existing item markup.

- [ ] **Step 4:** tests pass; full client suite + tsc green. **Step 5: Commit**

```bash
git add client/src/pages/GameSetup.tsx client/src/pages/GameSetup.ante.test.tsx
git commit -m "feat(economy): ante stepper in game setup (default 50, step 25, capped at earned GN)"
```

---

### Task 9: Shop — remove Advanced Mode, real Extra Game, tournament routing

**Files:**
- Modify: `client/src/pages/Shop.tsx` (~292-369)
- Modify: `server/routers/goldenNotes.ts` (new mutation)
- Modify: `server/routers/subscriptionEnforcement.ts` (extra-game credits widen the limit)
- Test: `server/extraGame.live.test.ts` (DB-gated) + extend an existing Shop/client test if one exists (check; if none, create `client/src/pages/Shop.spend.test.tsx` with a purchase-button test)

- [ ] **Step 1: server mutation** (`goldenNotes.ts`):

```typescript
  purchaseExtraGame: protectedProcedure
    .input(z.object({ idempotencyKey: z.string().max(64).optional() }))
    .mutation(async ({ ctx, input }) => {
      const db = await getDb();
      if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "DB unavailable" });
      const result = await db.transaction(async (tx) =>
        spendGoldenNotes(tx, ctx.user.id, GN_SPEND_COSTS.spend_extra_game, "spend_extra_game",
          "Extra game", { idempotencyKey: input.idempotencyKey }));
      return { success: true as const, newBalance: result.newBalance };
    }),
```

- [ ] **Step 2: eligibility integration** (`subscriptionEnforcement.ts`) — READ `checkGameEligibility` first (the limit semantics in past reports conflicted; trust the code). Wherever the games-played count is compared against the tier limit, widen the allowance by unconsumed extra-game purchases for the SAME window the limit uses (daily window → count today's `spend_extra_game` transactions; lifetime window → count all):

```typescript
      const extraGames = await db.select({ n: sql<number>`count(*)::int` })
        .from(goldenNoteTransactions)
        .where(and(
          eq(goldenNoteTransactions.userId, userId),
          eq(goldenNoteTransactions.kind, "spend_extra_game"),
          gte(goldenNoteTransactions.createdAt, windowStart), // match the limit's window exactly
        ));
      const allowance = baseLimit + (extraGames[0]?.n ?? 0);
```

Document with a comment WHY the window must match the limit's window. If the free tier is lifetime-based, count lifetime purchases for free tier and daily for paid tiers — mirror each branch's own window.

- [ ] **Step 3: Shop UI** (~292-369):
  - DELETE the two Advanced Mode cards (5 GN / 30 min, 20 GN / day) — no feature exists.
  - Extra Game card gains a real Buy button → `purchaseExtraGame.mutate({ idempotencyKey: crypto.randomUUID() })`; on success invalidate `getMyBalance` + `getTransactions`, toast "Extra game added — your next game won't count against today's limit." Disabled when `balance < 1` with an insufficient hint.
  - Replace the three Tournament Entry cards with ONE card: "Tournament Entry — 5 to 100 GN · join from the Tournaments page" + Button "Browse Tournaments →" → `navigate("/tournaments")` (the join/payEntry flow already exists there).
  - Gifting card unchanged ("Coming soon").

- [ ] **Step 4: tests** — live test: purchaseExtraGame debits 1 GN purchased-first and replays dedupe; eligibility: with the limit reached, one `spend_extra_game` txn in-window flips `checkGameEligibility` to allowed (insert the txn directly, call the function). Client test: Extra Game button calls the mutation; Advanced Mode strings absent (`queryByText(/Advanced Mode/) → null`).

- [ ] **Step 5:** suites + tsc green. **Step 6: Commit**

```bash
git add client/src/pages/Shop.tsx server/routers/goldenNotes.ts server/routers/subscriptionEnforcement.ts server/extraGame.live.test.ts client/src/pages/Shop.spend.test.tsx
git commit -m "feat(shop): real Extra Game purchase widens the play limit; Advanced Mode removed; tournaments routed"
```

---

### Task 10: Animations — header balance + results stake line (Jim)

**Files:**
- Create: `client/src/components/AnimatedGnBalance.tsx` + `client/src/components/AnimatedGnBalance.test.tsx`
- Modify: `client/src/components/PersistentHeader.tsx` (~71-83)
- Modify: `client/src/pages/RoundResults.tsx` (score group, after the streak flame; type `RoundResult` gains `stake`)

- [ ] **Step 1 (TDD): component test** — animated number that tweens between values and shows a floating delta:

```typescript
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, act } from "@testing-library/react";
import AnimatedGnBalance from "./AnimatedGnBalance";

describe("AnimatedGnBalance", () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it("renders the value and tweens to a new one", () => {
    const { rerender } = render(<AnimatedGnBalance value={100} />);
    expect(screen.getByTestId("gn-balance").textContent).toBe("100");
    rerender(<AnimatedGnBalance value={125} />);
    act(() => { vi.advanceTimersByTime(900); });
    expect(screen.getByTestId("gn-balance").textContent).toBe("125");
  });

  it("shows a floating +delta indicator on increase, −delta on decrease", () => {
    const { rerender } = render(<AnimatedGnBalance value={100} />);
    rerender(<AnimatedGnBalance value={125} />);
    expect(screen.getByTestId("gn-delta").textContent).toContain("+25");
    rerender(<AnimatedGnBalance value={75} />);
    expect(screen.getByTestId("gn-delta").textContent).toContain("-50");
  });

  it("reduced motion: jumps instantly, still shows the delta", () => {
    window.matchMedia = vi.fn().mockReturnValue({ matches: true, addEventListener: vi.fn(), removeEventListener: vi.fn() }) as any;
    const { rerender } = render(<AnimatedGnBalance value={100} />);
    rerender(<AnimatedGnBalance value={150} />);
    expect(screen.getByTestId("gn-balance").textContent).toBe("150");
  });
});
```

- [ ] **Step 2: implement** `AnimatedGnBalance.tsx` — props `{ value: number; className?: string }`. Internals: `usePrevious`-style ref; on value change compute delta; if `prefers-reduced-motion` jump, else rAF/interval tween over ~800ms (round to int each frame); floating delta: absolutely-positioned span (`+N` green / `−N` red-orange) with a CSS animation (translateY + fade, ~1.2s, then unmount via timeout); `Music2` outline icon stays in the HEADER (the component renders just the number + delta so it's reusable). No emoji.

- [ ] **Step 3: header integration** — replace the raw number in `PersistentHeader.tsx:71-83` with `<AnimatedGnBalance value={balance?.balance ?? 0} />` (keep the Music2 icon + link). Also bump the query: add `refetchInterval: 30_000` is NOT needed — balance updates flow from existing invalidations; leave the query config as is.

- [ ] **Step 4: stake line in RoundResults** — `RoundResult` type gains:

```typescript
  stake?: { staked: number; burned: number; win: number; burn: number; remaining: number } | null;
```

Render inside the score group, after the streak flame block (both zero and non-zero branches show it when present):

```tsx
                {result.stake && (
                  <div data-testid="stake-line" className="flex items-center justify-center sm:justify-start gap-1 mt-2">
                    <Coins className="w-4 h-4 text-yellow-400" />
                    {result.stake.win > 0 ? (
                      <span className="text-yellow-400 font-medium text-sm">+{result.stake.win} GN won</span>
                    ) : result.stake.burn > 0 ? (
                      <span className="text-orange-400 font-medium text-sm">−{result.stake.burn} GN from stake</span>
                    ) : (
                      <span className="text-muted-foreground text-sm">Stake unchanged</span>
                    )}
                    <span className="text-muted-foreground text-xs ml-1">· {result.stake.remaining} staked remaining</span>
                  </div>
                )}
```

Add two cases to `RoundResults.breakdown.test.tsx`: stake win line renders (+25 GN won), no stake → no line.

- [ ] **Step 5:** suites + tsc green. **Step 6: Commit**

```bash
git add client/src/components/AnimatedGnBalance.tsx client/src/components/AnimatedGnBalance.test.tsx client/src/components/PersistentHeader.tsx client/src/pages/RoundResults.tsx client/src/pages/RoundResults.breakdown.test.tsx
git commit -m "feat(economy): animated header balance with floating deltas; stake line on round results"
```

---

### Task 11: Full verification + manual checklist

**Files:**
- Create: `docs/superpowers/specs/2026-06-10-gn-manual-test-checklist.md`

- [ ] **Step 1:** `pnpm exec tsc --noEmit && pnpm test` — all green; paste counts. (Controller additionally runs the live DB-gated suites.)
- [ ] **Step 2: write the manual checklist** — concrete steps for Deric: stake a 50-ante game and verify escrow in header animation; win a round → +25 line + header tick; lose rounds → burns; finish → refund; abandon a staked game → refunded within ~1h of the 6h cutoff (or run the sweep by hand); buy Extra Game past the daily limit and start a game; verify Advanced Mode gone; tournament join from Shop routing; hint/insurance still work and now log distinct kinds; signup grant visible for a fresh account; ante hidden for guests; reduced-motion check.
- [ ] **Step 3: report** deviations + the two controller actions pending: apply migration 0020, run backfill script.

---

## Self-review notes (already applied)

- Spec coverage: pool split (T1/T3), earning paths (T4/T6 — practice-pack deviation documented in header), ante lifecycle incl. velocity cap + 0-correct rule (T2/T4/T5), D2 refactor + idempotency (T3), abandonment cron (T4/T7), animations (T10), Shop incl. Advanced-Mode removal + gifting deferred + tournament wiring deviation (T9), signup grant + backfill (T6), tests + manual checklist (every task + T11).
- Type consistency: `spendGoldenNotes(tx, userId, cost, kind, reason, opts)` and `creditGoldenNotes(tx, userId, amount, kind, reason, relatedUserId?, opts)` used identically in T3/T4/T6/T9. Stake UI payload shape (`staked/burned/win/burn/remaining`) identical in T5 (server) and T10 (client type).
- Burns intentionally write NO transaction row (no balance movement — escrow already debited); the gn_stakes row is the burn audit. getTransactions therefore shows escrow/win/refund only.
- Migration 0020 + backfill are CONTROLLER actions, never subagent.
