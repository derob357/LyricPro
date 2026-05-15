// AI Player Intelligence — Phase 2: DB-Driven Suggestion Resolver
//
// Reads active suggestion_rules from the DB, evaluates each rule's
// triggerKey against the player profile, fills template slots, and
// returns the highest-priority match per category (mode, upsell).

import { eq, asc } from "drizzle-orm";
import type { PlayerProfileData } from "./playerProfile";
import { suggestionRules } from "../../drizzle/schema";
import type { SuggestionRule } from "../../drizzle/schema";
import { getDb } from "../db";

export interface Suggestion {
  id: string;
  text: string;
  action: string;
  category: "mode" | "upsell";
}

export interface SuggestionResult {
  gameModeSuggestion: Suggestion | null;
  upsellSuggestion: Suggestion | null;
}

// ── Trigger condition evaluators ────────────────────────────────────────────
// Each triggerKey maps to a function that returns true if the rule should fire.

type ConditionFn = (p: PlayerProfileData) => boolean;

const triggerConditions: Record<string, ConditionFn> = {
  "nudge-medium": (p) =>
    p.preferredDifficulty === "low" && p.totalGames >= 5 && p.strongestGenres.length > 0,
  "try-multiplayer": (p) =>
    p.totalGames >= 10 && !p.hasTriedMultiplayer,
  "try-team": (p) =>
    p.hasTriedMultiplayer && !p.hasTriedTeamMode && p.totalGames >= 8,
  "try-new-genre": (p) =>
    p.genreDiversity < 0.3 && p.totalGames >= 8 && p.strongestGenres.length > 0 &&
    p.weakestGenres.length > 0 && p.weakestGenres[0] !== p.strongestGenres[0],
  "mix-genres": (p) =>
    p.genreDiversity < 0.3 && p.totalGames >= 8 && p.strongestGenres.length > 0,
  "try-speed-bonus": (p) =>
    p.isStreakPlayer && p.totalGames >= 10,
  "welcome-back": (p) =>
    p.daysSinceLastGame >= 7,
  "try-marathon": (p) =>
    p.avgSessionGames >= 3 && p.totalGames >= 5,
  "nudge-high": (p) =>
    p.difficultyProgression === "climbing" && p.preferredDifficulty === "medium",
  "upsell-golden-notes": (p) =>
    p.consecutiveDaysPlayed >= 3 && p.goldenNotesBalance <= 2 && p.totalGames >= 10,
  "spend-golden-notes": (p) =>
    p.goldenNotesBalance >= 5 && p.goldenNotesSpent === 0 && p.totalGames >= 5,
  "practice-pack": (p) =>
    p.weakestGenres.length > 0 && p.totalGames >= 15,
};

// ── Template slot filling ───────────────────────────────────────────────────

function fillSlots(template: string, p: PlayerProfileData): string {
  return template
    .replace(/\{strongGenre\}/g, p.strongestGenres[0] ?? "your best genre")
    .replace(/\{weakGenre\}/g, p.weakestGenres[0] ?? "a new genre")
    .replace(/\{gnBalance\}/g, String(p.goldenNotesBalance))
    .replace(/\{totalGames\}/g, String(p.totalGames))
    .replace(/\{preferredDifficulty\}/g, p.preferredDifficulty)
    .replace(/\{bestStage\}/g, p.bestStage)
    .replace(/\{worstStage\}/g, p.worstStage);
}

function fillActionSlots(action: string, p: PlayerProfileData): string {
  return action
    .replace(/\{weakGenre\}/g, encodeURIComponent(p.weakestGenres[0] ?? ""))
    .replace(/\{strongGenre\}/g, encodeURIComponent(p.strongestGenres[0] ?? ""));
}

// ── Public API ──────────────────────────────────────────────────────────────

export async function resolveSuggestions(profile: PlayerProfileData): Promise<SuggestionResult> {
  const db = await getDb();
  if (!db) return { gameModeSuggestion: null, upsellSuggestion: null };

  const rules = await db
    .select()
    .from(suggestionRules)
    .where(eq(suggestionRules.isActive, true))
    .orderBy(asc(suggestionRules.priority));

  let gameModeSuggestion: Suggestion | null = null;
  let upsellSuggestion: Suggestion | null = null;

  for (const rule of rules) {
    const condFn = triggerConditions[rule.triggerKey];
    if (!condFn || !condFn(profile)) continue;

    const suggestion: Suggestion = {
      id: rule.triggerKey,
      text: fillSlots(rule.text, profile),
      action: fillActionSlots(rule.action, profile),
      category: rule.category,
    };

    if (rule.category === "mode" && !gameModeSuggestion) {
      gameModeSuggestion = suggestion;
    } else if (rule.category === "upsell" && !upsellSuggestion) {
      upsellSuggestion = suggestion;
    }

    if (gameModeSuggestion && upsellSuggestion) break;
  }

  return { gameModeSuggestion, upsellSuggestion };
}
