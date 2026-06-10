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
