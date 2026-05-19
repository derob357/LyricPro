// AI Player Intelligence — Phase 3: Commentary Template Engine
//
// Picks a commentary line from commentary_templates based on round
// outcome + player profile signals. Templates use {slot} placeholders
// filled at resolve time. Returns a single string or null.

import { eq, asc } from "drizzle-orm";
import { commentaryTemplates } from "../../drizzle/schema";
import { getDb } from "../db";
import type { PlayerProfileData } from "./playerProfile";

export interface RoundContext {
  correctCount: number;          // 0-4
  lyricCorrect: boolean;
  titleCorrect: boolean;
  artistCorrect: boolean;
  yearCorrect: boolean;
  passUsed: boolean;
  responseTimeSeconds: number | null;
  genre: string;
  streakCount: number;
  isMultiplayer: boolean;
  isWinner?: boolean;            // set on final round only
  marginPoints?: number;         // difference to 2nd place or 1st
  // Profile may be null for first-time players
  profile: PlayerProfileData | null;
}

// ── Trigger key resolution ──────────────────────────────────────────────────
// Returns an ordered list of triggerKeys to check for this round context.
// More specific keys first, generic fallbacks last.

function resolveTriggerKeys(ctx: RoundContext): string[] {
  const keys: string[] = [];

  if (ctx.passUsed) {
    keys.push("passed");
    return keys;
  }

  // Multiplayer outcomes (final round only)
  if (ctx.isMultiplayer && ctx.isWinner !== undefined) {
    const margin = ctx.marginPoints ?? 0;
    if (ctx.isWinner && margin <= 20) keys.push("mp_close_win");
    else if (ctx.isWinner) keys.push("mp_blowout_win");
    else if (!ctx.isWinner && margin <= 20) keys.push("mp_close_loss");
    else if (!ctx.isWinner) keys.push("mp_blowout_loss");
  }

  const p = ctx.profile;

  if (ctx.correctCount === 4) {
    // Perfect round — specific variants first
    if (p && ctx.streakCount >= 3) keys.push("perfect_streak");
    if (p && p.weakestGenres.includes(ctx.genre)) keys.push("perfect_weak_genre");
    if (ctx.responseTimeSeconds && ctx.responseTimeSeconds < 10) keys.push("perfect_speed");
    // First perfect ever (streak=1 or no profile yet)
    if (!p || ctx.streakCount <= 1) keys.push("perfect_first");
    keys.push("perfect");
  } else if (ctx.correctCount === 3) {
    keys.push("three_correct");
  } else if (ctx.correctCount === 2) {
    keys.push("two_correct");
  } else if (ctx.correctCount === 1) {
    // Specific "only X correct" variants
    if (ctx.artistCorrect && !ctx.lyricCorrect && !ctx.titleCorrect && !ctx.yearCorrect) {
      keys.push("one_correct_artist_only");
    } else if (ctx.yearCorrect && !ctx.lyricCorrect && !ctx.titleCorrect && !ctx.artistCorrect) {
      keys.push("one_correct_year_only");
    } else if (ctx.lyricCorrect && !ctx.titleCorrect && !ctx.artistCorrect && !ctx.yearCorrect) {
      keys.push("one_correct_lyric_only");
    } else if (ctx.titleCorrect && !ctx.lyricCorrect && !ctx.artistCorrect && !ctx.yearCorrect) {
      keys.push("one_correct_title_only");
    }
    keys.push("one_correct");
  } else {
    // 0 correct — specific variants first
    if (p && p.isSpeedPlayer) keys.push("zero_correct_speed");
    if (p && p.isStreakPlayer) keys.push("zero_correct_streak");
    if (p && p.weakestGenres.includes(ctx.genre)) keys.push("zero_correct_genre_mismatch");
    keys.push("zero_correct");
  }

  return keys;
}

// ── Slot filling ────────────────────────────────────────────────────────────

function fillSlots(template: string, ctx: RoundContext): string {
  return template
    .replace(/\{genre\}/g, ctx.genre)
    .replace(/\{responseTime\}/g, ctx.responseTimeSeconds ? ctx.responseTimeSeconds.toFixed(1) : "?")
    .replace(/\{streakCount\}/g, String(ctx.streakCount))
    .replace(/\{margin\}/g, String(ctx.marginPoints ?? 0))
    .replace(/\{correctCount\}/g, String(ctx.correctCount));
}

// ── LLM Commentary (Phase 5) ────────────────────────────────────────────────
// When ANTHROPIC_API_KEY is available, generate a personalized one-liner via
// Claude Haiku. Falls back to template if LLM fails or key is not set.

const LLM_MODEL = "claude-haiku-4-5-20251001";

async function tryLlmCommentary(ctx: RoundContext, templateFallback: string): Promise<string> {
  if (!process.env.ANTHROPIC_API_KEY) return templateFallback;

  try {
    const Anthropic = (await import("@anthropic-ai/sdk")).default;
    const anthropic = new Anthropic({ maxRetries: 2 });

    const p = ctx.profile;
    const profileSnippet = p
      ? `Player profile: strongest genres ${p.strongestGenres.join(", ") || "unknown"}, weakest ${p.weakestGenres.join(", ") || "unknown"}, best stage: ${p.bestStage}, worst: ${p.worstStage}, ${p.isSpeedPlayer ? "fast responder" : "deliberate"}, ${p.isStreakPlayer ? "streak builder" : "inconsistent"}, preferred difficulty: ${p.preferredDifficulty}, ${p.totalGames} total games.`
      : "New player, no profile yet.";

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

    const res = await anthropic.messages.create({
      model: LLM_MODEL,
      max_tokens: 150,
      messages: [{ role: "user", content: prompt }],
    });
    const block = res.content.find((b) => b.type === "text") as { type: "text"; text: string } | undefined;
    const text = block?.text?.trim();
    if (text && text.length > 5 && text.length < 300) return text;
  } catch (err) {
    console.warn("[commentary] LLM failed, using template:", err);
  }

  return templateFallback;
}

// ── Public API ──────────────────────────────────────────────────────────────

export async function resolveCommentary(ctx: RoundContext): Promise<string | null> {
  const db = await getDb();
  if (!db) return null;

  // Fetch all active templates ordered by priority.
  const templates = await db
    .select()
    .from(commentaryTemplates)
    .where(eq(commentaryTemplates.isActive, true))
    .orderBy(asc(commentaryTemplates.priority));

  if (templates.length === 0) return null;

  const triggerKeys = resolveTriggerKeys(ctx);

  // Pick the best template match as a fallback.
  let templateText: string | null = null;
  for (const key of triggerKeys) {
    const matches = templates.filter(t => t.triggerKey === key);
    if (matches.length > 0) {
      const pick = matches[Math.floor(Math.random() * matches.length)];
      templateText = fillSlots(pick.text, ctx);
      break;
    }
  }

  if (!templateText) return null;

  // Try LLM upgrade (uses template as fallback).
  return tryLlmCommentary(ctx, templateText);
}

// ── Game Summary Commentary (Phase 3b) ──────────────────────────────────────

export interface GameSummaryContext {
  totalScore: number;
  rounds: number;
  isMultiplayer: boolean;
  isWinner: boolean;
  margin: number;             // points between 1st and 2nd (or self and 1st)
  genre: string;              // primary genre played
  perfectRounds: number;      // count of 4/4 rounds
  profile: PlayerProfileData | null;
}

function resolveGameTriggerKeys(ctx: GameSummaryContext): string[] {
  const keys: string[] = [];

  // Perfect game (all rounds perfect)
  if (ctx.perfectRounds === ctx.rounds && ctx.rounds > 0) {
    keys.push("game_perfect_game");
  }

  // Multiplayer outcomes
  if (ctx.isMultiplayer) {
    if (ctx.margin <= 20 && ctx.rounds >= 3) keys.push("game_mp_close");
    if (ctx.isWinner) keys.push("game_mp_winner");
    else keys.push("game_mp_loser");
  }

  // Genre mastery / struggle (based on profile)
  const p = ctx.profile;
  if (p) {
    if (p.strongestGenres.includes(ctx.genre)) keys.push("game_genre_master");
    if (p.weakestGenres.includes(ctx.genre)) keys.push("game_genre_struggle");
  }

  // Score-based
  const avgPerRound = ctx.rounds > 0 ? ctx.totalScore / ctx.rounds : 0;
  if (avgPerRound >= 150) keys.push("game_high_score");
  else if (avgPerRound < 50 && ctx.rounds >= 3) keys.push("game_low_score");

  // Solo streak
  if (!ctx.isMultiplayer && ctx.totalScore > 0) keys.push("game_solo_streak");

  // Always have a fallback
  keys.push("game_summary_default");
  return keys;
}

function fillGameSlots(template: string, ctx: GameSummaryContext): string {
  return template
    .replace(/\{totalScore\}/g, String(ctx.totalScore))
    .replace(/\{rounds\}/g, String(ctx.rounds))
    .replace(/\{margin\}/g, String(ctx.margin))
    .replace(/\{genre\}/g, ctx.genre);
}

export async function resolveGameSummaryCommentary(ctx: GameSummaryContext): Promise<string | null> {
  const db = await getDb();
  if (!db) return null;

  const templates = await db
    .select()
    .from(commentaryTemplates)
    .where(eq(commentaryTemplates.isActive, true))
    .orderBy(asc(commentaryTemplates.priority));

  if (templates.length === 0) return null;

  const triggerKeys = resolveGameTriggerKeys(ctx);

  for (const key of triggerKeys) {
    const matches = templates.filter(t => t.triggerKey === key);
    if (matches.length > 0) {
      const pick = matches[Math.floor(Math.random() * matches.length)];
      return fillGameSlots(pick.text, ctx);
    }
  }

  return null;
}
