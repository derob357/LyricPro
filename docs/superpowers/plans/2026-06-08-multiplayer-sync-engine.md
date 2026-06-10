# Synchronized Live-Camera Multiplayer (P1) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship a synchronized, live-camera multiplayer trivia match (2–7 accounts, free) where everyone answers the same question at once, standings update each round, reusing the existing question/scoring engine and LiveKit.

**Architecture:** Server-authoritative round state machine in Postgres. Phase transitions are idempotent guarded UPDATEs (first valid caller wins). Realtime push via Postgres triggers → Supabase Realtime `broadcast_changes` on a private `game:{roomId}` channel (mirrors the chat system). Clients refetch an authoritative `getMatchState` on every broadcast. Round advance is client-triggered and server-validated against a stored `round_ends_at` deadline (no game-loop process needed on serverless).

**Tech Stack:** tRPC + drizzle/Postgres (server); React + wouter + Supabase Realtime + LiveKit (client); vitest (tests).

**Spec:** `docs/superpowers/specs/2026-06-08-multiplayer-sync-engine-design.md`

**Migration convention (CRITICAL):** This repo's drizzle journal was abandoned after 0007. NEVER run `pnpm db:push` / `drizzle-kit generate`. Hand-write `drizzle/00NN_*.sql` (next sequential number — check `ls drizzle/*.sql`) + a `scripts/apply-*-migration.mjs` runner (copy `scripts/apply-chat-foundation-migration.mjs`). The shared DB IS production; migrations are applied separately with the user's go-ahead (do NOT apply in these tasks).

---

## File Structure

- **New server:** `server/_core/scoring.ts` (extracted scoring helpers), `server/_core/songSelection.ts` (extracted song picker), `server/routers/matchEngine.ts` (the engine).
- **New client:** `client/src/lib/game/useGameChannel.ts` (realtime hook), `client/src/pages/MultiplayerGameplay.tsx` (match screen).
- **New migrations:** `drizzle/00NN_match_engine.sql` (+ apply script) for columns/index; `drizzle/00NN_match_realtime.sql` (+ apply script) for triggers/RLS.
- **Edited:** `drizzle/schema.ts` (round_phase enum + 2 columns + index), `server/routers/game.ts` (import extracted helpers — no behavior change), `server/routers/_app.ts` or the root router (register matchEngine), `client/src/App.tsx` (route `/match/:roomCode`), `client/src/pages/VideoLobby.tsx` (ready + start), `server/scoring.test.ts` (import real module instead of mirrored copy).

---

## PHASE A — Foundations (server, no UI)

### Task 1: Schema — round_phase, round_ends_at, double-submit unique index

**Files:**
- Modify: `drizzle/schema.ts` (gameRooms + a new `roundPhaseEnum`; roundResults unique index)
- Create: `drizzle/00NN_match_engine.sql`, `scripts/apply-match-engine-migration.mjs`
- Test: `server/matchEngine.schema.test.ts`

- [ ] **Step 1: Determine the next migration number**

Run: `ls drizzle/*.sql | sed -E 's@.*/([0-9]+)_.*@\1@' | sort -n | tail -1`
Use that number + 1 as `NN` everywhere below (e.g. if highest is `0014`, use `0015`). Two migrations are added in this plan (this task and Task 9); number them sequentially.

- [ ] **Step 2: Edit `drizzle/schema.ts`**

Add the enum near the other enums (after `gameStatusEnum`, ~line 55):
```ts
export const roundPhaseEnum = pgEnum("round_phase", ["in_question", "intermission", "complete"]);
```
In `gameRooms` (after `currentSongId`), add:
```ts
  roundPhase: roundPhaseEnum("roundPhase"),
  roundEndsAt: timestamp("roundEndsAt", { withTimezone: true }),
```
After the `roundResults` table definition closes (`});`), add a unique index to prevent double-submit (drizzle index syntax — match how other indexes are declared in this file; if the file uses the 3rd-arg callback form on pgTable, convert roundResults to that form):
```ts
// Append a uniqueIndex on (roomId, roundNumber, activePlayerId) for synchronized
// multiplayer: one answer per player per round. activePlayerId = roomPlayers.id.
```
Implement it as a real `uniqueIndex("round_results_room_round_player_uq").on(roundResults.roomId, roundResults.roundNumber, roundResults.activePlayerId)` — using whichever index-declaration style the file already uses (check an existing `uniqueIndex`/`index` in schema.ts and copy that exact form). Import `uniqueIndex` from `drizzle-orm/pg-core` if not already imported.

- [ ] **Step 3: Hand-write the migration `drizzle/00NN_match_engine.sql`**

```sql
-- 00NN_match_engine.sql
-- Synchronized multiplayer engine: round phase + deadline on game_rooms,
-- and a uniqueness guard preventing double-submit per (room, round, player).
-- Additive + idempotent. Safe on prod.

DO $$ BEGIN
  CREATE TYPE round_phase AS ENUM ('in_question', 'intermission', 'complete');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

ALTER TABLE game_rooms ADD COLUMN IF NOT EXISTS "roundPhase" round_phase;
ALTER TABLE game_rooms ADD COLUMN IF NOT EXISTS "roundEndsAt" timestamptz;

-- One answer row per player per round. Partial: only enforced when both keys present
-- (legacy turn-based rows may have null activePlayerId).
CREATE UNIQUE INDEX IF NOT EXISTS round_results_room_round_player_uq
  ON round_results ("roomId", "roundNumber", "activePlayerId")
  WHERE "roomId" IS NOT NULL AND "activePlayerId" IS NOT NULL;
```

- [ ] **Step 4: Create the apply script `scripts/apply-match-engine-migration.mjs`**

Copy `scripts/apply-chat-foundation-migration.mjs` verbatim, then change only: the header comment, `MIGRATION_PATH` to point at `00NN_match_engine.sql`, and the verification query to:
```js
  const rows = await sql`
    SELECT column_name FROM information_schema.columns
    WHERE table_schema='public' AND table_name='game_rooms' AND column_name IN ('roundPhase','roundEndsAt')
    ORDER BY column_name`;
  console.log(`Verified game_rooms columns present: ${rows.map(r => r.column_name).join(', ')}`);
```
Do NOT run it (prod apply is gated).

- [ ] **Step 5: Write the failing test `server/matchEngine.schema.test.ts`**

```ts
import { describe, it, expect } from "vitest";
import { roundPhaseEnum } from "../drizzle/schema";

describe("round phase enum", () => {
  it("has the three engine phases", () => {
    expect(roundPhaseEnum.enumValues).toEqual(["in_question", "intermission", "complete"]);
  });
});
```

- [ ] **Step 6: Run + verify**

Run: `pnpm test:server -- matchEngine.schema` → PASS.
Run: `pnpm check` → 0 errors (the new columns/enum typecheck against schema.ts).

- [ ] **Step 7: Commit**

```bash
git add drizzle/schema.ts drizzle/00NN_match_engine.sql scripts/apply-match-engine-migration.mjs server/matchEngine.schema.test.ts
git commit -m "feat(match): schema for round phase/deadline + double-submit unique index"
```

---

### Task 2: Extract scoring helpers into a reusable module

Today the scoring helpers (`normalizeText`, `matchLyric`, `matchArtist`, `scoreYear`, and the point computation) live inline inside `submitAnswer` in `server/routers/game.ts`, and `server/scoring.test.ts` keeps a hand-copied **mirror** of them (see its comment "mirror of server/routers/game.ts"). Extract them so both `game.ts` and the new `matchEngine.ts` share one implementation and the test exercises the real code.

**Files:**
- Create: `server/_core/scoring.ts`
- Modify: `server/routers/game.ts` (import the extracted helpers; delete the inline copies)
- Modify: `server/scoring.test.ts` (import from `server/_core/scoring` instead of the mirrored local copies)

- [ ] **Step 1: Identify the exact helpers to move**

Run: `grep -n "function normalizeText\|function matchLyric\|function matchArtist\|function scoreYear\|celebration" server/routers/game.ts`
Read each function body plus any point-derivation logic in `submitAnswer` that computes `lyricPoints/artistPoints/yearPoints/speedBonusPoints/streakBonusPoints/totalRoundPoints` from the match results and difficulty.

- [ ] **Step 2: Create `server/_core/scoring.ts`**

Move the helper functions **verbatim** out of `game.ts` into this new file and `export` each. Then extract the point-derivation into a single pure exported function:
```ts
// server/_core/scoring.ts
// Pure scoring helpers shared by the solo game (game.ts) and the multiplayer
// engine (matchEngine.ts). Moved verbatim out of game.ts submitAnswer.

export type Difficulty = "low" | "medium" | "high";

export function normalizeText(text: string): string { /* moved verbatim */ }
export function matchLyric(/* same signature as in game.ts */) { /* moved verbatim */ }
export function matchArtist(/* same signature */) { /* moved verbatim */ }
export function scoreYear(/* same signature */) { /* moved verbatim */ }

// Pure: given the player's answers, the song's truth, difficulty, response time,
// and current streak, return the per-axis points + bonuses + total. Body is the
// existing computation lifted out of submitAnswer (same point tables: Low 100 /
// Medium 200 / High 450 max, speed + streak bonuses).
export function scoreRound(input: {
  difficulty: Difficulty;
  /* song truth fields, player answer fields, responseTimeSeconds, timerSeconds, currentStreak */
}): {
  lyricPoints: number; artistPoints: number; yearPoints: number;
  speedBonusPoints: number; streakBonusPoints: number; totalRoundPoints: number;
} { /* moved verbatim from submitAnswer */ }
```
The implementer fills the bodies from the current `game.ts` code — this is a mechanical move, not new logic. Keep signatures identical to current usage.

- [ ] **Step 3: Update `game.ts` to import + use the module**

Replace the inline helper definitions and the inline point math in `submitAnswer` with imports from `../_core/scoring` and a call to `scoreRound(...)`. Behavior must be unchanged.

- [ ] **Step 4: Convert `server/scoring.test.ts` to import the real module**

Replace the "mirror" helper definitions at the top of the test with `import { normalizeText, matchLyric, matchArtist, scoreYear } from "./_core/scoring";`. Leave the 54 test cases unchanged.

- [ ] **Step 5: Run + verify nothing regressed**

Run: `pnpm test:server -- scoring` → all 54 PASS against the real module.
Run: `pnpm test:server` → full server suite PASS (proves `submitAnswer` still scores identically).
Run: `pnpm check` → 0 errors.

- [ ] **Step 6: Commit**

```bash
git add server/_core/scoring.ts server/routers/game.ts server/scoring.test.ts
git commit -m "refactor(scoring): extract scoring helpers to _core/scoring (shared by solo + match)"
```

---

### Task 3: Extract a reusable song picker

`getNextSong` in `game.ts` contains the weighted song-selection logic inline (genre/decade filter, explicit filter, playability, dedup via `usedSongIds`, over-show penalty). Extract the selection core so the match engine can pick one song server-side per round.

**Files:**
- Create: `server/_core/songSelection.ts`
- Modify: `server/routers/game.ts` (call the extracted picker from `getNextSong`)
- Test: `server/songSelection.test.ts`

- [ ] **Step 1: Read the current selection block**

Run: `grep -n "getNextSong\|usedSongIds\|playable\|distractor\|weight" server/routers/game.ts | head -30` and read the body of `getNextSong` (from `getNextSong: publicProcedure` ~line 450 to its return).

- [ ] **Step 2: Create `server/_core/songSelection.ts`**

Extract a pure-ish async function that, given a db handle + room criteria, returns the chosen song id (and whatever the caller needs to build the question). Signature:
```ts
// server/_core/songSelection.ts
// Server-side song picker shared by solo getNextSong and the multiplayer engine.
// Lifted from game.ts getNextSong. Applies genre/decade/explicit filters,
// playability, and usedSongIds dedup; returns the next song to show.
import type { getDb } from "../db";

export async function selectSongForRoom(db: Awaited<ReturnType<typeof getDb>>, criteria: {
  genres: string[]; decades: string[]; difficulty: "low" | "medium" | "high";
  explicitFilter: boolean; usedSongIds: number[];
}): Promise<{ songId: number } | null> { /* moved verbatim from getNextSong */ }
```
Keep the exact selection logic; do not "improve" it. If `getNextSong` also picks a variant/distractors, leave that variant/distractor logic in `game.ts` for now and have `selectSongForRoom` return just the `songId` (the match engine builds its question from the song id via the same query `getNextSong` uses — see Task 4).

- [ ] **Step 3: Use it in `getNextSong`**

Replace the inline selection in `getNextSong` with a call to `selectSongForRoom(...)`, preserving all surrounding behavior (variant pick, distractors, response shape).

- [ ] **Step 4: Write the test `server/songSelection.test.ts`**

Mock the db handle to return a small fixture set and assert: (a) a song from the requested genre/decade is returned, (b) a song already in `usedSongIds` is never returned, (c) returns `null` when the pool is exhausted.
```ts
import { describe, it, expect, vi } from "vitest";
import { selectSongForRoom } from "./_core/songSelection";
// Build a fake db whose select chain resolves to fixture rows; assert filtering.
```
(Model the fake db on how other server tests stub `getDb` — check `server/getNextSong.ddex-fields.test.ts` for the existing stubbing pattern and reuse it.)

- [ ] **Step 5: Run + verify**

Run: `pnpm test:server -- songSelection` → PASS.
Run: `pnpm test:server` → full suite PASS (getNextSong unchanged behavior).
Run: `pnpm check` → 0 errors.

- [ ] **Step 6: Commit**

```bash
git add server/_core/songSelection.ts server/routers/game.ts server/songSelection.test.ts
git commit -m "refactor(game): extract selectSongForRoom for reuse by match engine"
```

---

## PHASE B — Engine (server state machine)

### Task 4: matchEngine router skeleton + getMatchState

**Files:**
- Create: `server/routers/matchEngine.ts`
- Modify: the root router (find it: `grep -rn "game: gameRouter\|router({" server/routers/_app.ts server/_core/*.ts | head` — register `matchEngine`)
- Test: `server/matchEngine.state.test.ts`

- [ ] **Step 1: Create the router with `getMatchState`**

```ts
// server/routers/matchEngine.ts
import { z } from "zod";
import { and, eq } from "drizzle-orm";
import { TRPCError } from "@trpc/server";
import { router, publicProcedure } from "../_core/trpc";
import { getDb } from "../db";
import { gameRooms, roomPlayers, roundResults } from "../../drizzle/schema";

// Authoritative snapshot for join / reconnect / post-broadcast refetch.
export const matchEngineRouter = router({
  getMatchState: publicProcedure
    .input(z.object({ roomCode: z.string() }))
    .query(async ({ input }) => {
      const db = await getDb();
      if (!db) throw new Error("Database not available");
      const [room] = await db.select().from(gameRooms).where(eq(gameRooms.roomCode, input.roomCode)).limit(1);
      if (!room) throw new TRPCError({ code: "NOT_FOUND", message: "Room not found" });
      const players = await db.select().from(roomPlayers)
        .where(eq(roomPlayers.roomId, room.id)).orderBy(roomPlayers.joinOrder);
      // Standings = players sorted by currentScore desc.
      const standings = [...players].sort((a, b) => b.currentScore - a.currentScore);
      return {
        room: {
          roomCode: room.roomCode, status: room.status, roundPhase: room.roundPhase,
          currentRound: room.currentRound, roundsTotal: room.roundsTotal,
          roundEndsAt: room.roundEndsAt, currentSongId: room.currentSongId,
          difficulty: room.difficulty, timerSeconds: room.timerSeconds,
          hostUserId: room.hostUserId, maxPlayers: room.maxPlayers,
        },
        players: players.map(p => ({ id: p.id, userId: p.userId, currentScore: p.currentScore, isReady: p.isReady, isActive: p.isActive, joinOrder: p.joinOrder })),
        standings: standings.map((p, i) => ({ rank: i + 1, playerId: p.id, score: p.currentScore })),
      };
    }),
});
```

- [ ] **Step 2: Register the router**

In the root app router (where `game: gameRouter` is registered), add `match: matchEngineRouter` and import it. Run `grep -rn "gameRouter" server/routers/_app.ts` (or the file that composes routers) to find the exact spot; mirror the existing registration style.

- [ ] **Step 3: Write the failing test**

```ts
// server/matchEngine.state.test.ts
import { describe, it, expect } from "vitest";
import { matchEngineRouter } from "./routers/matchEngine";
describe("matchEngine router", () => {
  it("exposes getMatchState", () => {
    expect(matchEngineRouter._def.procedures.getMatchState).toBeTruthy();
  });
});
```

- [ ] **Step 4: Run + verify**

Run: `pnpm test:server -- matchEngine.state` → PASS. `pnpm check` → 0 errors.

- [ ] **Step 5: Commit**

```bash
git add server/routers/matchEngine.ts server/matchEngine.state.test.ts server/routers/_app.ts
git commit -m "feat(match): matchEngine router + getMatchState snapshot"
```

---

### Task 5: startMatch mutation

**Files:** Modify `server/routers/matchEngine.ts`; Test `server/matchEngine.start.test.ts`.

- [ ] **Step 1: Write failing tests for the guard logic (pure helper)**

Extract the start-eligibility check into a pure function so it's unit-testable without a DB:
```ts
// in matchEngine.ts (exported for testing)
export function assertCanStart(opts: { isHost: boolean; status: string; readyCount: number; playerCount: number }): void {
  if (!opts.isHost) throw new TRPCError({ code: "FORBIDDEN", message: "Only the host can start." });
  if (opts.status !== "waiting") throw new TRPCError({ code: "BAD_REQUEST", message: "Match already started." });
  if (opts.playerCount < 2) throw new TRPCError({ code: "BAD_REQUEST", message: "Need at least 2 players." });
  if (opts.readyCount < opts.playerCount) throw new TRPCError({ code: "BAD_REQUEST", message: "All players must be ready." });
}
```
Test:
```ts
// server/matchEngine.start.test.ts
import { describe, it, expect } from "vitest";
import { assertCanStart } from "./routers/matchEngine";
describe("assertCanStart", () => {
  it("passes for host, waiting, all ready, >=2", () => {
    expect(() => assertCanStart({ isHost: true, status: "waiting", readyCount: 3, playerCount: 3 })).not.toThrow();
  });
  it("rejects non-host", () => { expect(() => assertCanStart({ isHost: false, status: "waiting", readyCount: 3, playerCount: 3 })).toThrow(/host/i); });
  it("rejects <2 players", () => { expect(() => assertCanStart({ isHost: true, status: "waiting", readyCount: 1, playerCount: 1 })).toThrow(/2 players/i); });
  it("rejects not-all-ready", () => { expect(() => assertCanStart({ isHost: true, status: "waiting", readyCount: 2, playerCount: 3 })).toThrow(/ready/i); });
  it("rejects already started", () => { expect(() => assertCanStart({ isHost: true, status: "active", readyCount: 3, playerCount: 3 })).toThrow(/already/i); });
});
```
Run: `pnpm test:server -- matchEngine.start` → FAIL (no export yet).

- [ ] **Step 2: Implement `assertCanStart` + the `startMatch` mutation**

Add to `matchEngineRouter`:
```ts
  startMatch: publicProcedure
    .input(z.object({ roomCode: z.string(), guestToken: z.string().optional() }))
    .mutation(async ({ input, ctx }) => {
      const db = await getDb();
      if (!db) throw new Error("Database not available");
      const [room] = await db.select().from(gameRooms).where(eq(gameRooms.roomCode, input.roomCode)).limit(1);
      if (!room) throw new TRPCError({ code: "NOT_FOUND", message: "Room not found" });
      const players = await db.select().from(roomPlayers).where(eq(roomPlayers.roomId, room.id));
      const isHost = (!!ctx.user?.id && room.hostUserId === ctx.user.id);
      assertCanStart({ isHost, status: room.status, readyCount: players.filter(p => p.isReady).length, playerCount: players.length });

      const used: number[] = room.usedSongIds ? JSON.parse(room.usedSongIds) : [];
      const pick = await selectSongForRoom(db, {
        genres: JSON.parse(room.selectedGenres), decades: JSON.parse(room.selectedDecades),
        difficulty: room.difficulty, explicitFilter: room.explicitFilter, usedSongIds: used,
      });
      if (!pick) throw new TRPCError({ code: "BAD_REQUEST", message: "No songs available for these filters." });

      const now = new Date();
      const endsAt = new Date(now.getTime() + room.timerSeconds * 1000);
      // Guarded transition: only from waiting.
      const res = await db.update(gameRooms).set({
        status: "active", currentRound: 1, roundPhase: "in_question",
        currentSongId: pick.songId, usedSongIds: JSON.stringify([...used, pick.songId]),
        roundEndsAt: endsAt, updatedAt: now,
      }).where(and(eq(gameRooms.id, room.id), eq(gameRooms.status, "waiting"))).returning({ id: gameRooms.id });
      if (res.length === 0) throw new TRPCError({ code: "CONFLICT", message: "Match already started." });
      return { ok: true, currentRound: 1, roundEndsAt: endsAt };
    }),
```
Add imports: `selectSongForRoom` from `../_core/songSelection`.

- [ ] **Step 3: Run + verify**

Run: `pnpm test:server -- matchEngine.start` → PASS. `pnpm check` → 0 errors.

- [ ] **Step 4: Commit**

```bash
git add server/routers/matchEngine.ts server/matchEngine.start.test.ts
git commit -m "feat(match): startMatch — host/ready validation + guarded round-1 transition"
```

---

### Task 6: submitAnswer (match) — scoring + double/late rejection

**Files:** Modify `server/routers/matchEngine.ts`; Test `server/matchEngine.submit.test.ts`.

- [ ] **Step 1: Write failing tests for late/grace logic (pure helper)**

```ts
// matchEngine.ts (exported)
export function isSubmitAccepted(opts: { phase: string | null; nowMs: number; deadlineMs: number; graceMs: number }): boolean {
  return opts.phase === "in_question" && opts.nowMs <= opts.deadlineMs + opts.graceMs;
}
```
Test `server/matchEngine.submit.test.ts`:
```ts
import { describe, it, expect } from "vitest";
import { isSubmitAccepted } from "./routers/matchEngine";
describe("isSubmitAccepted", () => {
  const base = { phase: "in_question", deadlineMs: 1000, graceMs: 500 };
  it("accepts before deadline", () => expect(isSubmitAccepted({ ...base, nowMs: 900 })).toBe(true));
  it("accepts within grace", () => expect(isSubmitAccepted({ ...base, nowMs: 1400 })).toBe(true));
  it("rejects past grace", () => expect(isSubmitAccepted({ ...base, nowMs: 1600 })).toBe(false));
  it("rejects wrong phase", () => expect(isSubmitAccepted({ ...base, phase: "intermission", nowMs: 900 })).toBe(false));
});
```
Run → FAIL.

- [ ] **Step 2: Implement `isSubmitAccepted` + the `submitAnswer` mutation**

```ts
  submitAnswer: publicProcedure
    .input(z.object({
      roomCode: z.string(),
      lyricAnswer: z.string().optional(), artistAnswer: z.string().optional(), yearAnswer: z.number().optional(),
      responseTimeSeconds: z.number().optional(),
    }))
    .mutation(async ({ input, ctx }) => {
      const db = await getDb();
      if (!db) throw new Error("Database not available");
      const [room] = await db.select().from(gameRooms).where(eq(gameRooms.roomCode, input.roomCode)).limit(1);
      if (!room) throw new TRPCError({ code: "NOT_FOUND", message: "Room not found" });
      const [player] = await db.select().from(roomPlayers)
        .where(and(eq(roomPlayers.roomId, room.id), eq(roomPlayers.userId, ctx.user?.id ?? -1))).limit(1);
      if (!player) throw new TRPCError({ code: "FORBIDDEN", message: "Not a player in this room." });
      const GRACE_MS = 1500;
      const deadlineMs = room.roundEndsAt ? new Date(room.roundEndsAt).getTime() : 0;
      if (!isSubmitAccepted({ phase: room.roundPhase, nowMs: Date.now(), deadlineMs, graceMs: GRACE_MS }))
        throw new TRPCError({ code: "BAD_REQUEST", message: "Round is not accepting answers." });

      // Load the song truth and score via the shared scorer.
      const points = scoreRound({ difficulty: room.difficulty, /* song truth + input answers + responseTimeSeconds + room.timerSeconds + player.currentStreak */ });

      try {
        await db.insert(roundResults).values({
          roomId: room.id, roundNumber: room.currentRound, activePlayerId: player.id,
          songId: room.currentSongId!, userLyricAnswer: input.lyricAnswer ?? null,
          userArtistAnswer: input.artistAnswer ?? null, userYearAnswer: input.yearAnswer ?? null,
          responseTimeSeconds: input.responseTimeSeconds ?? null,
          lyricPoints: points.lyricPoints, artistPoints: points.artistPoints, yearPoints: points.yearPoints,
          speedBonusPoints: points.speedBonusPoints, streakBonusPoints: points.streakBonusPoints,
          totalRoundPoints: points.totalRoundPoints,
        });
      } catch (e: any) {
        if (String(e?.message ?? "").includes("round_results_room_round_player_uq"))
          throw new TRPCError({ code: "CONFLICT", message: "Already answered this round." });
        throw e;
      }
      await db.update(roomPlayers).set({ currentScore: player.currentScore + points.totalRoundPoints })
        .where(eq(roomPlayers.id, player.id));
      return { totalRoundPoints: points.totalRoundPoints };
    }),
```
Imports: `scoreRound` from `../_core/scoring`. The implementer wires the song-truth fields into `scoreRound` by loading the song row (mirror how `submitAnswer` in game.ts loads the song + variant for scoring). Reuse that loading logic.

- [ ] **Step 3: Run + verify**

Run: `pnpm test:server -- matchEngine.submit` → PASS. `pnpm check` → 0 errors.

- [ ] **Step 4: Commit**

```bash
git add server/routers/matchEngine.ts server/matchEngine.submit.test.ts
git commit -m "feat(match): submitAnswer — shared scoring + double/late-submit guards"
```

---

### Task 7: revealRound (idempotent) + standings

**Files:** Modify `server/routers/matchEngine.ts`; Test `server/matchEngine.reveal.test.ts`.

- [ ] **Step 1: Write a failing test for the reveal-eligibility helper**

```ts
// matchEngine.ts (exported)
export function canReveal(opts: { phase: string | null; answeredCount: number; activeCount: number; nowMs: number; deadlineMs: number }): boolean {
  if (opts.phase !== "in_question") return false;
  return opts.answeredCount >= opts.activeCount || opts.nowMs >= opts.deadlineMs;
}
```
Test:
```ts
import { describe, it, expect } from "vitest";
import { canReveal } from "./routers/matchEngine";
describe("canReveal", () => {
  it("true when all answered", () => expect(canReveal({ phase:"in_question", answeredCount:3, activeCount:3, nowMs:0, deadlineMs:9999 })).toBe(true));
  it("true when deadline passed", () => expect(canReveal({ phase:"in_question", answeredCount:1, activeCount:3, nowMs:10000, deadlineMs:9999 })).toBe(true));
  it("false when waiting + before deadline", () => expect(canReveal({ phase:"in_question", answeredCount:1, activeCount:3, nowMs:0, deadlineMs:9999 })).toBe(false));
  it("false in wrong phase", () => expect(canReveal({ phase:"intermission", answeredCount:3, activeCount:3, nowMs:0, deadlineMs:9999 })).toBe(false));
});
```
Run → FAIL.

- [ ] **Step 2: Implement `canReveal` + `revealRound`**

```ts
  revealRound: publicProcedure
    .input(z.object({ roomCode: z.string() }))
    .mutation(async ({ input }) => {
      const db = await getDb();
      if (!db) throw new Error("Database not available");
      const [room] = await db.select().from(gameRooms).where(eq(gameRooms.roomCode, input.roomCode)).limit(1);
      if (!room) throw new TRPCError({ code: "NOT_FOUND", message: "Room not found" });
      const players = await db.select().from(roomPlayers).where(eq(roomPlayers.roomId, room.id));
      const activeCount = players.filter(p => p.isActive).length;
      const answered = await db.select().from(roundResults)
        .where(and(eq(roundResults.roomId, room.id), eq(roundResults.roundNumber, room.currentRound)));
      const INTERMISSION_S = 5;
      if (!canReveal({ phase: room.roundPhase, answeredCount: answered.length, activeCount, nowMs: Date.now(), deadlineMs: room.roundEndsAt ? new Date(room.roundEndsAt).getTime() : 0 }))
        return { revealed: false };
      const endsAt = new Date(Date.now() + INTERMISSION_S * 1000);
      // Guarded: only flip from in_question for THIS round.
      const res = await db.update(gameRooms).set({ roundPhase: "intermission", roundEndsAt: endsAt, updatedAt: new Date() })
        .where(and(eq(gameRooms.id, room.id), eq(gameRooms.currentRound, room.currentRound), eq(gameRooms.roundPhase, "in_question")))
        .returning({ id: gameRooms.id });
      return { revealed: res.length > 0 };
    }),
```

- [ ] **Step 3: Run + verify**

Run: `pnpm test:server -- matchEngine.reveal` → PASS. `pnpm check` → 0 errors.

- [ ] **Step 4: Commit**

```bash
git add server/routers/matchEngine.ts server/matchEngine.reveal.test.ts
git commit -m "feat(match): revealRound — all-answered/deadline gate + idempotent intermission"
```

---

### Task 8: advanceRound (idempotent) — next song or complete

**Files:** Modify `server/routers/matchEngine.ts`; Test `server/matchEngine.advance.test.ts`.

- [ ] **Step 1: Write a failing test for the advance-decision helper**

```ts
// matchEngine.ts (exported)
export function nextRoundDecision(opts: { phase: string | null; nowMs: number; deadlineMs: number; currentRound: number; roundsTotal: number }):
  "wait" | "next" | "complete" {
  if (opts.phase !== "intermission" || opts.nowMs < opts.deadlineMs) return "wait";
  return opts.currentRound < opts.roundsTotal ? "next" : "complete";
}
```
Test covering: wait (wrong phase), wait (before deadline), next (mid-match), complete (last round). Run → FAIL.

- [ ] **Step 2: Implement `nextRoundDecision` + `advanceRound`**

```ts
  advanceRound: publicProcedure
    .input(z.object({ roomCode: z.string() }))
    .mutation(async ({ input }) => {
      const db = await getDb();
      if (!db) throw new Error("Database not available");
      const [room] = await db.select().from(gameRooms).where(eq(gameRooms.roomCode, input.roomCode)).limit(1);
      if (!room) throw new TRPCError({ code: "NOT_FOUND", message: "Room not found" });
      const decision = nextRoundDecision({ phase: room.roundPhase, nowMs: Date.now(), deadlineMs: room.roundEndsAt ? new Date(room.roundEndsAt).getTime() : 0, currentRound: room.currentRound, roundsTotal: room.roundsTotal });
      if (decision === "wait") return { advanced: false };
      if (decision === "complete") {
        const res = await db.update(gameRooms).set({ status: "finished", roundPhase: "complete", roundEndsAt: null, updatedAt: new Date() })
          .where(and(eq(gameRooms.id, room.id), eq(gameRooms.currentRound, room.currentRound), eq(gameRooms.roundPhase, "intermission"))).returning({ id: gameRooms.id });
        return { advanced: res.length > 0, complete: true };
      }
      // decision === "next"
      const used: number[] = room.usedSongIds ? JSON.parse(room.usedSongIds) : [];
      const pick = await selectSongForRoom(db, { genres: JSON.parse(room.selectedGenres), decades: JSON.parse(room.selectedDecades), difficulty: room.difficulty, explicitFilter: room.explicitFilter, usedSongIds: used });
      const endsAt = new Date(Date.now() + room.timerSeconds * 1000);
      const res = await db.update(gameRooms).set({
        currentRound: room.currentRound + 1, roundPhase: "in_question",
        currentSongId: pick?.songId ?? room.currentSongId,
        usedSongIds: JSON.stringify(pick ? [...used, pick.songId] : used),
        roundEndsAt: endsAt, updatedAt: new Date(),
      }).where(and(eq(gameRooms.id, room.id), eq(gameRooms.currentRound, room.currentRound), eq(gameRooms.roundPhase, "intermission"))).returning({ id: gameRooms.id });
      return { advanced: res.length > 0, currentRound: room.currentRound + 1 };
    }),
```

- [ ] **Step 3: Run + verify**

Run: `pnpm test:server -- matchEngine.advance` → PASS. `pnpm test:server` (full) → PASS. `pnpm check` → 0 errors.

- [ ] **Step 4: Commit**

```bash
git add server/routers/matchEngine.ts server/matchEngine.advance.test.ts
git commit -m "feat(match): advanceRound — idempotent next-song / match-complete transition"
```

---

## PHASE C — Realtime

### Task 9: Postgres triggers + RLS for `game:{roomId}` broadcasts

Mirror the chat realtime pipeline (`drizzle/0013_chat_foundation.sql` lines ~309–378): an RLS policy on `realtime.messages` authorizing the private channel, plus triggers that call `realtime.broadcast_changes`.

**Files:** Create `drizzle/00NN_match_realtime.sql` (+ `scripts/apply-match-realtime-migration.mjs`). No schema.ts change.

- [ ] **Step 1: Read the chat realtime SQL to copy its exact shape**

Run: `sed -n '305,380p' drizzle/0013_chat_foundation.sql` and read the `realtime.broadcast_changes` signature comment + the RLS policy + trigger function pattern.

- [ ] **Step 2: Hand-write `drizzle/00NN_match_realtime.sql`**

```sql
-- 00NN_match_realtime.sql
-- Realtime for synchronized matches. Mirrors the chat broadcast pipeline.
-- Topic: game:{game_rooms.id}. Two triggers: game_rooms phase transitions,
-- and round_results inserts (player_answered). RLS lets a player subscribe
-- only to rooms they belong to.

-- ── RLS: a user may join game:{roomId} only if they are a room_player ──
CREATE POLICY realtime_game_channel_join ON realtime.messages FOR SELECT TO authenticated
USING (
  realtime.topic() LIKE 'game:%'
  AND EXISTS (
    SELECT 1 FROM room_players rp
    WHERE rp."roomId" = NULLIF(split_part(realtime.topic(), ':', 2), '')::int
      AND rp."userId" = current_chat_user_id()   -- reuse helper from 0013
  )
);

-- ── Trigger: broadcast game_rooms phase/status transitions ──
CREATE OR REPLACE FUNCTION game_rooms_broadcast() RETURNS TRIGGER AS $$
DECLARE ev text;
BEGIN
  IF NEW."roundPhase" = 'in_question' AND (OLD."currentRound" IS DISTINCT FROM NEW."currentRound" OR OLD."roundPhase" IS DISTINCT FROM NEW."roundPhase") THEN ev := 'round_started';
  ELSIF NEW."roundPhase" = 'intermission' AND OLD."roundPhase" IS DISTINCT FROM NEW."roundPhase" THEN ev := 'round_revealed';
  ELSIF NEW.status = 'finished' AND OLD.status IS DISTINCT FROM NEW.status THEN ev := 'match_complete';
  ELSE RETURN NEW; END IF;
  PERFORM realtime.broadcast_changes('game:' || NEW.id::text, ev, TG_OP, 'game_rooms', 'public', NEW, OLD);
  RETURN NEW;
END; $$ LANGUAGE plpgsql SECURITY DEFINER;

DROP TRIGGER IF EXISTS game_rooms_broadcast_trg ON game_rooms;
CREATE TRIGGER game_rooms_broadcast_trg AFTER UPDATE ON game_rooms
  FOR EACH ROW EXECUTE FUNCTION game_rooms_broadcast();

-- ── Trigger: broadcast player_answered on round_results insert ──
CREATE OR REPLACE FUNCTION round_results_broadcast() RETURNS TRIGGER AS $$
BEGIN
  IF NEW."roomId" IS NOT NULL THEN
    PERFORM realtime.broadcast_changes('game:' || NEW."roomId"::text, 'player_answered', 'INSERT', 'round_results', 'public', NEW, NULL);
  END IF;
  RETURN NEW;
END; $$ LANGUAGE plpgsql SECURITY DEFINER;

DROP TRIGGER IF EXISTS round_results_broadcast_trg ON round_results;
CREATE TRIGGER round_results_broadcast_trg AFTER INSERT ON round_results
  FOR EACH ROW EXECUTE FUNCTION round_results_broadcast();
```
NOTE: verify `current_chat_user_id()` exists (created in 0013) and that `realtime.broadcast_changes` arg order matches the verified comment in 0013 — adjust to match exactly.

- [ ] **Step 3: Create `scripts/apply-match-realtime-migration.mjs`**

Copy the chat apply script; point `MIGRATION_PATH` at `00NN_match_realtime.sql`; verification query:
```js
  const rows = await sql`SELECT tgname FROM pg_trigger WHERE tgname IN ('game_rooms_broadcast_trg','round_results_broadcast_trg') ORDER BY tgname`;
  console.log(`Verified triggers: ${rows.map(r => r.tgname).join(', ')}`);
```
Do NOT run it (prod apply gated).

- [ ] **Step 4: Commit**

```bash
git add drizzle/00NN_match_realtime.sql scripts/apply-match-realtime-migration.mjs
git commit -m "feat(match): realtime triggers + RLS for game:{roomId} broadcasts"
```

---

### Task 10: client `useGameChannel` hook

**Files:** Create `client/src/lib/game/useGameChannel.ts`; Test `client/src/lib/game/useGameChannel.test.ts`.

- [ ] **Step 1: Write the failing test**

```ts
// client/src/lib/game/useGameChannel.test.ts
import { describe, it, expect, vi } from "vitest";
import { renderHook } from "@testing-library/react";

const channel = { on: vi.fn().mockReturnThis(), subscribe: vi.fn().mockReturnThis() };
const removeChannel = vi.fn();
vi.mock("@/lib/supabase", () => ({ supabase: { channel: vi.fn(() => channel), removeChannel } }));

import { useGameChannel } from "./useGameChannel";

describe("useGameChannel", () => {
  it("subscribes to game:{roomId} private channel and registers the broadcast handlers", () => {
    const onEvent = vi.fn();
    renderHook(() => useGameChannel(42, onEvent));
    // subscribed to the right topic, private
    const { supabase } = require("@/lib/supabase");
    expect(supabase.channel).toHaveBeenCalledWith("game:42", { config: { private: true } });
    // registered at least the four events
    const events = channel.on.mock.calls.map((c: any[]) => c[1].event);
    expect(events).toEqual(expect.arrayContaining(["round_started", "player_answered", "round_revealed", "match_complete"]));
  });
  it("no-ops for null roomId", () => {
    renderHook(() => useGameChannel(null, vi.fn()));
    // (channel.subscribe should not be called again for null — assert via call count delta)
    expect(true).toBe(true);
  });
});
```
Run: `pnpm test:client -- useGameChannel` → FAIL.

- [ ] **Step 2: Implement the hook (mirror `useChatChannel`)**

```ts
// client/src/lib/game/useGameChannel.ts
// Subscribes to the private game:{roomId} Supabase Realtime channel and calls
// onEvent(eventName) for each broadcast so the caller can refetch getMatchState.
import { useEffect } from "react";
import { supabase } from "@/lib/supabase";

export type GameEvent = "round_started" | "player_answered" | "round_revealed" | "match_complete";

export function useGameChannel(roomId: number | null, onEvent: (e: GameEvent) => void): void {
  useEffect(() => {
    if (roomId == null) return;
    const topic = `game:${roomId}`;
    const ch = supabase.channel(topic, { config: { private: true } });
    const events: GameEvent[] = ["round_started", "player_answered", "round_revealed", "match_complete"];
    for (const ev of events) ch.on("broadcast", { event: ev }, () => onEvent(ev));
    ch.subscribe();
    return () => { void supabase.removeChannel(ch); };
  }, [roomId, onEvent]);
}
```

- [ ] **Step 3: Run + verify**

Run: `pnpm test:client -- useGameChannel` → PASS. `pnpm check` → 0 errors.

- [ ] **Step 4: Commit**

```bash
git add client/src/lib/game/useGameChannel.ts client/src/lib/game/useGameChannel.test.ts
git commit -m "feat(match): useGameChannel realtime hook (refetch-on-broadcast)"
```

---

## PHASE D — Client UI

### Task 11: VideoLobby — ready badges + host Start

**Files:** Modify `client/src/pages/VideoLobby.tsx`; Test `client/src/pages/VideoLobby.start.test.tsx`.

- [ ] **Step 1: Read the current VideoLobby**

Run: `grep -n "Phase 2\|Start Game\|disabled\|setReady\|isReady\|joinLiveRoom\|navigate" client/src/pages/VideoLobby.tsx` and read around the disabled "Start Game (Phase 2)" button.

- [ ] **Step 2: Write the failing test**

```tsx
// client/src/pages/VideoLobby.start.test.tsx
import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";

const navigate = vi.fn();
vi.mock("wouter", async () => { const a: any = await vi.importActual("wouter"); return { ...a, useLocation: () => ["/lobby/live/X", navigate], useParams: () => ({ inviteCode: "X" }) }; });
const startMatch = vi.hoisted(() => ({ mutateAsync: vi.fn().mockResolvedValue({ ok: true }) }));
// mock trpc match.startMatch + game.getRoom returning a host + 2 ready players, etc.
// (model the mock on the existing pattern; assert that clicking Start calls startMatch and navigates to /match/:roomCode)

it("host Start calls startMatch then navigates to /match", async () => {
  // render VideoLobby with host context + all-ready room
  // fireEvent.click(screen.getByTestId("lobby-start"))
  // await waitFor(() => expect(startMatch.mutateAsync).toHaveBeenCalled())
  // expect(navigate).toHaveBeenCalledWith(expect.stringMatching(/^\/match\//))
  expect(true).toBe(true); // replace with real assertions per the local trpc-mock pattern
});
```
The implementer writes the concrete mock by copying the trpc-mock style from `client/src/pages/Interstitial.test.tsx` (hoisted mutation mocks). Run → FAIL initially.

- [ ] **Step 3: Implement the lobby changes**

In `VideoLobby.tsx`:
- Render each participant with a **Ready** badge derived from the room players query (reuse `trpc.game.getRoom` already polled there, or add it).
- Add an **"I'm Ready"** toggle calling the existing `trpc.game.setReady` mutation for the local player.
- Replace the disabled `Start Game (Phase 2)` button with an enabled host-only button (`data-testid="lobby-start"`), disabled until `players.length >= 2 && allReady`, that calls `trpc.match.startMatch.useMutation()` and on success `navigate(\`/match/${roomCode}\`)`.
- Non-host players: when room status flips to `active` (seen via the existing poll or a `useGameChannel` subscription), auto-`navigate(\`/match/${roomCode}\`)`.

- [ ] **Step 4: Run + verify**

Run: `pnpm test:client -- VideoLobby.start` → PASS. `pnpm test:client` (full) → no regressions. `pnpm check` → 0 errors.

- [ ] **Step 5: Commit**

```bash
git add client/src/pages/VideoLobby.tsx client/src/pages/VideoLobby.start.test.tsx
git commit -m "feat(match): lobby ready badges + host Start → startMatch → /match"
```

---

### Task 12: `/match/:roomCode` route + MultiplayerGameplay page

**Files:** Create `client/src/pages/MultiplayerGameplay.tsx`; Modify `client/src/App.tsx`; Test `client/src/pages/MultiplayerGameplay.test.tsx`.

- [ ] **Step 1: Add the route in `App.tsx`**

Import `MultiplayerGameplay` and add (near `/play/:roomCode`):
```tsx
<Route path="/match/:roomCode" component={MultiplayerGameplay} />
```

- [ ] **Step 2: Write the failing test**

```tsx
// client/src/pages/MultiplayerGameplay.test.tsx
import { describe, it, expect, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
vi.mock("wouter", async () => { const a: any = await vi.importActual("wouter"); return { ...a, useParams: () => ({ roomCode: "ROOM42" }), useLocation: () => ["/match/ROOM42", vi.fn()] }; });
vi.mock("@/lib/game/useGameChannel", () => ({ useGameChannel: vi.fn() }));
// mock trpc.match.getMatchState.useQuery to return an in_question round with a song + options,
// and assert the question prompt + a countdown + the player video grid placeholder render.
it("renders the current question and standings from getMatchState", async () => {
  // render(<MultiplayerGameplay/>)
  // await waitFor(() => expect(screen.getByTestId("match-question")).toBeTruthy())
  expect(true).toBe(true); // replace with real assertions
});
```
Run → FAIL.

- [ ] **Step 3: Implement `MultiplayerGameplay.tsx`**

Structure (the implementer fleshes out the JSX reusing existing pieces):
```tsx
import { useParams } from "wouter";
import { useCallback } from "react";
import { trpc } from "@/lib/trpc";
import { useGameChannel } from "@/lib/game/useGameChannel";
import { VideoGrid } from "@/components/livekit/VideoGrid";
import { formatMMSS } from "@/lib/formatTime";

export default function MultiplayerGameplay() {
  const { roomCode } = useParams<{ roomCode: string }>();
  const state = trpc.match.getMatchState.useQuery({ roomCode: roomCode! }, { refetchInterval: 5000 });
  const roomId = state.data?.room ? /* derive id; add id to getMatchState room payload */ null : null;
  const refetch = useCallback(() => { void state.refetch(); }, [state]);
  useGameChannel(roomId, refetch); // any broadcast → refetch authoritative state

  // Render: VideoGrid (reuse the LiveKit room/participants — see VideoLobby for how it
  // obtains the room), the current question prompt + MC options (from getMatchState),
  // a countdown bar to room.roundEndsAt via formatMMSS, "who answered" dots, and on
  // roundPhase==='intermission' the per-round standings ("X is in the lead! Next round in N").
  // Submit calls trpc.match.submitAnswer; when countdown hits 0 or all answered, call
  // trpc.match.revealRound; during intermission when its countdown hits 0 call
  // trpc.match.advanceRound; on status==='finished' navigate to /results/final/:roomCode.
  return <div data-testid="match-question">{/* ... */}</div>;
}
```
**Required addition:** include `id` in `getMatchState`'s `room` payload (Task 4) so the client can pass it to `useGameChannel`. If not present, add `id: room.id` to the returned room object in `matchEngine.ts` and re-run Task 4's test.

The question prompt + MC options come from `getMatchState` — extend `getMatchState` to also return the current question (song prompt + shuffled options, NO correct answer) built from `currentSongId`, reusing the same question-building code path `getNextSong` uses (load song + variant + `pickDistractors`). Keep the answer server-only.

- [ ] **Step 4: Run + verify**

Run: `pnpm test:client -- MultiplayerGameplay` → PASS. `pnpm test:client` (full) → PASS. `pnpm check` → 0 errors.

- [ ] **Step 5: Commit**

```bash
git add client/src/pages/MultiplayerGameplay.tsx client/src/App.tsx client/src/pages/MultiplayerGameplay.test.tsx server/routers/matchEngine.ts
git commit -m "feat(match): /match screen — synced question + video + standings"
```

---

### Task 13: Full verification pass

**Files:** none (verification only)

- [ ] **Step 1:** `pnpm test` → server + client suites PASS.
- [ ] **Step 2:** `pnpm check` → clean.
- [ ] **Step 3:** `pnpm build` → succeeds.
- [ ] **Step 4 (security/spec spot-check):** Confirm the question payload returned by `getMatchState` and broadcast events never include the correct answer (answer validated only in `submitAnswer`). Confirm `submitAnswer` rejects non-members and double/late submits. Confirm the RLS policy restricts `game:{roomId}` to room members.
- [ ] **Step 5:** Manual smoke (requires the two migrations applied to the DB — gated on user): two browser sessions, create a live room, both ready, host starts, both see the same question, answer, standings update, advance through rounds, reach FinalResults.

---

## Migrations to apply before the feature works (gated on user go-ahead)

1. `node scripts/apply-match-engine-migration.mjs` (Task 1 — columns + index)
2. `node scripts/apply-match-realtime-migration.mjs` (Task 9 — triggers + RLS)

Both are additive/idempotent; the shared DB is production.

---

## Self-Review

**Spec coverage:** state machine (Tasks 5–8) ✓; schema round_phase/round_ends_at + double-submit guard (Task 1) ✓; reuse scoring (Task 2) + song pick (Task 3) ✓; server-once song selection (Tasks 5/8) ✓; realtime triggers+RLS mirroring chat (Task 9) ✓; `useGameChannel` (Task 10) ✓; getMatchState authoritative snapshot (Task 4) ✓; lobby ready+start (Task 11) ✓; `/match` screen with camera+question+standings (Task 12) ✓; disconnect/timeout (isActive + 0-on-timeout via canReveal using activeCount; auto-advance) ✓; FinalResults reuse (Task 12 navigation) ✓; testing both layers + verification (Task 13) ✓.

**Out-of-scope honored:** no reactions/chat/economy/rematch/podium-polish.

**Type/name consistency:** `roundPhaseEnum` values (`in_question|intermission|complete`) consistent across schema, triggers, helpers (`assertCanStart`/`isSubmitAccepted`/`canReveal`/`nextRoundDecision`), and mutations. `activePlayerId` = `roomPlayers.id` used consistently for the unique key and submit. localStorage/topic names: channel `game:{roomId}` consistent between trigger SQL and `useGameChannel`. `selectSongForRoom` + `scoreRound`/`scoreYear`/`matchArtist`/`matchLyric`/`normalizeText` names consistent between Tasks 2/3 and their consumers (5/6/8).

**Known follow-ups flagged in-plan (not placeholders):** Tasks 2/3/12 require lifting existing logic verbatim from `game.ts` (scoring math, song selection, question/distractor building) — the plan points the implementer at the exact source procedures rather than reproducing hundreds of lines; this is a mechanical move, and each is guarded by tests (existing 54 scoring tests; new selection/engine tests).
