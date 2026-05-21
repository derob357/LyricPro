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
+---------------------------------------------+
|  LyricPro Multiplayer Lobby                  |
|                                              |
|  +------+ +------+ +------+ +------+        |
|  | Host | | P2   | | P3   | | P4   |        |
|  | cam  | | cam  | | cam  | | cam  |        |
|  +------+ +------+ +------+ +------+        |
|                                              |
|  Room: ABCD-1234    Players: 4/8             |
|  Genre: R&B, Hip Hop  Rounds: 10             |
|                                              |
|  [Share Invite Link]    [Start Game] (host)  |
+---------------------------------------------+
```

### Current Player Screen (Private)

```
+---------------------------------------------+
|  Round 3/10    Timer: 0:24    Score: 145 pts |
|                                              |
|  "We found love in a hopeless place..."      |
|                                              |
|  Lyric:  [________________________]          |
|  Artist: [________________________]          |
|  Title:  [________________________]          |
|  Year:   [________________________]          |
|                                              |
|          [Submit Answer]                     |
|                                              |
|  +-----+ Mute Others                        |
|  | You |                                     |
|  +-----+                                     |
+---------------------------------------------+
```

### Spectator View (Other Players)

```
+---------------------------------------------+
|  +------+ +------+ +------+ +------+        |
|  |P1    | | You  | | P3   | | P4   |        |
|  |playing| |      | |      | |      |        |
|  +------+ +------+ +------+ +------+        |
|                                              |
|  +=======================================+   |
|  |     Timer: 0:24  remaining            |   |
|  |     Player 1 is playing...            |   |
|  +=======================================+   |
|                                              |
|  +---------------------------------------+   |
|  |  iHeartMedia                          |   |
|  |  [Hero Banner Ad - 728x90 or fluid]   |   |
|  +---------------------------------------+   |
|                                              |
|  Fun Fact: Whitney Houston's "I Will         |
|     Always Love You" was originally written  |
|     by Dolly Parton in 1973.                 |
|                                              |
|  Leaderboard:                                |
|  1. Player1  - 245 pts                       |
|  2. You      - 180 pts                       |
|  3. Player3  - 120 pts                       |
|  4. Player4  -  90 pts                       |
+---------------------------------------------+
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

- LiveKit Cloud, Daily.co, Agora, or VideoSDK.live embedded in React
- Room creation via server-side API call
- Client-side SDK handles video grid, muting, screen management
- Pros: Fast to ship, reliable, built-in TURN/quality optimization
- Cons: Per-minute cost (~$0.001–$0.01/participant/min depending on vendor and audio vs video)

#### Vendor Comparison (researched 2026-05-20)

**✅ LiveKit Cloud — chosen**

- Free tier (permanent): 5K participant-min + 50 GB egress / month
- Audio-only: ~$0.40–$0.50 / 1K min (cheapest)
- Video HD: ~$0.50 / 1K min + egress
- Capacitor iOS: ⚠️ AVAudioSession pre-warm needed
- Open-source escape hatch: ✅ Apache 2.0 self-host (same SFU)
- DX: strong, modern
- Differentiator: cheapest at scale + no lock-in
- Main risk: self-host TURN is real ops work (Cloud avoids this)

**Daily.co**

- Free tier: 10K participant-min / month
- Audio-only: $0.99 / 1K min
- Video HD: $4.00 / 1K min (no upcharge for HD)
- Capacitor iOS: ⚠️ permission re-prompt fix needed
- Open-source: ❌
- DX: 🥇 simplest onboarding in category
- Differentiator: bundled features (chat, recording, transcription, AI/Pipecat first-party)
- Main risk: US-centric infrastructure

**Agora**

- Free tier: 10K participant-min / month
- Audio-only: $0.99 / 1K min
- Video HD: $3.99 / 1K min
- Capacitor iOS: ❌ Agora explicitly does NOT recommend Web SDK on iOS WKWebView
- Open-source: ❌
- DX: 😬 recurring documentation-quality complaints
- Differentiator: Asia/SEA infrastructure (<400ms global)
- Main risk: iOS WebView reliability for our exact stack

**VideoSDK.live**

- Free tier: 10K participant-min / month + $20 signup credit
- Audio-only: $0.60–$1.00 / 1K min
- Video HD: $2.99 / 1K min (cheapest video)
- Capacitor iOS: ⚠️ JS SDK works in WebView; no official Capacitor plugin; weak TS types
- Open-source: ❌
- DX: OK; weak TypeScript types are a recurring complaint
- Differentiator: cheapest video HD
- Main risk: smaller community; billing/invoice mismatches reported on G2/Capterra

**Est. monthly cost at MVP scale (audio-only mix):**

| Volume                | LiveKit Cloud                  | Daily | Agora | VideoSDK |
| --------------------- | ------------------------------ | ----- | ----- | -------- |
| 30K min/mo (1K/day)   | **~$15** (often free on Build) | ~$20  | ~$20  | ~$20     |
| 300K min/mo (10K/day) | **~$200–$300**                 | ~$273 | ~$287 | ~$290    |

**Decision: LiveKit Cloud (Build → Ship tier).**

- ~Half Daily's per-minute audio rate, materially cheaper at higher MVP scale.
- Apache 2.0 escape hatch: if LiveKit changes pricing or quality degrades, we self-host the exact same SFU with no app rewrite.
- Free tier (5K min + 50 GB egress) realistically covers alpha at $0.
- Capacitor iOS friction is solvable with a small AVAudioSession pre-warm shim — comparable effort to Daily's permission-persistence workaround.

**Watch-outs to address in implementation:**

- iOS WKWebView audio cold-start glitch → pre-activate AVAudioSession from native layer.
- Downstream bandwidth fan-out grows with room size (each speaker → N-1 receivers). Audio-only stays well within egress budget; if we add video, the included 50 GB is consumed faster than expected.
- Do not self-host TURN until we're past ~500 concurrent rooms or have a dedicated infra engineer.
- Token TTL must be short (15 min, server-side refresh); API secret stays server-side only.

**Migration path:** Cloud Build (free) → Cloud Ship ($50/mo) when first paying customer signs up → Cloud Scale ($500/mo) for production SLAs → self-host only if economics justify the ops cost.

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
