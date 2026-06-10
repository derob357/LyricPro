// Phase 5c — Dual-path variant reader.
//
// The game runtime expects a song's variants as an ordered array of
// `{ prompt, answer, distractors, sectionType }` records. Two backing
// stores:
//
//   - LEGACY (default):  `songs.lyricVariants` jsonb. Read directly from
//                        the in-memory song row, zero extra DB hits.
//   - LAYER 3 (flagged): JOIN of `gameplay_items` and `lyric_moments`,
//                        filtered to qa_status='passed', is_active=true,
//                        moment.approval_status='approved'. One extra
//                        round-trip per `getNextSong` plus per-call paths
//                        in submitAnswer / useHint.
//
// Read-path symmetry guarantee
// ────────────────────────────
// `submitAnswer` and `useHint` resolve a stored
// `song_displays.variantIndex` back into a variant via this array. The two
// paths MUST produce the same variant at the same index. Verified
// 2026-05-05 across all 2,035 active+approved songs / 6,030 variant
// positions: prompt + answer + distractors are byte-identical between
// paths. (sectionType is part of the SongVariant type but is never read by
// any runtime caller — see `scripts/verify-symmetry.tmp.mjs` audit.)
//
// Ordering rule: layer-3 reads order by `gameplay_items.id ASC` because the
// backfill (`scripts/backfill-three-layer.mjs`) inserts items in
// `lyricVariants[i]` order. Postgres serial ids therefore preserve the
// original variant index. Subsequent rebackfills or hand-edits MUST honor
// this rule or the index→variant resolution silently desyncs.

import type { Song } from "../../drizzle/schema";

// NOTE(difficulty): per-variant difficulty lives in this jsonb (the layer
// gameplay reads by default). gameplay_items.difficulty (layer 3) is NOT
// synced here — layer 3 is flag-off with a known drift issue; sync belongs
// to the Phase 5c effort.
export type Variant = {
  prompt: string;
  answer: string;
  distractors: string[];
  sectionType: string;
  difficulty?: "low" | "medium" | "high";
};

// Pure, sync legacy reader — same semantics as the old `variantsOf` helper
// in `server/routers/game.ts`. Falls back to the legacy single-line columns
// if the jsonb is empty so songs without backfilled variants still play.
export function variantsFromLegacy(song: Song): Variant[] {
  if (Array.isArray(song.lyricVariants) && song.lyricVariants.length > 0) {
    return song.lyricVariants as Variant[];
  }
  return [
    {
      prompt: song.lyricPrompt,
      answer: song.lyricAnswer,
      distractors: Array.isArray(song.distractors) ? song.distractors : [],
      sectionType: song.lyricSectionType,
    },
  ];
}

// Async layer-3 reader. Pulls every approved-and-passed gameplay_item for
// the song, ordered by id ASC, and returns the same Variant[] shape the
// rest of the app expects.
//
// db: a lazily-loaded Drizzle instance (the project's `getDb()` return).
// We accept it as `unknown` so this module doesn't pull in the drizzle
// types (keeping it test-friendly). The caller passes `db` from the
// existing `await getDb()` site.
export async function variantsFromLayer3(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  db: any,
  songId: number,
): Promise<Variant[]> {
  if (!db) return [];
  const { sql } = await import("drizzle-orm");
  // Drizzle raw query — keeps us free of importing the table objects from
  // the schema, which would create a small circular-import risk with
  // `game.ts`. The (gameplay_items.song_id) and (lyric_moments.id PK)
  // indexes carry this query without a sequential scan.
  const rows = await db.execute(sql`
    SELECT
      g.prompt_text       AS prompt,
      g.correct_answer    AS answer,
      g.distractor_1      AS d1,
      g.distractor_2      AS d2,
      g.distractor_3      AS d3,
      m.section_type      AS section_type
    FROM gameplay_items g
    JOIN lyric_moments m ON m.id = g.lyric_moment_id
    WHERE g.song_id = ${songId}
      AND g.qa_status = 'passed'
      AND g.is_active = true
      AND m.approval_status = 'approved'
    ORDER BY g.id ASC
  `);

  // postgres-js / drizzle returns rows as an array-like. Normalize via
  // Array.from so the loop is unambiguously over a Variant-shaped array.
  const out: Variant[] = [];
  const arr = Array.from(rows as ArrayLike<Record<string, unknown>>);
  for (const r of arr) {
    const distractors = [r.d1, r.d2, r.d3]
      .filter((d): d is string => typeof d === "string" && d.length > 0);
    out.push({
      prompt: typeof r.prompt === "string" ? r.prompt : "",
      answer: typeof r.answer === "string" ? r.answer : "",
      distractors,
      sectionType: typeof r.section_type === "string" ? r.section_type : "",
    });
  }
  return out;
}

// Top-level dispatcher used by the game router. Switches on the resolved
// `READ_FROM_LAYER3` flag at call time.
//
// Note: `READ_FROM_LAYER3` is read via `import()` so tests can flip the env
// var, call `vi.resetModules()`, and re-import to exercise both paths.
//
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export async function variantsForSong(db: any, song: Song): Promise<Variant[]> {
  const { READ_FROM_LAYER3 } = await import("./contentReadMode");
  if (READ_FROM_LAYER3) {
    const layer3 = await variantsFromLayer3(db, song.id);
    // Defensive fallback: if a song has no layer-3 rows yet (e.g. a fresh
    // import not yet backfilled), keep gameplay alive by reading legacy.
    // This protects against accidental empty-pool 500s during the cutover
    // window. Once Phase 5d-write writes both stores, this fallback
    // becomes a no-op and can be deleted in 5e.
    if (layer3.length > 0) return layer3;
  }
  return variantsFromLegacy(song);
}

// Batch loader for the getNextSong candidate filter — resolves variants
// for many songs in a single round-trip when the flag is ON. With the flag
// OFF, this is a pure in-memory map build that issues zero DB queries (the
// jsonb is already on the song row). The caller treats the returned Map
// as the source of truth for `variantsOf(song)` during the rest of the
// request, keeping the surrounding code synchronous.
//
// Performance: one SELECT against the indexed (gameplay_items.song_id)
// regardless of pool size, with `song_id IN (...)` matching the existing
// composite indexes the schema design called out (Phase 5b).
export async function loadVariantsForSongs(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  db: any,
  songsList: Song[],
): Promise<Map<number, Variant[]>> {
  const out = new Map<number, Variant[]>();
  const { READ_FROM_LAYER3 } = await import("./contentReadMode");
  if (!READ_FROM_LAYER3) {
    for (const s of songsList) out.set(s.id, variantsFromLegacy(s));
    return out;
  }
  if (songsList.length === 0 || !db) return out;

  const ids = songsList.map((s) => s.id);
  const { sql } = await import("drizzle-orm");
  const rows = await db.execute(sql`
    SELECT
      g.song_id           AS song_id,
      g.id                AS gid,
      g.prompt_text       AS prompt,
      g.correct_answer    AS answer,
      g.distractor_1      AS d1,
      g.distractor_2      AS d2,
      g.distractor_3      AS d3,
      m.section_type      AS section_type
    FROM gameplay_items g
    JOIN lyric_moments m ON m.id = g.lyric_moment_id
    WHERE g.song_id IN ${sql.raw(`(${ids.join(",")})`)}
      AND g.qa_status = 'passed'
      AND g.is_active = true
      AND m.approval_status = 'approved'
    ORDER BY g.song_id ASC, g.id ASC
  `);
  const rowArr = Array.from(rows as ArrayLike<Record<string, unknown>>);
  for (const r of rowArr) {
    const songId = Number(r.song_id);
    if (!Number.isInteger(songId)) continue;
    const distractors = [r.d1, r.d2, r.d3]
      .filter((d): d is string => typeof d === "string" && d.length > 0);
    const v: Variant = {
      prompt: typeof r.prompt === "string" ? r.prompt : "",
      answer: typeof r.answer === "string" ? r.answer : "",
      distractors,
      sectionType: typeof r.section_type === "string" ? r.section_type : "",
    };
    const arr = out.get(songId);
    if (arr) arr.push(v);
    else out.set(songId, [v]);
  }
  // Defensive: any songs with no layer-3 rows fall back to legacy so the
  // candidate pool isn't silently emptied mid-cutover.
  for (const s of songsList) {
    if (!out.has(s.id)) out.set(s.id, variantsFromLegacy(s));
  }
  return out;
}
