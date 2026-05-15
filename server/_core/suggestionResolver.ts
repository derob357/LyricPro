// AI Player Intelligence — Phase 2: Suggestion Resolver
//
// Reads a computed PlayerProfileData and returns at most one game-mode
// suggestion and one upsell suggestion. Rules are ordered by priority —
// first match wins within each category.

import type { PlayerProfileData } from "./playerProfile";

export interface Suggestion {
  id: string;          // stable key for dismiss tracking
  text: string;
  action: string;      // route or CTA identifier
  category: "mode" | "upsell";
}

export interface SuggestionResult {
  gameModeSuggestion: Suggestion | null;
  upsellSuggestion: Suggestion | null;
}

// ── Game Mode Suggestions (first match wins) ────────────────────────────────

function resolveGameModeSuggestion(p: PlayerProfileData): Suggestion | null {
  // Always plays Low, accuracy is high → nudge to Medium
  if (
    p.preferredDifficulty === "low" &&
    p.totalGames >= 5 &&
    p.strongestGenres.length > 0
  ) {
    return {
      id: "nudge-medium",
      text: "Low is too easy for you. Medium unlocks harder lyrics and double the points.",
      action: "/play?difficulty=medium",
      category: "mode",
    };
  }

  // 10+ solo games, never tried multiplayer
  if (p.totalGames >= 10 && !p.hasTriedMultiplayer) {
    return {
      id: "try-multiplayer",
      text: "You've been going solo — challenge a friend and see who really knows their lyrics.",
      action: "/play?mode=multiplayer",
      category: "mode",
    };
  }

  // 5+ multiplayer games, never tried team mode
  if (p.hasTriedMultiplayer && !p.hasTriedTeamMode && p.totalGames >= 8) {
    return {
      id: "try-team",
      text: "Try Team mode — draft your squad and battle together.",
      action: "/play?mode=team",
      category: "mode",
    };
  }

  // Low genre diversity (plays same genre repeatedly)
  if (p.genreDiversity < 0.3 && p.totalGames >= 8 && p.strongestGenres.length > 0) {
    const strong = p.strongestGenres[0];
    const weak = p.weakestGenres.length > 0 ? p.weakestGenres[0] : null;
    if (weak && weak !== strong) {
      return {
        id: "try-new-genre",
        text: `You own ${strong}. Ready to test yourself with some ${weak}?`,
        action: `/play?genre=${encodeURIComponent(weak)}`,
        category: "mode",
      };
    }
    return {
      id: "mix-genres",
      text: "Shake it up — try a mixed-genre game and see how you do across the board.",
      action: "/play",
      category: "mode",
    };
  }

  // Streak player → suggest speed bonus mode
  if (p.isStreakPlayer && p.totalGames >= 10) {
    return {
      id: "try-speed-bonus",
      text: "Your streak game is strong. Try speed bonus mode — same fire, tighter clock.",
      action: "/play?ranking=speed_bonus",
      category: "mode",
    };
  }

  // Returning after absence
  if (p.daysSinceLastGame >= 7) {
    return {
      id: "welcome-back",
      text: "Welcome back! New songs have been added while you were away.",
      action: "/play",
      category: "mode",
    };
  }

  // Heavy session today → suggest marathon
  if (p.avgSessionGames >= 3 && p.totalGames >= 5) {
    return {
      id: "try-marathon",
      text: "Going hard today! A 10-round marathon might be your vibe.",
      action: "/play?rounds=10",
      category: "mode",
    };
  }

  // Difficulty climbing → encourage continuing
  if (p.difficultyProgression === "climbing" && p.preferredDifficulty === "medium") {
    return {
      id: "nudge-high",
      text: "You've been leveling up. High difficulty is where the real points are — ready?",
      action: "/play?difficulty=high",
      category: "mode",
    };
  }

  return null;
}

// ── Upsell Suggestions (first match wins) ───────────────────────────────────

function resolveUpsellSuggestion(p: PlayerProfileData): Suggestion | null {
  // Daily player, no subscription equivalent (Golden Notes balance is low)
  if (
    p.consecutiveDaysPlayed >= 3 &&
    p.goldenNotesBalance <= 2 &&
    p.totalGames >= 10
  ) {
    return {
      id: "upsell-golden-notes",
      text: "Playing every day? Grab some Golden Notes so you never hit a cap.",
      action: "/shop",
      category: "upsell",
    };
  }

  // Has Golden Notes but never spent them
  if (p.goldenNotesBalance >= 5 && p.goldenNotesSpent === 0 && p.totalGames >= 5) {
    return {
      id: "spend-golden-notes",
      text: `You're sitting on ${p.goldenNotesBalance} Golden Notes. Use them to unlock practice packs for your weak spots.`,
      action: "/dashboard",
      category: "upsell",
    };
  }

  // Weak genre with enough games → suggest practice pack
  if (p.weakestGenres.length > 0 && p.totalGames >= 15) {
    const weak = p.weakestGenres[0];
    return {
      id: "practice-pack",
      text: `Your ${weak} game needs work. Try a practice pack to level up.`,
      action: "/dashboard",
      category: "upsell",
    };
  }

  return null;
}

// ── Public API ──────────────────────────────────────────────────────────────

export function resolveSuggestions(profile: PlayerProfileData): SuggestionResult {
  return {
    gameModeSuggestion: resolveGameModeSuggestion(profile),
    upsellSuggestion: resolveUpsellSuggestion(profile),
  };
}
