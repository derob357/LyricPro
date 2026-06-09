// server/_core/songSelection.ts
// Server-side song picker shared by solo getNextSong and the multiplayer engine.
// Lifted verbatim from game.ts getNextSong's selection core (standard branch).
// Applies the same genre/decade/explicit filters, playability filter, per-identity
// dedup window, and usedSongIds dedup (and over-show weighting) then returns the
// chosen song id and the candidate pool (for distractor building in game.ts).
//
// The custom-pack branch stays in game.ts — it's an ordered serve from a fixed
// list, not a selection problem.

import { and, eq, gte, inArray, notInArray } from "drizzle-orm";
import type { getDb } from "../db";
import { songs, songDisplays, lyricSectionTypeEnum } from "../../drizzle/schema";
import { loadVariantsForSongs } from "./variantReader";
import type { Difficulty } from "./scoring";

// ── Playability helpers (mirrors game.ts) ──────────────────────────────────────
// These are kept local to avoid a circular import. The canonical copy lives in
// game.ts; if the playability rules ever change, update both files (or extract to
// a shared module). The two copies are intentionally identical.

type SongVariant = { prompt: string | null | undefined; answer: string | null | undefined };

function isVariantPlayable(v: SongVariant, difficulty: Difficulty): boolean {
  const prompt = String(v?.prompt ?? "").trim();
  const answer = String(v?.answer ?? "").trim();
  if (!prompt) return false;
  if (difficulty !== "medium") return true;
  const lineWords = (prompt + " " + answer).trim().split(/\s+/).filter(Boolean).length;
  return lineWords >= 6;
}

function playableVariantIndicesFrom(
  variants: SongVariant[],
  difficulty: Difficulty,
): number[] {
  const out: number[] = [];
  for (let i = 0; i < variants.length; i++) {
    if (isVariantPlayable(variants[i], difficulty)) out.push(i);
  }
  return out;
}

// ── Public interface ───────────────────────────────────────────────────────────

export interface SelectSongCriteria {
  genres: string[];
  decades: string[];
  difficulty: "low" | "medium" | "high";
  explicitFilter: boolean;
  usedSongIds: number[];
  /** Optional: auth user id for per-identity dedup window. */
  dedupUserId?: number | null;
  /** Optional: guest token for per-identity dedup window (only used when dedupUserId is null). */
  dedupGuestToken?: string | null;
}

export type SongRow = typeof songs.$inferSelect;

export interface SelectSongResult {
  songId: number;
  /** The full candidate pool used for selection (including the chosen song).
   *  Returned so game.ts can build the distractor pool without an extra DB round-trip. */
  candidateSongs: SongRow[];
  /** Pre-resolved variant map for the candidate pool (standard branch).
   *  Returned so game.ts can use the same map for variant pick without re-fetching. */
  variantMap: Map<number, { prompt: string | null | undefined; answer: string | null | undefined; distractors?: unknown[] }[]>;
}

/**
 * Picks one song from the standard pool for a room round.
 *
 * Applies:
 *  1. Genre / decade / explicit filter + usedSongIds dedup
 *  2. Difficulty-based section-type filter (Low: chorus+hook only)
 *  3. Fallback chain (relax difficulty → allow recycling) so the pool is never
 *     silently empty
 *  4. Playability filter (variants must have a non-empty, long-enough prompt)
 *  5. Per-identity dedup window (10-day / 7-day sliding window; drops gracefully)
 *  6. Weighted random pick (section weights × over-show penalty)
 *
 * Returns `null` when the pool is entirely exhausted (all genre+decade songs
 * have been played AND recycling is disabled by the caller) — callers that
 * throw an error on exhaustion should check for null.
 *
 * Throws with a user-facing message when NO songs exist for the genre+decade
 * combination at all (not a recoverable state).
 */
export async function selectSongForRoom(
  db: NonNullable<Awaited<ReturnType<typeof getDb>>>,
  criteria: SelectSongCriteria,
): Promise<SelectSongResult | null> {
  const { genres, decades, difficulty, explicitFilter, usedSongIds } = criteria;
  const dedupUserId = criteria.dedupUserId ?? null;
  const dedupGuestToken = criteria.dedupGuestToken ?? null;

  // ── Section-type filter + section weights ─────────────────────────────────
  // Low: hooks/choruses only. Medium/High: all sections; differ in fill-in
  // difficulty shown to the player, not in song selection.
  type SectionType = (typeof lyricSectionTypeEnum.enumValues)[number];
  let difficultyFilter: SectionType[];
  let sectionWeights: Record<SectionType, number>;
  if (difficulty === "low") {
    difficultyFilter = ["chorus", "hook"];
    sectionWeights = { chorus: 1, hook: 1, verse: 0, "call-response": 0, bridge: 0 };
  } else {
    difficultyFilter = ["chorus", "hook", "verse", "bridge", "call-response"];
    sectionWeights = { chorus: 1, hook: 1, verse: 3, bridge: 0.3, "call-response": 0.3 };
  }

  // ── Decade parsing: map "1980–1990" labels to year ranges + short forms ───
  // Note: "1980–1990" means the 1980s decade (1980-1989), end year is exclusive
  const decadeYearRanges = decades.map(d => {
    const match = d.match(/(\d{4})[–-](\d{4}|Present)/);
    if (!match) return null;
    const start = parseInt(match[1]);
    // End is exclusive: "1980–1990" covers 1980-1989
    const endRaw = match[2] === "Present" ? new Date().getFullYear() + 1 : parseInt(match[2]);
    const end = endRaw - 1; // inclusive end
    // Derive short-form label: "1980–1990" → "1980s", "2020–Present" → "2020s"
    const shortLabel = `${match[1].slice(0, 3)}0s`;
    return { start, end, longLabel: d, shortLabel };
  }).filter(Boolean) as { start: number; end: number; longLabel: string; shortLabel: string }[];

  // Collect all decadeRange label variants stored in DB for these decades
  const decadeLabels: string[] = [];
  for (const r of decadeYearRanges) {
    decadeLabels.push(r.longLabel);
    decadeLabels.push(r.shortLabel);
  }

  // Helper to filter songs by decade (strict)
  const matchesDecade = (s: SongRow) =>
    decadeLabels.includes(s.decadeRange ?? "") ||
    decadeYearRanges.some(r => s.releaseYear >= r.start && s.releaseYear <= r.end);

  // ── Primary query: genre + difficulty + decade + explicit + usedIds ────────
  let stdCandidateSongs = await db.select().from(songs).where(
    and(
      eq(songs.isActive, true),
      eq(songs.approvalStatus, "approved"),
      inArray(songs.genre, genres),
      inArray(songs.lyricSectionType, difficultyFilter),
      explicitFilter ? eq(songs.explicitFlag, false) : undefined,
      usedSongIds.length > 0 ? notInArray(songs.id, usedSongIds) : undefined,
    )
  );

  // Filter by decade (strict — always enforce selected decades)
  stdCandidateSongs = stdCandidateSongs.filter(matchesDecade);

  if (stdCandidateSongs.length === 0) {
    // Fallback 1: relax difficulty filter but KEEP genre + decade strict.
    // Genre/decade are user intent — never silently swap them.
    let relaxed = await db.select().from(songs).where(
      and(
        eq(songs.isActive, true),
        eq(songs.approvalStatus, "approved"),
        inArray(songs.genre, genres),
        usedSongIds.length > 0 ? notInArray(songs.id, usedSongIds) : undefined,
      )
    );
    relaxed = relaxed.filter(matchesDecade);

    if (relaxed.length === 0) {
      // Fallback 2: allow re-playing previously-used songs within the
      // same genre + decade rather than switching categories.
      let recycled = await db.select().from(songs).where(
        and(
          eq(songs.isActive, true),
          eq(songs.approvalStatus, "approved"),
          inArray(songs.genre, genres),
        )
      );
      recycled = recycled.filter(matchesDecade);
      stdCandidateSongs = recycled;
    } else {
      stdCandidateSongs = relaxed;
    }
  }

  if (stdCandidateSongs.length === 0) {
    const genreLabel = genres.join(" / ");
    const decadeLabel = decades.join(" / ");
    throw new Error(
      `No ${genreLabel} songs available for ${decadeLabel}. Pick a broader selection on the setup screen.`
    );
  }

  // ── Playability filter ─────────────────────────────────────────────────────
  // Drop songs whose variants are all unplayable (empty prompt, or line < 6
  // words on Medium). Without this, the player can land on a hollow "..."
  // question or a too-short snippet.
  //
  // Phase 5c: variants resolve via the feature-flagged reader. With the flag
  // OFF, this is in-memory jsonb (zero extra DB hits). With the flag ON, it's
  // a single `gameplay_items IN (...)` query for the whole pool.
  const diffForFilter = difficulty as Difficulty;
  const variantMap = await loadVariantsForSongs(db, stdCandidateSongs);
  stdCandidateSongs = stdCandidateSongs.filter(
    s => playableVariantIndicesFrom(
      variantMap.get(s.id) ?? [],
      diffForFilter,
    ).length > 0,
  );
  if (stdCandidateSongs.length === 0) {
    throw new Error(
      "No playable songs match the selected genre/decade at this difficulty. Try Hard mode or a broader selection on the setup screen."
    );
  }

  // ── Per-identity dedup window ──────────────────────────────────────────────
  // Exclude songs already shown to THIS user/guest in the last 10 days.
  // If that empties the pool, relax to 7 days. If still empty, drop dedup
  // entirely so we never block the player — preserves the "never empty"
  // guarantee of the fallback chain.
  const songIdsShownSince = async (days: number): Promise<Set<number>> => {
    const cutoff = new Date(Date.now() - days * 24 * 60 * 60 * 1000);
    let rows: { songId: number }[] = [];
    if (dedupUserId !== null) {
      rows = await db
        .select({ songId: songDisplays.songId })
        .from(songDisplays)
        .where(
          and(
            eq(songDisplays.userId, dedupUserId),
            gte(songDisplays.shownAt, cutoff),
          ),
        );
    } else if (dedupGuestToken !== null) {
      rows = await db
        .select({ songId: songDisplays.songId })
        .from(songDisplays)
        .where(
          and(
            eq(songDisplays.guestToken, dedupGuestToken),
            gte(songDisplays.shownAt, cutoff),
          ),
        );
    }
    return new Set(rows.map(r => r.songId));
  };

  if (dedupUserId !== null || dedupGuestToken !== null) {
    const recent10 = await songIdsShownSince(10);
    let dedupedPool = stdCandidateSongs.filter(s => !recent10.has(s.id));
    if (dedupedPool.length === 0) {
      const recent7 = await songIdsShownSince(7);
      dedupedPool = stdCandidateSongs.filter(s => !recent7.has(s.id));
    }
    // If still empty, fall through with the unfiltered pool — the global
    // penalty below still discourages over-shown picks.
    if (dedupedPool.length > 0) {
      stdCandidateSongs = dedupedPool;
    }
  }

  // ── Weighted random pick ───────────────────────────────────────────────────
  // Compute the median displayCount of the candidate pool, then penalize
  // songs above the median exponentially. Songs below or at the median get
  // full section weight; above it decay as 1 / (1 + excessRatio^2).
  // Self-adjusts in thin pools where everything has high plays.
  const displayCounts = stdCandidateSongs
    .map(s => s.displayCount ?? 0)
    .sort((a, b) => a - b);
  const poolMedian = displayCounts.length > 0
    ? displayCounts[Math.floor(displayCounts.length / 2)]
    : 0;
  const medianDivisor = Math.max(poolMedian, 1);

  const weighted = stdCandidateSongs
    .map(s => {
      const sectionW = sectionWeights[(s.lyricSectionType as SectionType)] ?? 0;
      if (sectionW <= 0) return { s, w: 0 };
      const count = s.displayCount ?? 0;
      const excess = count - poolMedian;
      const penalty = excess <= 0
        ? 1
        : 1 / (1 + (excess / medianDivisor) ** 2);
      return { s, w: sectionW * penalty };
    })
    .filter(x => x.w > 0);
  const pickPool = weighted.length > 0
    ? weighted
    : stdCandidateSongs.map(s => ({ s, w: 1 }));
  const totalWeight = pickPool.reduce((acc, x) => acc + x.w, 0);
  let rnd = Math.random() * totalWeight;
  let pickedSong = pickPool[0].s;
  for (const x of pickPool) {
    rnd -= x.w;
    if (rnd <= 0) { pickedSong = x.s; break; }
  }

  return {
    songId: pickedSong.id,
    candidateSongs: stdCandidateSongs,
    variantMap,
  };
}
