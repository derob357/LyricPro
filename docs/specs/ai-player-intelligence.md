# AI Player Intelligence — Behavioral Analysis & Smart Suggestions

## Overview

A server-side analytics engine that observes how each player uses LyricPro and generates contextual suggestions: game mode recommendations, package upsells, and personality-driven commentary that makes the game feel alive.

---

## 1. Data Signals (what we observe)

All signals derive from existing tables — no new schema needed.

| Signal | Source | Example insight |
|--------|--------|-----------------|
| **Genre accuracy map** | `round_results` grouped by `songs.genre` | "You crush R&B but struggle with Country" |
| **Decade accuracy map** | `round_results` grouped by `songs.decadeRange` | "90s kid confirmed — 80% accuracy in the 1990s" |
| **Stage accuracy** | `round_results` per-field (lyric, title, artist, year) | "You know the artists but can't name the year" |
| **Difficulty distribution** | `game_rooms.difficulty` per user | "Always plays Low — never tried High" |
| **Mode distribution** | `game_rooms.mode` per user | "100% solo — hasn't tried multiplayer" |
| **Session frequency** | `game_sessions.createdAt` patterns | "Plays every evening", "Binges on weekends" |
| **Average round time** | `round_results.responseTimeMs` | Fast responder vs deliberate thinker |
| **Streak patterns** | `room_players.longestStreak` history | Streak builder vs boom-and-bust |
| **Genre monotony** | genre distribution over last 20 games | Stuck in one genre vs explorer |
| **Abandonment rate** | rooms where `currentRound < roundsTotal` | Quits early on certain genres/difficulties |
| **Golden Notes balance** | `golden_note_balances` | Spending behavior, purchase timing |

---

## 2. Player Profile (computed per user)

Recalculated after each game session. Stored as a JSON column on `users` or a separate `player_profiles` table.

```typescript
interface PlayerProfile {
  // Skill assessment
  strongestGenres: string[];        // top 2 by accuracy
  weakestGenres: string[];          // bottom 2 by accuracy
  strongestDecades: string[];       // top 2
  weakestDecades: string[];         // bottom 2
  bestStage: "lyric" | "title" | "artist" | "year";
  worstStage: "lyric" | "title" | "artist" | "year";

  // Behavioral patterns
  preferredDifficulty: "low" | "medium" | "high";
  hasTriedMultiplayer: boolean;
  hasTriedTeamMode: boolean;
  avgSessionGames: number;          // games per sitting
  playTimePreference: "morning" | "afternoon" | "evening" | "night";
  isStreakPlayer: boolean;          // longest streak >= 5
  isSpeedPlayer: boolean;           // avg response < 8s
  genreDiversity: number;           // 0-1, how many genres they explore
  difficultyProgression: "stuck" | "climbing" | "peaked";

  // Engagement
  totalGames: number;
  daysSinceLastGame: number;
  consecutiveDaysPlayed: number;
  goldenNotesSpent: number;
  goldenNotesBalance: number;
}
```

---

## 3. Suggestion Engine

### 3a. Game Mode Suggestions (shown on home screen or post-game)

| Trigger condition | Suggestion |
|-------------------|------------|
| 10+ solo games, never tried multiplayer | "You've been going solo — challenge a friend and see who really knows their lyrics" |
| High accuracy in one genre, low in another | "You own R&B. Ready to test yourself with some Country?" |
| Always plays Low difficulty, accuracy > 80% | "Low is too easy for you. Medium unlocks harder lyrics and double the points" |
| Plays same genre 5+ games in a row | "Shake it up — try a mixed-genre game and see how you do across the board" |
| Long streaks in streak_bonus mode | "Your streak game is strong. Try speed_bonus mode — same fire, tighter clock" |
| Hasn't played in 7+ days | "Welcome back! A lot of new songs dropped while you were away" (push notification) |
| Played 3+ games today | "Going hard today! A 10-round marathon might be your vibe" |
| Team mode never tried, 5+ multiplayer games | "Try Team mode — draft your squad and battle together" |

### 3b. Package / Upsell Suggestions

| Trigger condition | Suggestion |
|-------------------|------------|
| Accuracy > 70% on a genre, < 20 songs in that pool | "Want more [Genre]? The [Genre] Expansion Pack drops 50 new songs" |
| Ran out of free games | "Out of free games? 1 Golden Note = 1 more round. Grab some in the shop" |
| Plays daily, no subscription | "Playing every day? Go unlimited for $4.99/mo — no daily caps, priority songs" |
| High difficulty player, uses streak insurance often | "Love streak insurance? Premium members get it free every game" |
| Completed all songs in a genre/decade slice | "You've heard every Jazz 90s song we have. New pack coming — want early access?" |

### 3c. Personality-Driven Commentary (shown during/after gameplay)

Comments adapt to the player's behavioral profile and the specific round outcome.

**After a round where they get 0/4:**
- Speed player: "Even Usain Bolt trips sometimes. Shake it off."
- Streak player: "There goes the streak... rebuild starts now."
- Genre mismatch: "Country isn't your lane yet. That's what practice mode is for."
- General: "Tough one. Even the DJ doesn't know every track."

**After getting only the artist right:**
- "You know WHO sings it, just not WHAT they sing. Classic fan move."

**After getting only the year right:**
- "You're a walking music calendar. Now learn the actual lyrics."

**After a perfect round (4/4):**
- First time ever: "Your FIRST perfect round! Screenshot this — it's going in the hall of fame."
- Streak of perfects: "That's [N] perfects in a row. Are you cheating? (We checked. You're not.)"
- On a weak genre: "Wait — you just aced [Genre]? Who ARE you?"
- Speed player: "[X] seconds. Your brain is basically Shazam."

**After a game where they improve vs. last session:**
- "Last time: [old score]. This time: [new score]. You're leveling up."

**Win/loss in multiplayer:**
- Close win: "Won by [N] points. Your opponent is typing 'rematch' right now."
- Blowout win: "That wasn't even fair. Maybe invite someone who actually listens to music."
- Close loss: "Lost by [N] points. ONE more correct year and you had it."
- Blowout loss: "Sometimes you're the DJ. Sometimes you're the aux cord that gets unplugged."

---

## 4. Implementation Architecture

### Phase 1: Profile Builder (server-side, runs post-game)

A `computePlayerProfile()` function that runs after each `submitAnswer` of the final round (or on game completion). Queries the last 50 games for that user, computes the profile, and stores it.

```
game completes → computePlayerProfile(userId) → upsert player_profiles row
```

### Phase 2: Suggestion Resolver (server-side tRPC route)

```typescript
// New tRPC route
insights.getSuggestions → returns {
  gameModeSuggestion?: { text: string; action: string; }
  upsellSuggestion?: { text: string; action: string; }
  commentary?: string;  // post-round quip
}
```

Called by the client on:
- Home screen (mode + upsell suggestions)
- Post-round results (commentary)
- Post-game final results (mode + upsell + commentary)

### Phase 3: Commentary Generator

Two approaches (pick one):

**Option A — Template engine (no LLM cost)**
Pre-written templates with slot fills (`{genre}`, `{score}`, `{streak}`). ~100 templates covering the scenarios above. Fast, predictable, zero cost.

**Option B — LLM-generated (personalized, higher cost)**
Pass the player profile + round context to Claude Haiku for a one-line quip. Cache aggressively (same profile shape = same response for 24h). ~$0.001 per call.

**Recommendation: Start with Option A**, graduate to Option B when the user base is large enough that templates feel repetitive.

### Phase 4: Push Notifications (re-engagement)

Use the existing notification system (`notifications` table + `NotificationToast`) for in-app. Add web push or email for lapsed players:
- 3 days inactive: "Your streak is fading — one quick game to keep it alive"
- 7 days inactive: "New songs added this week in [strongestGenre]. Come back and try them"
- 14 days inactive: "We miss you. Here's a free Golden Note to get back in the game"

---

## 5. Privacy & Guardrails

- Profile data is internal analytics only — never exposed raw to other players
- Commentary must be encouraging, never mean. Roast gently, never insult
- Upsell frequency capped: max 1 suggestion per session, never mid-game
- LLM commentary (if used) runs through a content filter — no profanity, no references to gambling
- Players can disable commentary in settings (add a toggle)
- GDPR: profile deleted with account deletion (existing flow)

---

## 6. Schema Addition (minimal)

```sql
CREATE TABLE player_profiles (
  user_id       INTEGER PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  profile       JSONB NOT NULL DEFAULT '{}',
  computed_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  games_at_compute INTEGER NOT NULL DEFAULT 0
);
```

One row per user. Recomputed when `totalGames > games_at_compute`.

---

## 7. Suggested Rollout

| Phase | Scope | Effort |
|-------|-------|--------|
| **Phase 1** | Profile builder + store | 1 session |
| **Phase 2** | Home screen mode suggestions | 1 session |
| **Phase 3a** | Post-round template commentary (50 templates) | 1 session |
| **Phase 3b** | Post-game summary commentary | 0.5 session |
| **Phase 4** | Upsell suggestions | 0.5 session |
| **Phase 5** | LLM commentary upgrade (optional) | 1 session |
| **Phase 6** | Push/email re-engagement | 1 session |
