# Gameplay & Results Fixes Implementation Plan (Project A)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Fix MC scoring bugs (both directions), show all four breakdown rows at every difficulty, replace the bogus "Round Passed" banner, correct difficulty copy, verify auto-advance, and fire the celebration when results mount.

**Architecture:** Scoring gains an exact-match MC mode in the shared `_core/scoring.ts` engine (fuzzy matchers stay for typed/voice paths); `submitAnswer` realigns the played variant when the submitted lyric exactly equals a different variant (display-row drift). Client changes are confined to `RoundResults.tsx`, `GameSetup.tsx`, `Gameplay.tsx`, `Celebration.tsx`, plus a new shared AudioContext singleton.

**Tech Stack:** TypeScript, tRPC, Drizzle, React, vitest (`pnpm test:server` = `vitest run --config vitest.config.ts`, `pnpm test:client` = `vitest run --config vitest.client.config.ts`), Testing Library.

**Spec:** `docs/superpowers/specs/2026-06-10-gameplay-results-fixes-design.md`

**Project conventions that bind every task:** no emoji icons (outline lucide only); never run `db:push`/`drizzle-kit generate`; local DB = prod (read-only queries only in this project); no `Co-Authored-By: Claude` trailer on commits.

---

## Background for the implementer (read first)

- Scoring engine: `server/_core/scoring.ts` — pure functions `normalizeText`, `levenshtein`, `matchLyric`, `matchArtist`, `scoreYear`, `scoreRound`. Existing tests: `server/scoring.test.ts` (vitest, pure — no DB).
- Solo gameplay is 100% multiple-choice: `client/src/pages/Gameplay.tsx` `pickOption()` (line ~254) collects 4 answers (lyric→title→artist→year) then `submitAnswers` fires `trpc.game.submitAnswer`.
- `submitAnswer` (`server/routers/game.ts:672`) re-reads the latest `song_displays` row to find which lyric variant the player saw (`playedVariant`, line ~735), then calls `scoreRound` (line ~785). Input already has `answerMethod: z.enum(["typed", "voice"]).default("typed")` (line 682).
- MC options are built in `getNextSong` (`server/routers/game.ts:601-641`): `titleOptions`/`artistOptions` mix the correct value with 3 distractors from other songs; `lyricOptions` mix `pickedVariant.answer` with stored distractors.
- **Bug direction 1 (wrong→points):** fuzzy thresholds — title full-match allows edit distance `max(2, 30%)` (`scoring.ts:220`), so picking distractor "Stan" when correct is "Stay" scores full; artist fuzzy allows `max(2, 30%)` (`scoring.ts:75`), so "NAV" matches "Nas"; lyric "full" needs only 60% word overlap (`scoring.ts:52`).
- **Bug direction 2 (correct→0):** if `getNextSong` runs twice for the same song (remount/refetch), a second `song_displays` row with a different `variantIndex` can be written; scoring then compares the player's picked option (from the FIRST render) against a DIFFERENT variant's answer → "none".
- Results screen: `client/src/pages/RoundResults.tsx`. `passedRound` heuristic at line 121; breakdown at lines 333-387 (lyric row gated on `isHighDiff`, line 337); celebration currently triggered by `handleNext()` (line 94) on the Next Round click.
- Celebration component: `client/src/components/Celebration.tsx` — `CelebrationProps { level, onComplete, duration?, muted }`; creates Web Audio sounds internally.
- Difficulty copy: `client/src/pages/GameSetup.tsx:182-186` and the helper line 366.
- Client test mocking pattern to copy: `client/src/pages/Interstitial.test.tsx` (vi.mock wouter / useAuth / `@/lib/trpc` with `vi.hoisted` state).

---

### Task 1: Exact-match MC mode in the scoring engine

**Files:**
- Modify: `server/_core/scoring.ts`
- Test: `server/scoring.test.ts` (append a new describe block)

- [ ] **Step 1: Write failing tests**

Append to `server/scoring.test.ts`:

```typescript
// ── MC exact-match mode (mcMode) ──────────────────────────────────────────────
import { scoreRound, type ScoreRoundInput } from "./_core/scoring";

function mcInput(overrides: Partial<ScoreRoundInput>): ScoreRoundInput {
  return {
    difficulty: "medium",
    passUsed: false,
    lyricAnswer: "shake it off shake it off",
    titleAnswer: "Stay",
    artistAnswer: "Nas",
    yearAnswer: "1994",
    correctLyricAnswer: "shake it off shake it off",
    correctTitle: "Stay",
    correctArtistName: "Nas",
    correctReleaseYear: 1994,
    artistAliases: [],
    responseTimeSeconds: 10,
    timerSeconds: 90,
    rankingMode: "standard",
    newStreak: 0,
    mcMode: true,
    ...overrides,
  };
}

describe("scoreRound mcMode (multiple-choice exact matching)", () => {
  it("wrong title option close in edit distance scores 0 (fuzzy would match)", () => {
    const r = scoreRound(mcInput({ titleAnswer: "Stan" })); // lev("stan","stay")=2 ≤ fuzzy threshold
    expect(r.titleCorrect).toBe(false);
    expect(r.titlePoints).toBe(0);
  });

  it("wrong short artist option within edit distance 2 scores 0", () => {
    const r = scoreRound(mcInput({ artistAnswer: "NAV" })); // lev("nav","nas")=1
    expect(r.artistMatch).toBe("none");
    expect(r.artistPoints).toBe(0);
  });

  it("wrong lyric option sharing >60% words scores 0", () => {
    const r = scoreRound(mcInput({
      correctLyricAnswer: "shake it off shake it off",
      lyricAnswer: "shake it up shake it up",
    }));
    expect(r.lyricMatch).toBe("none");
    expect(r.lyricPoints).toBe(0);
  });

  it("exact picks score full on all four axes (medium: 50/50/50/100)", () => {
    const r = scoreRound(mcInput({}));
    expect(r.lyricPoints).toBe(50);
    expect(r.titlePoints).toBe(50);
    expect(r.artistPoints).toBe(50);
    expect(r.yearPoints).toBe(100);
    expect(r.totalRoundPoints).toBe(250);
  });

  it("exact match tolerates case/punctuation differences (normalizeText)", () => {
    const r = scoreRound(mcInput({ titleAnswer: "stay!", artistAnswer: "NAS" }));
    expect(r.titleCorrect).toBe(true);
    expect(r.artistMatch).toBe("full");
  });

  it("artist alias exact match counts as full in mcMode", () => {
    const r = scoreRound(mcInput({
      correctArtistName: "Sean Combs",
      artistAliases: ["Diddy", "Puff Daddy"],
      artistAnswer: "Puff Daddy",
    }));
    expect(r.artistMatch).toBe("full");
  });

  it("typed mode (mcMode absent) keeps fuzzy behavior", () => {
    const r = scoreRound(mcInput({ mcMode: undefined, titleAnswer: "Stan" }));
    expect(r.titleCorrect).toBe(true); // fuzzy threshold allows it — unchanged
  });
});
```

- [ ] **Step 2: Run tests to verify the new ones fail**

Run: `pnpm test:server -- scoring.test.ts`
Expected: the three "scores 0" tests FAIL (fuzzy matches them today); typescript may also error on the unknown `mcMode` field — both are the expected red state.

- [ ] **Step 3: Implement mcMode in scoreRound**

In `server/_core/scoring.ts`:

Add to `ScoreRoundInput` (after `newStreak`, line ~147):

```typescript
  /** Multiple-choice mode: answers are picked options, so lyric/title/artist
   *  match by normalized exact equality (aliases allowed for artist). Fuzzy
   *  matchers remain for typed/voice input when this is false/undefined. */
  mcMode?: boolean;
```

In `scoreRound`, destructure `mcMode` alongside the other fields, then replace the three match computations inside `if (!passUsed) {` with mode-aware versions:

```typescript
    // Lyric scoring (all difficulties) — use the variant the player saw,
    // not the legacy column, so variant rotation scores correctly.
    lyricMatch = mcMode
      ? (normalizeText(lyricAnswer) === normalizeText(correctLyricAnswer) ? "full" : "none")
      : matchLyric(lyricAnswer, correctLyricAnswer);
    lyricPoints = lyricMatch === "full" ? pts.lyric : lyricMatch === "partial" ? pts.lyricPartial : 0;
```

Title block (replace the body of `if (titleNorm && correctTitleNorm) {`):

```typescript
    if (titleNorm && correctTitleNorm) {
      if (mcMode) {
        if (titleNorm === correctTitleNorm) {
          titleCorrect = true;
          titlePoints = pts.title;
        }
      } else {
        // Full match: exact, or up to 30% edit distance (generous for typos/voice input)
        const titleEditDist = levenshtein(titleNorm, correctTitleNorm);
        const titleThreshold = Math.max(2, Math.floor(correctTitleNorm.length * 0.30));
        if (titleNorm === correctTitleNorm || titleEditDist <= titleThreshold) {
          titleCorrect = true;
          titlePoints = pts.title;
        } else {
          const titleWords = correctTitleNorm.split(" ").filter(w => w.length > 1);
          const userTitleWords = titleNorm.split(" ");
          if (titleWords.length > 0) {
            const matched = titleWords.filter(tw => userTitleWords.some(uw => uw === tw || levenshtein(uw, tw) <= 2));
            if (matched.length / titleWords.length >= 0.5) {
              titlePartial = true;
              titlePoints = pts.titlePartial;
            }
          }
        }
      }
    }
```

(`titleNorm`/`correctTitleNorm` are already computed above the block — keep them.)

Artist:

```typescript
    artistMatch = mcMode
      ? ((normalizeText(artistAnswer) === normalizeText(correctArtistName) ||
          (input.artistAliases ?? []).some(a => normalizeText(a) === normalizeText(artistAnswer)))
          ? "full" : "none")
      : matchArtist(artistAnswer, correctArtistName, artistAliases);
    artistPoints = artistMatch === "full" ? pts.artist : artistMatch === "primary_only" ? pts.artistPartial : 0;
```

Year scoring is already exact-or-zero (`yearClose2`/`yearClose3` are 0) — unchanged.

- [ ] **Step 4: Run tests to verify all pass**

Run: `pnpm test:server -- scoring.test.ts`
Expected: PASS (entire file — fuzzy describe blocks must still pass untouched).

- [ ] **Step 5: Commit**

```bash
git add server/_core/scoring.ts server/scoring.test.ts
git commit -m "feat(scoring): exact-match mcMode for multiple-choice answers

Fuzzy thresholds (30% title/artist edit distance, 60% lyric word
overlap) were built for typed/voice input and overmatch deliberately
similar MC distractors. mcMode compares normalized exact equality
(artist aliases allowed). Typed/voice paths unchanged."
```

---

### Task 2: Wire mcMode through submitAnswer + variant realignment + client flag

**Files:**
- Modify: `server/routers/game.ts:672-801` (submitAnswer)
- Modify: `client/src/pages/Gameplay.tsx` (the `submitAnswers` call site — search for `submitMutation.mutate(`)
- Test: `server/scoring.test.ts` (pure helper test appended)

- [ ] **Step 1: Write failing test for the variant-realignment helper**

Append to `server/scoring.test.ts`:

```typescript
import { resolveMcVariant } from "./_core/scoring";

describe("resolveMcVariant (display-row drift realignment)", () => {
  const variants = [
    { prompt: "p0", answer: "hello darkness my old friend" },
    { prompt: "p1", answer: "i've come to talk with you again" },
  ];
  it("keeps the played variant when the answer matches it", () => {
    expect(resolveMcVariant(variants[0], variants, "Hello darkness, my old friend"))
      .toBe(variants[0]);
  });
  it("realigns to another variant on exact match (player saw a stale display row)", () => {
    expect(resolveMcVariant(variants[0], variants, "I've come to talk with you again"))
      .toBe(variants[1]);
  });
  it("keeps the played variant when nothing matches (genuinely wrong answer)", () => {
    expect(resolveMcVariant(variants[0], variants, "some wrong distractor"))
      .toBe(variants[0]);
  });
});
```

- [ ] **Step 2: Run to verify failure**

Run: `pnpm test:server -- scoring.test.ts`
Expected: FAIL — `resolveMcVariant` is not exported.

- [ ] **Step 3: Implement the helper in `server/_core/scoring.ts`**

```typescript
/** MC answers are option strings the client rendered. If the most recent
 *  song_displays row drifted (getNextSong re-ran after the question was
 *  rendered), the submitted lyric may exactly equal a DIFFERENT variant's
 *  answer. Realign so a correct pick is never scored against the wrong
 *  variant. An exact variant answer is always correct content for the song. */
export function resolveMcVariant<V extends { answer: string }>(
  playedVariant: V,
  allVariants: V[],
  lyricAnswer: string,
): V {
  const submitted = normalizeText(lyricAnswer);
  if (submitted === normalizeText(playedVariant.answer)) return playedVariant;
  return allVariants.find(v => normalizeText(v.answer) === submitted) ?? playedVariant;
}
```

- [ ] **Step 4: Run to verify pass**

Run: `pnpm test:server -- scoring.test.ts`
Expected: PASS.

- [ ] **Step 5: Wire into submitAnswer**

In `server/routers/game.ts`:

1. Input enum (line 682): `answerMethod: z.enum(["typed", "voice", "mc"]).default("typed"),`
2. Import `resolveMcVariant` from `../_core/scoring` (extend the existing import).
3. After `playedVariant` is computed (line ~737), add:

```typescript
      const mcMode = input.answerMethod === "mc";
      const effectiveVariant = mcMode
        ? resolveMcVariant(playedVariant, allVariants, input.lyricAnswer)
        : playedVariant;
```

4. Replace both downstream uses of `playedVariant.answer`:
   - Streak-insurance pre-check (line 765) becomes:

```typescript
      const preCheckLyricCorrect = !input.passUsed && (
        mcMode
          ? normalizeText(input.lyricAnswer) === normalizeText(effectiveVariant.answer)
          : matchLyric(input.lyricAnswer, effectiveVariant.answer) === "full"
      );
```

   (import `normalizeText` from `../_core/scoring` if not already imported.)
   - `scoreRound` call (line ~792): `correctLyricAnswer: effectiveVariant.answer,` and add `mcMode,` to the input object.

5. If the round-result response or DB insert references `playedVariant` further down, switch those reads to `effectiveVariant` too (grep `playedVariant` within submitAnswer and update every use after the realignment point).

- [ ] **Step 6: Client sends the flag**

In `client/src/pages/Gameplay.tsx`, find the `submitMutation.mutate({...})` payload inside `submitAnswers` and add `answerMethod: "mc" as const,`. (Solo gameplay is MC-only — `pickOption` is the sole answer path.)

- [ ] **Step 7: Typecheck + full server tests**

Run: `pnpm exec tsc --noEmit && pnpm test:server`
Expected: clean typecheck, all server tests PASS.

- [ ] **Step 8: Commit**

```bash
git add server/routers/game.ts server/_core/scoring.ts server/scoring.test.ts client/src/pages/Gameplay.tsx
git commit -m "fix(scoring): score MC submissions exactly and realign drifted variants

submitAnswer now passes mcMode for multiple-choice clients and uses
resolveMcVariant so a correct pick is never compared against a variant
the player wasn't shown (display-row drift on remount/refetch)."
```

---

### Task 3: Read-only audit script for historical mis-scored rounds

**Files:**
- Create: `scripts/audit-mc-scoring.mjs`

The DB is prod (single-Supabase topology) — this script is **strictly read-only** (SELECTs only).

- [ ] **Step 1: Write the script**

```javascript
// Audit recent round_results for MC scoring anomalies (READ-ONLY).
// Usage: node scripts/audit-mc-scoring.mjs [--days 14]
// For each recent round_result, re-derives what exact-match scoring would
// have awarded and prints rows where stored points disagree — i.e. rounds
// hit by fuzzy overmatch (wrong→points) or variant drift (correct→0).
import { config } from "dotenv";
config();
import postgres from "postgres";

const days = process.argv.includes("--days")
  ? parseInt(process.argv[process.argv.indexOf("--days") + 1], 10)
  : 14;

const sql = postgres(process.env.DATABASE_URL, { max: 1 });

const normalize = (t) => (t ?? "").toLowerCase().replace(/[^\w\s]/g, "").replace(/\s+/g, " ").trim();

const rows = await sql`
  SELECT rr.id, rr."roomId", rr."songId",
         rr."lyricAnswer", rr."titleAnswer", rr."artistAnswer", rr."yearAnswer",
         rr."lyricPoints", rr."titlePoints", rr."artistPoints", rr."yearPoints",
         s.title AS correct_title, s."artistName" AS correct_artist, s."releaseYear" AS correct_year,
         rr."createdAt"
  FROM round_results rr
  JOIN songs s ON s.id = rr."songId"
  WHERE rr."createdAt" > NOW() - ${days + " days"}::interval
  ORDER BY rr."createdAt" DESC
  LIMIT 2000`;

let overmatch = 0, undermatch = 0;
for (const r of rows) {
  const titleExact = normalize(r.titleAnswer) === normalize(r.correct_title);
  const artistExact = normalize(r.artistAnswer) === normalize(r.correct_artist);
  const yearExact = parseInt(r.yearAnswer, 10) === r.correct_year;

  const flags = [];
  if (!titleExact && (r.titlePoints ?? 0) > 0) flags.push(`title OVERMATCH "${r.titleAnswer}" vs "${r.correct_title}" (+${r.titlePoints})`);
  if (titleExact && (r.titlePoints ?? 0) === 0) flags.push(`title UNDERMATCH "${r.titleAnswer}" scored 0`);
  if (!artistExact && (r.artistPoints ?? 0) > 0) flags.push(`artist OVERMATCH "${r.artistAnswer}" vs "${r.correct_artist}" (+${r.artistPoints})`);
  if (artistExact && (r.artistPoints ?? 0) === 0) flags.push(`artist UNDERMATCH "${r.artistAnswer}" scored 0`);
  if (yearExact && (r.yearPoints ?? 0) === 0) flags.push(`year UNDERMATCH ${r.yearAnswer} scored 0`);

  if (flags.length) {
    for (const f of flags) f.includes("OVERMATCH") ? overmatch++ : undermatch++;
    console.log(`#${r.id} room=${r.roomId} song=${r.songId} ${r.createdAt.toISOString().slice(0, 10)}\n  ${flags.join("\n  ")}`);
  }
}
console.log(`\n${rows.length} rounds audited (last ${days}d): ${overmatch} overmatch, ${undermatch} undermatch line items`);
// NOTE: artist OVERMATCH lines include legitimate alias matches — cross-check
// flagged artists against artist_metadata.aliases before treating as bugs.
// Lyric axis is omitted: correct variant answers aren't recoverable per-row
// without joining song_displays variantIndex; title/artist/year suffice to
// size the problem.
await sql.end();
```

Note for the implementer: verify the actual `round_results` column names against `drizzle/schema.ts` before running (camelCase vs snake_case quoting) and adjust the SELECT to match. If answers aren't stored per-axis in `round_results`, reduce the audit to the axes that ARE stored and say so in the run summary.

- [ ] **Step 2: Run it**

Run: `node scripts/audit-mc-scoring.mjs --days 14`
Expected: a printed list of flagged rounds + summary counts. Paste the summary into the task report — it quantifies the user-visible impact and confirms the Task 1/2 fix targets real rows. No data is modified.

- [ ] **Step 3: Commit**

```bash
git add scripts/audit-mc-scoring.mjs
git commit -m "chore(scoring): read-only audit script for MC scoring anomalies"
```

---

### Task 4: Score breakdown — all four rows + zero-score banner

**Files:**
- Modify: `client/src/pages/RoundResults.tsx`
- Test: Create `client/src/pages/RoundResults.breakdown.test.tsx`

- [ ] **Step 1: Write failing tests**

```typescript
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";

const navigate = vi.fn();
vi.mock("wouter", async () => {
  const actual: Record<string, unknown> = await vi.importActual("wouter");
  return {
    ...actual,
    useLocation: () => ["/results/round/ROOM42", navigate],
    useParams: () => ({ roomCode: "ROOM42" }),
  };
});
vi.mock("@/_core/hooks/useAuth", () => ({
  useAuth: () => ({ user: null, isAuthenticated: false }),
}));
const nextRound = vi.hoisted(() => ({ mutate: vi.fn() }));
vi.mock("@/lib/trpc", () => ({
  trpc: {
    game: {
      getRoom: { useQuery: () => ({ data: { currentRound: 1, roundsTotal: 3, difficulty: "low" } }) },
      nextRound: { useMutation: () => nextRound },
    },
  },
}));
// Celebration renders nothing in tests (canvas/Web Audio unavailable in jsdom)
vi.mock("@/components/Celebration", () => ({
  __esModule: true,
  default: () => null,
}));

import RoundResults from "./RoundResults";

function seedResult(overrides: Record<string, unknown> = {}) {
  sessionStorage.setItem("lyricpro_round_result_ROOM42", JSON.stringify({
    lyricCorrect: true, artistCorrect: true, titleCorrect: true,
    lyricPoints: 25, artistPoints: 25, titlePoints: 25, yearPoints: 50,
    speedBonus: 0, streakBonus: 0, total: 125, newScore: 125, newStreak: 1,
    correctLyric: "the answer line", correctArtist: "Artist", correctYear: 1999,
    correctCount: 4, celebrationCount: 4, difficulty: "low", commentary: null,
    song: { id: 1, title: "Song", artistName: "Artist", lyricPrompt: "prompt", genre: "Pop", decade: "1990–2000" },
    ...overrides,
  }));
}

describe("RoundResults score breakdown", () => {
  beforeEach(() => { sessionStorage.clear(); navigate.mockClear(); });

  it("shows the Lyric row on LOW difficulty (all four axes visible)", () => {
    seedResult({ difficulty: "low" });
    render(<RoundResults />);
    expect(screen.getByText("Lyric")).toBeTruthy();
    expect(screen.getByText("Song Title")).toBeTruthy();
    expect(screen.getByText("Artist")).toBeTruthy();
    expect(screen.getByText("Release Year")).toBeTruthy();
  });

  it("zero-score round shows encouraging copy, not 'Round Passed'", () => {
    seedResult({
      difficulty: "low",
      lyricCorrect: false, artistCorrect: false, titleCorrect: false,
      lyricPoints: 0, artistPoints: 0, titlePoints: 0, yearPoints: 0,
      total: 0, newScore: 0, correctCount: 0, celebrationCount: 0,
    });
    render(<RoundResults />);
    expect(screen.queryByText("Round Passed")).toBeNull();
    expect(screen.getByText(/Tough Round/i)).toBeTruthy();
    // Breakdown still rendered beneath
    expect(screen.getByText("Song Title")).toBeTruthy();
  });
});
```

- [ ] **Step 2: Run to verify failure**

Run: `pnpm test:client -- RoundResults.breakdown.test.tsx`
Expected: FAIL — Lyric row absent on low, "Round Passed" present on zero score.

- [ ] **Step 3: Implement in `RoundResults.tsx`**

1. Line 121 — delete the `passedRound` heuristic; replace with:

```typescript
  const zeroScore = result.total === 0;
```

2. Lines 124-126 — add the lyric max alongside the others:

```typescript
  const maxLyric = isHighDiff ? 50 : diff === "medium" ? 50 : 25;
```

3. Lines 246-277 — replace the `passedRound ? (...) : (...)` ternary with `zeroScore ? (...) : (...)`; the zero branch becomes (note `MicVocal` is already imported; `SkipForward` import can be removed if now unused):

```tsx
                {zeroScore ? (
                  <>
                    <MicVocal className="w-10 h-10 text-muted-foreground mx-auto sm:mx-0 mb-2" />
                    <p className="text-foreground font-medium">Tough Round — no points this time.</p>
                    <p className="text-muted-foreground text-sm mt-1">The next one's yours.</p>
                    {result.commentary && (
                      <p className="text-sm text-muted-foreground italic mt-2">{result.commentary}</p>
                    )}
                  </>
                ) : (
```

(keep the existing non-zero branch exactly as is).

4. Lines 337-344 — un-gate the Lyric row:

```tsx
              <ScoreRow
                label="Lyric"
                correct={result.lyricCorrect}
                points={result.lyricPoints}
                maxPoints={maxLyric}
              />
```

(remove the `{isHighDiff && (...)}` wrapper.)

- [ ] **Step 4: Run to verify pass**

Run: `pnpm test:client -- RoundResults.breakdown.test.tsx`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add client/src/pages/RoundResults.tsx client/src/pages/RoundResults.breakdown.test.tsx
git commit -m "fix(results): show all four breakdown rows; replace bogus 'Round Passed' banner

There is no pass feature — the heuristic fired on any zero-score round.
Zero scores now get encouraging copy above the normal breakdown, and the
Lyric row shows at every difficulty (was High-only)."
```

---

### Task 5: Difficulty descriptions — 4 questions, true maxes

**Files:**
- Modify: `client/src/pages/GameSetup.tsx:182-186` and line 366

- [ ] **Step 1: Replace the copy**

Lines 182-186:

```typescript
  const difficultyOptions = [
    { value: "low", label: "Low", desc: "4 questions per round — finish the lyric, name the title, artist & year (125 pts max)", color: "text-green-400" },
    { value: "medium", label: "Medium", desc: "4 questions per round — finish the lyric, name the title, artist & year (250 pts max)", color: "text-yellow-400" },
    { value: "high", label: "High", desc: "4 questions per round — finish the lyric, name the title, artist & year (400 pts max)", color: "text-red-400" },
  ];
```

Line 366:

```tsx
              <p className="text-muted-foreground text-sm mb-4">Every round asks 4 questions — lyric, title, artist, and year. Points scale with difficulty.</p>
```

- [ ] **Step 2: Visual check + client tests still green**

Run: `pnpm test:client`
Expected: PASS (no test asserts the old copy; if one does, update it to the new strings).

- [ ] **Step 3: Commit**

```bash
git add client/src/pages/GameSetup.tsx
git commit -m "fix(setup): difficulty copy reflects 4 questions/round and true maxes 125/250/400"
```

---

### Task 6: Auto-advance regression tests (verification only)

**Files:**
- Create: `client/src/pages/Gameplay.autoadvance.test.tsx`

Spec stance: no observed failure — add regression coverage; fix only what the tests expose.

- [ ] **Step 1: Write the test**

Mock surface for `Gameplay.tsx` (mirror the Interstitial/MultiplayerGameplay mock style). Gameplay's tRPC usage: `game.getRoom.useQuery` (+ `refetch`), `game.getNextSong.useMutation`, `game.submitAnswer.useMutation`, `game.nextRound.useMutation`, `game.useHint.useMutation`, `game.startGame.useMutation`, `trpc.useUtils()` (for `goldenNotes.getMyBalance.invalidate`). If the component imports more hooks at render time, the test run will name them — add each to the mock in the same shape.

```typescript
import { describe, it, expect, vi, beforeEach } from "vitest";

const navigate = vi.fn();
vi.mock("wouter", async () => {
  const actual: Record<string, unknown> = await vi.importActual("wouter");
  return {
    ...actual,
    useLocation: () => ["/play/ROOM42", navigate],
    useParams: () => ({ roomCode: "ROOM42" }),
    useSearch: () => "",
  };
});
vi.mock("@/_core/hooks/useAuth", () => ({
  useAuth: () => ({ user: null, isAuthenticated: false }),
}));

type MutationOpts = { onSuccess?: (data: unknown) => void; onError?: (e: unknown) => void };
const captured = vi.hoisted(() => ({ submitOpts: null as MutationOpts | null }));
const submitMutate = vi.hoisted(() => vi.fn());

vi.mock("@/lib/trpc", () => ({
  trpc: {
    useUtils: () => ({ goldenNotes: { getMyBalance: { invalidate: vi.fn() } } }),
    game: {
      getRoom: {
        useQuery: () => ({
          data: {
            id: 1, roomCode: "ROOM42", status: "in_progress", mode: "solo",
            currentRound: 1, roundsTotal: 3, timerSeconds: 90, difficulty: "low",
            rankingMode: "standard", streakInsurance: false,
            players: [{ id: 1, userId: null, guestToken: "guest-tok", score: 0, currentStreak: 0 }],
          },
          refetch: vi.fn(),
        }),
      },
      getNextSong: { useMutation: () => ({ mutate: vi.fn(), isPending: false }) },
      submitAnswer: {
        useMutation: (opts: MutationOpts) => {
          captured.submitOpts = opts;
          return { mutate: submitMutate, isPending: false };
        },
      },
      nextRound: { useMutation: () => ({ mutate: vi.fn() }) },
      useHint: { useMutation: () => ({ mutate: vi.fn(), isPending: false }) },
      startGame: { useMutation: () => ({ mutate: vi.fn() }) },
    },
  },
}));

import { render, act } from "@testing-library/react";
import Gameplay from "./Gameplay";

describe("Gameplay auto-advance to results", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    navigate.mockClear();
    captured.submitOpts = null;
    localStorage.setItem("lyricpro_guest_token", "guest-tok");
  });

  it("navigates to round results ~600ms after a successful last-answer submit", () => {
    render(<Gameplay />);
    expect(captured.submitOpts?.onSuccess).toBeTruthy();
    act(() => {
      captured.submitOpts!.onSuccess!({
        total: 125, newScore: 125, newStreak: 1, correctCount: 4, celebrationCount: 4,
        lyricCorrect: true, titleCorrect: true, artistCorrect: true,
        lyricPoints: 25, titlePoints: 25, artistPoints: 25, yearPoints: 50,
        speedBonus: 0, streakBonus: 0,
        correctLyric: "x", correctArtist: "y", correctYear: 1999, difficulty: "low",
      });
    });
    act(() => { vi.advanceTimersByTime(700); });
    expect(navigate).toHaveBeenCalledWith("/results/round/ROOM42");
  });

  it("a submit error does NOT navigate and re-enables answering", () => {
    render(<Gameplay />);
    act(() => { captured.submitOpts!.onError!(new Error("boom")); });
    act(() => { vi.advanceTimersByTime(1000); });
    expect(navigate).not.toHaveBeenCalled();
  });
});
```

(`sonner`'s toast may need a no-op mock if jsdom complains: `vi.mock("sonner", () => ({ toast: { error: vi.fn(), success: vi.fn() } }));`.)

- [ ] **Step 2: Run; reconcile the mock surface**

Run: `pnpm test:client -- Gameplay.autoadvance.test.tsx`
Expected: PASS. If the render throws on an unmocked hook (the error names it), add that hook to the `@/lib/trpc` mock in the same `{ useQuery/useMutation }` shape and re-run — repeat until green. If the navigation assertion itself fails, that's a real bug: investigate `Gameplay.tsx:104-121` before touching the test.

- [ ] **Step 3: Commit**

```bash
git add client/src/pages/Gameplay.autoadvance.test.tsx
git commit -m "test(gameplay): regression coverage for auto-advance to round results"
```

---

### Task 7: Celebration on results mount + shared AudioContext

**Files:**
- Create: `client/src/lib/sharedAudio.ts`
- Modify: `client/src/components/Celebration.tsx` (swap its AudioContext creation for the singleton)
- Modify: `client/src/pages/Gameplay.tsx` (unlock on answer click)
- Modify: `client/src/pages/RoundResults.tsx` (mount-trigger; instant Next Round)
- Test: Create `client/src/lib/sharedAudio.test.ts`, extend `client/src/pages/RoundResults.breakdown.test.tsx`

- [ ] **Step 1: Write failing singleton test**

`client/src/lib/sharedAudio.test.ts`:

```typescript
import { describe, it, expect, vi, beforeEach } from "vitest";

const resume = vi.fn().mockResolvedValue(undefined);
class FakeAudioContext {
  state = "suspended";
  resume = resume;
}
vi.stubGlobal("AudioContext", FakeAudioContext);

import { getSharedAudioContext, unlockAudioOnGesture } from "./sharedAudio";

describe("sharedAudio singleton", () => {
  beforeEach(() => resume.mockClear());

  it("returns the same context across calls", () => {
    expect(getSharedAudioContext()).toBe(getSharedAudioContext());
  });

  it("unlockAudioOnGesture resumes a suspended context", () => {
    unlockAudioOnGesture();
    expect(resume).toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: Run to verify failure**

Run: `pnpm test:client -- sharedAudio.test.ts`
Expected: FAIL — module doesn't exist.

- [ ] **Step 3: Implement `client/src/lib/sharedAudio.ts`**

```typescript
/**
 * Module-level AudioContext singleton (research delta D5).
 *
 * - One context per session: browsers cap concurrent contexts and each new
 *   context starts suspended until a user gesture.
 * - unlockAudioOnGesture() must be called from a real user-gesture handler
 *   (gameplay answer clicks do this) so later programmatic sounds — e.g. the
 *   celebration chime on results-mount — are already unlocked.
 * - iOS WKWebView (Capacitor): Web Audio obeys the physical silent switch
 *   (WebKit bug 237322). Playing a short silent <audio> element on the first
 *   gesture kicks the audio session into playback mode — the standard
 *   field-tested workaround.
 * - Safari can move the context to "interrupted"/"suspended" on
 *   backgrounding; a visibilitychange listener resumes it.
 */

// 0.1s of silence, 8kHz mono WAV — tiny inline asset for the iOS session kick.
const SILENT_WAV =
  "data:audio/wav;base64,UklGRiQEAABXQVZFZm10IBAAAAABAAEAQB8AAEAfAAABAAgAZGF0YQAEAACAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgIA=";

let ctx: AudioContext | null = null;
let kicked = false;
let visibilityHooked = false;

export function getSharedAudioContext(): AudioContext {
  if (!ctx) {
    ctx = new AudioContext();
    if (!visibilityHooked && typeof document !== "undefined") {
      visibilityHooked = true;
      document.addEventListener("visibilitychange", () => {
        if (document.visibilityState === "visible" && ctx && ctx.state !== "running") {
          ctx.resume().catch(() => {});
        }
      });
    }
  }
  return ctx;
}

export function unlockAudioOnGesture(): void {
  const c = getSharedAudioContext();
  if (c.state !== "running") c.resume().catch(() => {});
  if (!kicked && typeof window !== "undefined") {
    kicked = true;
    try {
      const el = new Audio(SILENT_WAV);
      el.volume = 0;
      void el.play().catch(() => {});
    } catch {
      /* non-fatal — audio kick is best-effort */
    }
  }
}
```

- [ ] **Step 4: Run to verify pass**

Run: `pnpm test:client -- sharedAudio.test.ts`
Expected: PASS.

- [ ] **Step 5: Use the singleton in `Celebration.tsx`**

Find where `Celebration.tsx` constructs its audio context (search `new AudioContext` / `new (window.AudioContext`). Replace construction with `getSharedAudioContext()` (import from `@/lib/sharedAudio`) and delete any `close()` call on it (singletons are never closed). Audio code keeps its existing "failures are silent" guards.

Also add reduced-motion support at the top of the component:

```typescript
  const reducedMotion = typeof window !== "undefined" &&
    window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
```

When `reducedMotion` is true and `level > 0`: skip the canvas particle loop entirely, still play the chime (sound is not motion), and call `onComplete` after 800ms.

- [ ] **Step 6: Unlock on answer clicks in `Gameplay.tsx`**

In `pickOption` (line ~254), first line of the function body:

```typescript
    unlockAudioOnGesture();
```

(import from `@/lib/sharedAudio`.)

- [ ] **Step 7: Celebration fires on results mount; Next Round advances instantly**

In `RoundResults.tsx`:

1. Add a ref near the other state (line ~65): `const celebrationPlayed = useState(() => ({ done: false }))[0];`
   (or `useRef` — match file style, `useRef(false)` preferred:)

```typescript
  const celebrationPlayed = useRef(false);
```

(add `useRef` to the React import.)

2. After the result-loading `useEffect` (line ~92), add:

```typescript
  // Celebration plays when results appear — not on the Next Round click.
  useEffect(() => {
    if (!result || celebrationPlayed.current) return;
    celebrationPlayed.current = true;
    const cnt = result.celebrationCount ?? result.correctCount ?? 0;
    const lvl = (cnt >= 4 ? 3 : cnt >= 3 ? 2 : cnt >= 2 ? 1 : 0) as CelebrationLevel;
    if (lvl > 0) setCelebrationLevel(lvl);
  }, [result]);
```

3. `handleNext` (lines 94-102) becomes a straight advance:

```typescript
  const handleNext = () => {
    advanceRound();
  };
```

4. The `<Celebration>` `onComplete` (lines 177-180) no longer advances:

```tsx
        onComplete={() => setCelebrationLevel(0)}
```

- [ ] **Step 8: Extend the RoundResults test**

Append to `RoundResults.breakdown.test.tsx` (the Celebration mock at the top must capture its props instead of returning null):

Replace the existing Celebration mock with:

```typescript
const celebrationProps = vi.hoisted(() => ({ last: null as { level: number } | null }));
vi.mock("@/components/Celebration", () => ({
  __esModule: true,
  default: (props: { level: number }) => { celebrationProps.last = props; return null; },
}));
```

New tests:

```typescript
  it("celebration level is set on mount for a 4-correct round (no click needed)", () => {
    seedResult({ celebrationCount: 4 });
    render(<RoundResults />);
    expect(celebrationProps.last?.level).toBe(3);
  });

  it("Next Round advances immediately (mutation fires on click)", () => {
    seedResult({ celebrationCount: 0, total: 0, correctCount: 0 });
    render(<RoundResults />);
    fireEvent.click(screen.getByRole("button", { name: /Next Round/i }));
    expect(nextRound.mutate).toHaveBeenCalled();
  });
```

(add `fireEvent` to the testing-library import; `nextRound` is already a hoisted mock.)

- [ ] **Step 9: Run all client tests**

Run: `pnpm test:client`
Expected: PASS.

- [ ] **Step 10: Commit**

```bash
git add client/src/lib/sharedAudio.ts client/src/lib/sharedAudio.test.ts client/src/components/Celebration.tsx client/src/pages/Gameplay.tsx client/src/pages/RoundResults.tsx client/src/pages/RoundResults.breakdown.test.tsx
git commit -m "feat(results): celebration fires on results mount, not on Next Round

Shared AudioContext singleton unlocked during gameplay clicks (D5):
survives SPA navigation, silent-wav session kick for Capacitor iOS,
visibilitychange resume for Safari, reduced-motion skips particles.
Next Round now advances instantly."
```

---

### Task 8: Full verification

- [ ] **Step 1: Full test suite + typecheck**

Run: `pnpm exec tsc --noEmit && pnpm test`
Expected: clean typecheck; all server + client tests PASS. Paste the summary lines into the task report.

- [ ] **Step 2: Manual smoke (desktop browser)**

Run the dev server (`pnpm dev`), play one Low solo game end-to-end:
- All four breakdown rows visible with `earned/max` (Lyric 25, Title 25, Artist 25, Year 50).
- Confetti + chime fire when the results screen appears; Next Round advances with no celebration pause.
- Deliberately answer everything wrong in one round → "Tough Round" copy, no "Round Passed".
- Setup screen shows the new difficulty descriptions.

- [ ] **Step 3: Report**

Summarize: audit-script counts (Task 3), any mock-surface reconciliations (Task 6), any deviations from this plan.

---

## Self-review notes (already applied)

- Spec coverage: scoring both directions (Tasks 1-3), breakdown rows (4), zero-score copy (4), difficulty copy (5), auto-advance (6), celebration + D5 audio (7). ✔
- Engine point values untouched (user decision: copy matches engine). ✔
- ~~`answerMethod` reuses the existing enum field — no schema/DB change anywhere in this plan.~~ **SUPERSEDED during execution:** `answer_method` is a Postgres enum, so Task 2 added value `"mc"` via hand-written migration `drizzle/0018_answer_method_mc.sql` + `scripts/apply-answer-method-mc-migration.mjs`. **Applied to the shared Supabase DB on 2026-06-10** (additive, idempotent) — deploy order is therefore already satisfied. ✔
- Multiplayer (`matchEngine.ts`) is NOT modified; it may adopt `mcMode` later — out of scope per spec. ✔
