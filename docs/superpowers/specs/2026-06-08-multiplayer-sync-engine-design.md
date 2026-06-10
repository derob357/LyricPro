# Synchronized Live-Camera Multiplayer (P1) — Design Spec

**Date:** 2026-06-08
**Project:** LyricPro Ai
**Status:** Approved (design) — pending implementation plan
**Source mockups:** "Multiplayer Mode with Camera" + "Play Together. Compete Live." (provided by user 2026-06-08)

## Context & decomposition

The multiplayer-rooms vision is large. It is decomposed into sequential sub-projects, each with its own spec → plan → build cycle:

- **P1 (this spec): Synchronized round engine + realtime + live camera.** The core; everything else hangs off it.
- **P2 — Match feel:** stepped podium, per-round standings polish, live reactions, per-match chat.
- **P3 — (folded into P1):** live camera is included in P1 per the scope decision.
- **P4 — Economy:** Golden-Notes (no cash-out) entry → pool → auto payout-by-placement + payout screen.
- **P5 — Post-game:** rematch / post-game lobby / new-players.

P1 only is specified here.

## Locked decisions

| # | Decision |
|---|----------|
| 1 | **Simultaneous multiplayer** — everyone answers the SAME question at the same time. Not the old turn-based / "Team Mode" (those stay disabled/out of scope). |
| 2 | **v1 includes live camera** (LiveKit). Built on the existing `remote_live` path; completes the VideoLobby "Phase 2" dead-end. |
| 3 | **Accounts only** — no guest players in multiplayer. |
| 4 | **Free in P1** — no entry fee/prizes. Economy is P4, and will be **Golden Notes with no cash-out** when it lands. |
| 5 | **Reuse the existing question + scoring engine** (Low/Med/High; MC title/artist/year, fill-the-lyric on High; existing point system + speed/streak bonuses), run synchronously. No new scoring model. |
| 6 | **Architecture A:** server-authoritative state in Postgres + Supabase Realtime broadcast for push + deadline-based, client-triggered/server-validated, idempotent round advance. No new infra. |
| 7 | **2–7 players** per match (infra supports 8; cap at 7 to match the mockups). |
| 8 | **No reactions, no per-match chat in P1** (both are P2), even though the camera mockup shows them. |
| 9 | **New route `/match/:roomCode`** + a dedicated `MultiplayerGameplay` page — the solo `/play` loop is left untouched. |
| 10 | **Multiplayer participation counts against existing daily game limits** (consistent with solo). |

## Architecture — server-authoritative round state machine

Server owns all authoritative state in Postgres. Supabase Realtime broadcasts a "something changed" event (with render payload) on a per-match channel. Clients render from the event and run a **local countdown to a server-set deadline** (`round_ends_at`). Every phase transition is an **idempotent, guarded** mutation: a conditional `UPDATE ... WHERE current_round = X AND round_phase = Y` inside a transaction; the first valid caller flips the phase (rowcount = 1) and emits the broadcast, all later/concurrent callers see rowcount = 0 and no-op. This solves both concurrency and "serverless has no persistent game loop" — round advance is triggered by whichever client's countdown expires (or by the all-answered condition), and the server validates it against the stored deadline.

```
LOBBY ──startMatch(host)──▶ IN_QUESTION ──(all answered OR now≥round_ends_at)──▶ REVEAL/INTERMISSION
  ▲                              │                                                     │
  │                        submitAnswer                                          (now≥intermission
  │                        (per player)                                            deadline)
  │                                                                                    │
  └───────────────── advanceRound: current_round < total? ◀───────────────────────────┘
                              │ no
                              ▼
                            COMPLETE ──▶ existing multi-player FinalResults
```

**Song selection** happens **once per round, server-side**, at each transition into `IN_QUESTION` (`startMatch` and `advanceRound`), reusing the existing `getNextSong` weighted-pick logic. It writes `current_song_id` and appends `used_song_ids` atomically inside the transition transaction. There is no per-client `getNextSong` in multiplayer — this fixes today's bug where concurrent callers receive different songs.

**Anti-cheat:** the question payload broadcast to clients (and returned by `getMatchState`) contains the prompt + MC options but **never marks the correct answer**. Correctness is validated server-side in `submitAnswer` (same contract as the solo flow).

## Schema changes (additive; hand-written migration per repo convention — see reference_drizzle_migration_convention)

- **`game_rooms`**: add
  - `round_phase` varchar/enum: `in_question | intermission | complete` (nullable; null in lobby). (`revealRound` transitions `in_question → intermission`; there is no separate `reveal` state — the reveal is the act of entering `intermission` and emitting `round_revealed`.)
  - `round_ends_at timestamptz` (nullable): server-set deadline for the current phase.
  - (`current_round`, `current_song_id`, `used_song_ids`, `timer_seconds`, `status` already exist.)
- **`round_results`**: support one row per **(room_id, round_number, player_id)** with a **unique constraint** on that triple (prevents double-submit). Today the table is `active_player_id`-scoped (turn-based); add `player_id` + unique index (and keep existing columns for back-compat).
- **`room_players`**: add `is_connected boolean NOT NULL DEFAULT true` (LiveKit presence; drives timeout/disconnect scoring).

All changes additive/nullable (or defaulted) — safe to apply to the shared prod DB. Each ships as a hand-written `00NN_*.sql` + an `apply-*-migration.mjs` runner; **not** via `drizzle-kit generate`.

## Server engine API (new focused `matchEngine` router; reuses existing helpers)

- **`startMatch`** — host-only. Validates caller is host, status = waiting, ≥2 players all `is_ready`. Picks round-1 song (reuse weighted-pick), sets `status=active`, `current_round=1`, `round_phase=in_question`, `round_ends_at = now + timer_seconds`. Emits `round_started`.
- **`submitAnswer`** — per player, current round only. Reuses the existing scoring (title/artist/year/lyric points + speed/streak bonuses). Rejects double-submit (unique constraint) and late submits (`now > round_ends_at + grace`). Writes `round_results`, updates `room_players.current_score`. Emits `player_answered` (player id only — not the answer).
- **`revealRound`** — any active player. Valid only when **all connected players have answered OR `now ≥ round_ends_at`**. Idempotent guard on `(current_round, round_phase=in_question)`. Computes per-round results + standings, sets `round_phase=intermission`, `round_ends_at = now + intermission_seconds`. Emits `round_revealed`.
- **`advanceRound`** — any active player. Valid only when `round_phase=intermission` and `now ≥ round_ends_at`. Idempotent guard. If `current_round < rounds_total`: pick next song, `current_round++`, `round_phase=in_question`, reset `round_ends_at`, emit `round_started`. Else `status=finished`, `round_phase=complete`, emit `match_complete`.
- **`getMatchState`** — authoritative snapshot (room, players+scores+connection, current round/phase/deadline, current question payload sans answer, latest standings) for initial load, reconnect, and gap-fill.

Each authoritative transition emits its broadcast **after** the DB commit, reusing the same server-side Supabase Realtime mechanism the chat system uses to publish messages.

## Realtime (reuse the chat pattern)

- New client hook **`useGameChannel(roomId)`** mirroring `useChatChannel`, subscribing to Supabase channel **`game:{roomId}`**.
- Server events: `round_started` (round #, question payload + options, `round_ends_at`), `player_answered` (player id), `round_revealed` (per-player round results + standings), `match_complete`.
- Events are render data; **`getMatchState` is the source of truth** on join/reconnect/gap. A slow `getMatchState` poll (~5 s) is a resilience fallback if the socket drops.

## Client

- **Lobby** — enhance the existing `VideoLobby` (camera lobby). Add per-player **Ready** badges + a host **Start** button (currently a disabled "Phase 2" button), rendered over the existing `VideoGrid`. Uses a `startMatch` mutation. Matches mockup Image 1 "LOBBY."
- **Match screen** — new route **`/match/:roomCode`** → new `MultiplayerGameplay` page. Renders `VideoGrid` (player tiles) + the shared question + MC options + a countdown bar to `round_ends_at` + "who has answered" indicators. On `round_revealed`, shows per-round results + the live standings ("X is in the lead! Next round in N…"). Solo `Gameplay`/`/play` is untouched.
- **Final** — reuse the existing multi-player `FinalResults` (`/results/final/:roomCode`). Stepped-podium polish is P2.

## Disconnect / timeout / edge handling

- **No answer by deadline** → 0 points that round; player remains in standings.
- **Disconnect** (LiveKit participant leaves → `is_connected=false`) → remains in standings; subsequent unanswered rounds auto-score 0; may **rejoin via room code** before match end and resume.
- **Host leaves in lobby** → host role migrates to the earliest-joined connected player. (Round advance is any-client-triggered, so host loss mid-match does not stall the game.)
- **Players drop below 2 mid-match** → match continues; the last remaining player finishes out.
- **No join after `startMatch`** in P1 (lobby-only join).
- **All disconnect** → room marked finished (cleanup).

## Reuse map (lean on, don't rebuild)

LiveKit tokens/grid/tiles (`liveRoom.ts`, `useLiveKitRoom`, `VideoGrid`/`VideoTile`) · `getNextSong` weighted-pick (called once server-side) · existing MC scoring/points (`submitAnswer` scoring path) · `setReady`/host-check pattern · Supabase Realtime broadcast (chat) · `FinalResults` multi-player list.

## Testing

**Server**
- Idempotent transitions: two concurrent `revealRound` (and `advanceRound`) calls → exactly one flips the phase, the other no-ops.
- `submitAnswer`: double-submit rejected (unique constraint); late submit (past deadline + grace) rejected; scoring matches the existing solo scoring for the same inputs.
- Song picked exactly once per round; `used_song_ids` never yields duplicates within a match.
- Standings math: ordering + per-round deltas correct.
- `startMatch` host-only + ready/min-player validation.

**Client**
- `useGameChannel` subscribes and refetches `getMatchState` on events.
- `MultiplayerGameplay` renders question + video grid + countdown; submit locks the UI and shows "answered."
- Standings render after `round_revealed`.
- Reconnect path: mounting mid-match hydrates correctly from `getMatchState`.

## Out of scope (P1)

Reactions; per-match/round-break chat; entry-fee/pool/payout; rematch / post-game lobby / new-players; stepped-podium visual; non-camera multiplayer variant (Image 2 without video — same engine, later); spectators; join-after-start.

## Files (anticipated)

- **New:** `server/routers/matchEngine.ts`; client `client/src/pages/MultiplayerGameplay.tsx`, `client/src/lib/game/useGameChannel.ts`; hand-written migration `drizzle/00NN_match_engine.sql` + `scripts/apply-match-engine-migration.mjs`.
- **Edited:** `drizzle/schema.ts` (3 additive changes), `client/src/pages/VideoLobby.tsx` (ready + start), `client/src/App.tsx` (route `/match/:roomCode`), server router registration. Reuse (no behavioral change) of `getNextSong` helper + scoring path.
