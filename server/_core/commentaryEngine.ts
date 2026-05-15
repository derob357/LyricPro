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

  // For each trigger key (most specific first), find matching templates.
  // Pick a random one from the matches to avoid repetition.
  for (const key of triggerKeys) {
    const matches = templates.filter(t => t.triggerKey === key);
    if (matches.length > 0) {
      const pick = matches[Math.floor(Math.random() * matches.length)];
      return fillSlots(pick.text, ctx);
    }
  }

  return null;
}
