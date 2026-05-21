# Meeting Fixes (2026-05-19) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Fix scoring/celebration bugs, upgrade AI commentary to live LLM calls proportionate to score, and create a multiplayer mode design document.

**Architecture:** (1) Fix correctCount to only count full matches for celebration triggering while preserving partial-match points, (2) Move celebration from Gameplay post-submit to RoundResults post-advance, (3) Upgrade commentaryEngine prompt to produce score-proportionate responses with more personality, (4) Write standalone multiplayer design doc.

**Tech Stack:** React, TypeScript, tRPC, Framer Motion, Anthropic Claude SDK, Web Audio API

---

## File Structure

```
client/src/pages/
├── Gameplay.tsx         ← MODIFY: remove celebration trigger + component, pass correctCount to results
├── RoundResults.tsx     ← MODIFY: add celebration trigger on Next Round click

server/
├── routers/game.ts     ← MODIFY: add celebrationCount (full-matches-only) to submitAnswer response
├── _core/commentaryEngine.ts ← MODIFY: upgrade LLM prompt for proportionate responses

docs/
├── specs/multiplayer-mode-design.md ← CREATE: multiplayer design document
```

---

### Task 1: Fix Scoring — Separate celebration count from correctCount

The root bug: `correctCount` counts partial matches (partial lyric, partial title, primary-only artist) as "correct." This means a player who gets nothing fully right but has 2 partial matches sees a Level 1 celebration with particles — feels like rewarding wrong answers.

**Fix:** Add a new `celebrationCount` field that only counts FULL correct matches. Keep `correctCount` as-is for scoring. Pass `celebrationCount` to the client.

**Files:**
- Modify: `server/routers/game.ts:1087-1091,1136-1159`

- [ ] **Step 1: Add celebrationCount calculation**

In `server/routers/game.ts`, after the `correctCount` calculation (line 1091), add:

```typescript
      // celebrationCount: only full matches trigger celebration (no partial credit)
      const celebrationCount =
        (lyricCorrect ? 1 : 0) +
        (titleCorrect ? 1 : 0) +
        (artistCorrect ? 1 : 0) +
        (yearPoints > 0 ? 1 : 0);
```

- [ ] **Step 2: Include celebrationCount in the response**

Find where the submitAnswer response object is built (around line 1195-1229 where it returns the result). Add `celebrationCount` to the returned object alongside `correctCount`.

- [ ] **Step 3: Verify existing tests still pass**

Run: `cd ~/Documents/myWork/CCS/LyricPro/lyricpro-ai-2.0 && npx vitest run`
Expected: ALL PASS (no behavior change — just added a new field)

- [ ] **Step 4: Commit**

```bash
git add server/routers/game.ts
git commit -m "fix: add celebrationCount (full matches only) to submitAnswer response

correctCount still counts partial matches for scoring purposes.
celebrationCount only counts full matches — used to determine celebration
level so partial-credit answers don't trigger fireworks."
```

---

### Task 2: Move celebration from Gameplay to RoundResults

Currently: celebration fires in Gameplay.tsx 600ms after answer submit, then navigates to RoundResults on completion.

Target: no celebration in Gameplay. Navigate immediately to RoundResults. Celebration fires when player clicks "Next Round" on the RoundResults page.

**Files:**
- Modify: `client/src/pages/Gameplay.tsx:10,104-128,394-402`
- Modify: `client/src/pages/RoundResults.tsx:1-14,55-92,210-270`

- [ ] **Step 1: Remove celebration from Gameplay.tsx**

In `client/src/pages/Gameplay.tsx`:

1. Remove the Celebration import (line 10):
```typescript
// DELETE: import Celebration, { type CelebrationLevel } from "@/components/Celebration";
```

2. Remove the celebrationLevel state (find `useState` for it and remove).

3. In `submitMutation.onSuccess` (lines 104-128), replace the celebration logic with immediate navigation. Change lines 117-125 from:
```typescript
      const cnt = result.correctCount ?? 0;
      const lvl = (cnt >= 4 ? 3 : cnt >= 3 ? 2 : cnt >= 2 ? 1 : 0) as CelebrationLevel;
      if (lvl > 0) {
        setTimeout(() => setCelebrationLevel(lvl), 600);
      } else {
        navigate(`/results/round/${roomCode}`);
      }
```
To:
```typescript
      // Navigate to results immediately — celebration plays there on advance
      setTimeout(() => navigate(`/results/round/${roomCode}`), 600);
```

4. Remove the Celebration component from the JSX (lines 394-402):
```typescript
// DELETE the entire <Celebration ... /> block
```

- [ ] **Step 2: Add celebration to RoundResults.tsx**

In `client/src/pages/RoundResults.tsx`:

1. Add imports at top:
```typescript
import Celebration, { type CelebrationLevel } from "@/components/Celebration";
```

2. Add state in the component (after existing useState declarations around line 61):
```typescript
  const [celebrationLevel, setCelebrationLevel] = useState<CelebrationLevel>(0);
  const muted = localStorage.getItem("lyricpro_muted") === "true";
```

3. Modify `handleNext` (lines 89-92). Instead of immediately calling nextRoundMutation, trigger celebration first if earned:

```typescript
  const handleNext = () => {
    const cnt = result?.celebrationCount ?? result?.correctCount ?? 0;
    const lvl = (cnt >= 4 ? 3 : cnt >= 3 ? 2 : cnt >= 2 ? 1 : 0) as CelebrationLevel;
    if (lvl > 0) {
      setCelebrationLevel(lvl);
    } else {
      advanceRound();
    }
  };

  const advanceRound = () => {
    setIsAdvancing(true);
    nextRoundMutation.mutate({ roomCode: roomCode ?? "", guestToken: guestToken ?? undefined });
  };
```

4. Add the Celebration component to the JSX, right inside the outer div before the main content:
```tsx
      <Celebration
        level={celebrationLevel}
        muted={muted}
        onComplete={() => {
          setCelebrationLevel(0);
          advanceRound();
        }}
      />
```

- [ ] **Step 3: Update RoundResult type to include celebrationCount**

In `client/src/pages/RoundResults.tsx`, add to the `RoundResult` type (around line 26):
```typescript
  celebrationCount?: number;
```

- [ ] **Step 4: Test manually**

Run: `cd ~/Documents/myWork/CCS/LyricPro/lyricpro-ai-2.0 && npx vitest run`
Expected: ALL PASS

- [ ] **Step 5: Commit**

```bash
git add client/src/pages/Gameplay.tsx client/src/pages/RoundResults.tsx
git commit -m "fix: move celebration from gameplay to round results advance

Celebration now fires when clicking Next Round on the results page,
not on lyric completion. Uses celebrationCount (full matches only)
so partial-credit answers don't trigger fireworks."
```

---

### Task 3: Upgrade AI commentary to be proportionate to scores

The current LLM prompt asks for a witty one-liner in 20 words max. The user wants responses that are proportionate — hype for high scores, encouragement for low, playful for mid. The prompt also needs to be more explicit about tone matching.

**Files:**
- Modify: `server/_core/commentaryEngine.ts:116-121`

- [ ] **Step 1: Upgrade the LLM prompt**

In `server/_core/commentaryEngine.ts`, replace the prompt in `tryLlmCommentary` (lines 116-121):

```typescript
    const prompt = `You write post-round commentary for a music lyric trivia game called LyricPro. Your tone MUST match the player's score.

Round result: ${ctx.correctCount}/4 correct (lyric: ${ctx.lyricCorrect}, title: ${ctx.titleCorrect}, artist: ${ctx.artistCorrect}, year: ${ctx.yearCorrect}). Genre: ${ctx.genre}. ${ctx.passUsed ? "Player passed this round." : ""} Response time: ${ctx.responseTimeSeconds ?? "unknown"}s. Streak: ${ctx.streakCount}.
${profileSnippet}

TONE RULES based on score:
- 4/4 correct: GO OFF. Electric hype. "That was legendary!" energy. Make them feel like a god.
- 3/4 correct: Impressed but teasing about what they missed. Confident, upbeat.
- 2/4 correct: Playful, encouraging. Acknowledge the effort, light roast on misses.
- 1/4 correct: Gentle encouragement with humor. "Hey, you got one!" vibes. No pity.
- 0/4 correct: Funny, self-deprecating humor ON THEIR BEHALF. Make them laugh, not feel bad. "That genre owes you an apology."
- Pass: Quick, no-judgment. "Smart move" or "Living to fight another round."

Write 1-2 sentences (max 30 words). Reference the specific genre or what they got right/wrong. No emojis. No greetings. No sign-off.`;
```

- [ ] **Step 2: Increase max_tokens slightly**

In the same function, change `max_tokens: 100` to `max_tokens: 150` to accommodate the slightly longer responses.

- [ ] **Step 3: Run tests**

Run: `cd ~/Documents/myWork/CCS/LyricPro/lyricpro-ai-2.0 && npx vitest run`
Expected: ALL PASS

- [ ] **Step 4: Commit**

```bash
git add server/_core/commentaryEngine.ts
git commit -m "feat: upgrade AI commentary prompt for score-proportionate responses

Explicit tone rules: 4/4 = electric hype, 3/4 = impressed teasing,
2/4 = playful encouragement, 1/4 = gentle humor, 0/4 = funny,
pass = no-judgment. Increased to 30 words / 150 tokens for richer responses."
```

---

### Task 4: Multiplayer Mode Design Document

**Files:**
- Create: `docs/specs/multiplayer-mode-design.md`

- [ ] **Step 1: Write the design document**

Create `docs/specs/multiplayer-mode-design.md`:

```markdown
# Multiplayer Mode — Design Document

**Status:** Draft
**Date:** 2026-05-19
**Author:** Deric Robinson

---

## Overview

A real-time multiplayer mode where a host creates a video conference room with game settings. Players join via invite, see each other on video, and take turns playing lyric trivia. Non-playing participants see a spectator view with ads, fun facts, and a countdown timer while the current player plays privately.

---

## User Flows

### Host Flow

1. Host clicks "Create Multiplayer Room" from game setup
2. Host configures game settings:
   - Genre(s), decade(s), difficulty, rounds, timer
   - Entry fee tier (optional, for prize pool games)
   - Max players (2-8)
3. System creates room with unique invite code
4. Host enters video conference lobby — sees their camera feed + waiting room
5. Host shares invite link/code with friends
6. As players join, they appear in the video grid
7. Host clicks "Start Game" when ready
8. Game begins — host and players take turns

### Player Join Flow

1. Player receives invite link or enters room code
2. Player sees room details (settings, host name, player count)
3. Player clicks "Join Room" — enters video lobby
4. Player sees all other participants on video
5. Waits for host to start the game

### Gameplay Flow (Per Round)

1. System selects the current player (rotation order set at game start)
2. **Current player's screen (PRIVATE):**
   - Full gameplay UI (lyric prompt, answer fields, timer)
   - Only visible to the current player
   - Video feeds minimized/hidden during active play
   - Microphone stays live (can hear others unless they mute)
3. **All other players' screens (SPECTATOR VIEW):**
   - Large countdown timer showing current player's remaining time
   - Hero banner ad from iHeartMedia (rotating, full-width)
   - Fun facts carousel (music trivia, artist facts, game tips)
   - Small video grid of all participants (including current player's camera — shows them thinking/reacting)
   - Audio: can hear all players (current player's reactions are part of the fun)
4. When current player submits or time expires:
   - All players see the Round Results screen together
   - Celebration plays for everyone if the player scored well
   - Leaderboard updates visible to all
5. Next player's turn begins

---

## Screen Layouts

### Video Conference Lobby

```
┌─────────────────────────────────────────────┐
│  LyricPro Multiplayer Lobby                  │
│                                              │
│  ┌──────┐ ┌──────┐ ┌──────┐ ┌──────┐       │
│  │ Host │ │ P2   │ │ P3   │ │ P4   │       │
│  │ 📹   │ │ 📹   │ │ 📹   │ │ 📹   │       │
│  └──────┘ └──────┘ └──────┘ └──────┘       │
│                                              │
│  Room: ABCD-1234    Players: 4/8             │
│  Genre: R&B, Hip Hop  Rounds: 10             │
│                                              │
│  [Share Invite Link]    [Start Game] (host)  │
└─────────────────────────────────────────────┘
```

### Current Player Screen (Private)

```
┌─────────────────────────────────────────────┐
│  Round 3/10    ⏱ 0:24    🏆 145 pts         │
│                                              │
│  🎵 "We found love in a hopeless place..."   │
│                                              │
│  Lyric:  [________________________]          │
│  Artist: [________________________]          │
│  Title:  [________________________]          │
│  Year:   [________________________]          │
│                                              │
│          [Submit Answer]                     │
│                                              │
│  ┌─────┐ 🔇 Mute Others                     │
│  │ You │                                     │
│  └─────┘                                     │
└─────────────────────────────────────────────┘
```

### Spectator View (Other Players)

```
┌─────────────────────────────────────────────┐
│  ┌──────┐ ┌──────┐ ┌──────┐ ┌──────┐       │
│  │ P1🎮 │ │ You  │ │ P3   │ │ P4   │       │
│  │playing│ │      │ │      │ │      │       │
│  └──────┘ └──────┘ └──────┘ └──────┘       │
│                                              │
│  ╔═══════════════════════════════════════╗   │
│  ║     ⏱  0:24  remaining               ║   │
│  ║     Player 1 is playing...            ║   │
│  ╚═══════════════════════════════════════╝   │
│                                              │
│  ┌───────────────────────────────────────┐   │
│  │  🎧 iHeartMedia                       │   │
│  │  [Hero Banner Ad — 728x90 or fluid]   │   │
│  └───────────────────────────────────────┘   │
│                                              │
│  💡 Fun Fact: Whitney Houston's "I Will      │
│     Always Love You" was originally written  │
│     by Dolly Parton in 1973.                 │
│                                              │
│  Leaderboard:                                │
│  1. Player1  — 245 pts                       │
│  2. You      — 180 pts                       │
│  3. Player3  — 120 pts                       │
│  4. Player4  —  90 pts                       │
└─────────────────────────────────────────────┘
```

---

## Technical Architecture

### Video Conference

**Option A: WebRTC (Self-Hosted)**
- Peer-to-peer video/audio via WebRTC
- Signaling server via WebSocket (can extend existing tRPC WebSocket or add dedicated)
- TURN server for NAT traversal (Cloudflare TURN or Twilio TURN)
- Pros: No per-minute costs, full control
- Cons: Complex, need TURN infrastructure, quality varies

**Option B: Third-Party SDK (Recommended for MVP)**
- Daily.co, Livekit, or Agora SDK embedded in React
- Room creation via server-side API call
- Client-side SDK handles video grid, muting, screen management
- Pros: Fast to ship, reliable, built-in TURN/quality optimization
- Cons: Per-minute cost (~$0.004-0.01/participant/min)

**Recommendation:** Start with Daily.co or Livekit for MVP. Migrate to self-hosted WebRTC later if costs justify it.

### Game State Synchronization

- Extend existing tRPC mutations with real-time subscriptions (tRPC subscriptions over WebSocket)
- Server is authoritative for: turn order, timer, scoring, phase transitions
- Client receives: whose turn it is, timer ticks, round results
- Current player's answers are NEVER broadcast — only the final score

### Spectator Content

**iHeartMedia Ads:**
- Ad tag integration (VAST/VPAID for video, standard display for banners)
- Rotate every 30 seconds during spectator view
- Server provides ad slot config; client renders via ad SDK

**Fun Facts:**
- Pre-loaded database of music fun facts (500+)
- Served from existing song/artist metadata + curated list
- Rotate every 15 seconds during spectator view

---

## Audio/Mute Controls

| Scenario | Audio Behavior |
|----------|---------------|
| Lobby | All participants hear each other |
| Current player's turn | All hear each other by default |
| Current player mutes others | Others' audio muted for current player only |
| Spectators | Hear all participants (including current player's reactions) |
| Between rounds (results) | All hear each other |

**Mute controls:**
- Each player can mute their own mic (standard video call)
- Current player gets an additional "Mute Others" toggle (focus mode)
- Host can mute individual players (moderation)

---

## Database Schema Additions

```sql
-- Multiplayer rooms extend existing gameRooms
ALTER TABLE game_rooms ADD COLUMN is_video_room BOOLEAN DEFAULT false;
ALTER TABLE game_rooms ADD COLUMN video_room_id TEXT; -- Daily.co/Livekit room ID
ALTER TABLE game_rooms ADD COLUMN max_players INTEGER DEFAULT 8;
ALTER TABLE game_rooms ADD COLUMN current_player_index INTEGER DEFAULT 0;
ALTER TABLE game_rooms ADD COLUMN turn_order JSONB; -- array of player IDs

-- Fun facts for spectator view
CREATE TABLE fun_facts (
  id SERIAL PRIMARY KEY,
  text TEXT NOT NULL,
  category TEXT NOT NULL, -- 'music_history', 'artist', 'genre', 'game_tip'
  source TEXT,
  created_at TIMESTAMP DEFAULT NOW()
);
```

---

## Implementation Phases

### Phase 1: Core Video Lobby (2-3 weeks)
- Daily.co/Livekit SDK integration
- Room creation with video enabled
- Invite link sharing
- Video grid in lobby
- Host "Start Game" trigger

### Phase 2: Turn-Based Gameplay (2-3 weeks)
- Turn rotation engine (server-authoritative)
- Private screen for current player
- Spectator view with timer + leaderboard
- Real-time score updates via tRPC subscriptions

### Phase 3: Spectator Content (1-2 weeks)
- Fun facts database + carousel
- iHeartMedia ad integration (banner + pre-roll)
- Spectator engagement metrics

### Phase 4: Audio Controls (1 week)
- Per-player mute
- "Mute Others" for current player
- Host moderation controls

### Phase 5: Polish (1-2 weeks)
- Connection quality indicators
- Reconnection handling
- Mobile-responsive video grid
- Performance optimization (pause video rendering during gameplay)

---

## Open Questions

1. **Video SDK choice** — Daily.co vs Livekit vs Agora? Need to evaluate pricing at expected scale.
2. **iHeartMedia integration** — What ad format? Do we have a direct partnership or using programmatic?
3. **Max concurrent rooms** — Infrastructure sizing for WebSocket + video relay.
4. **Mobile support** — React Native (Capacitor) compatibility with video SDK.
5. **Revenue model** — Is multiplayer free or premium-only? Entry fee games only?
```

- [ ] **Step 2: Run tests to ensure no regressions**

Run: `cd ~/Documents/myWork/CCS/LyricPro/lyricpro-ai-2.0 && npx vitest run`
Expected: ALL PASS (this task is docs-only)

- [ ] **Step 3: Commit**

```bash
git add docs/specs/multiplayer-mode-design.md
git commit -m "docs: add multiplayer mode design document

Video conference room with host invites, private player screen,
spectator view (timer, iHeartMedia ads, fun facts, leaderboard),
audio controls with mute. Phased implementation plan included."
```

---

### Task 5: Update todo.md and final verification

- [ ] **Step 1: Mark completed items in todo.md**

In the "Meeting Action Items (2026-05-19)" section of `todo.md`, mark completed items:

```markdown
### Bugs
- [x] **Scoring awards points for wrong answers** — fixed: celebrationCount uses full matches only
- [x] **Move fireworks trigger** — celebration now fires on Next Round click from RoundResults

### AI Response Quality
- [x] **Replace canned AI responses with live LLM calls** — upgraded prompt with score-proportionate tone rules

### Multiplayer Mode (Design Doc Needed)
- [x] **Create design document for multiplayer mode** — docs/specs/multiplayer-mode-design.md
```

- [ ] **Step 2: Run full test suite**

Run: `cd ~/Documents/myWork/CCS/LyricPro/lyricpro-ai-2.0 && npx vitest run`
Expected: ALL PASS

- [ ] **Step 3: Commit**

```bash
git add todo.md
git commit -m "docs: mark meeting action items (2026-05-19) as completed"
```
