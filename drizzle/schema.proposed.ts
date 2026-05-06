// drizzle/schema.proposed.ts
//
// PROPOSED ADDITIONS for Phase 5a (Three-Layer Content Schema).
// Not imported anywhere — kept as a side-by-side reference so reviewers can
// compare against drizzle/schema.ts before we cut a real migration.
//
// What's here:
//   - New columns on the existing `songs` table (Layer 1: Song Master)
//   - New `lyric_moments` table (Layer 2: Lyric Moment Bank)
//   - New `gameplay_items` table (Layer 3: Gameplay Item Bank)
//
// What's NOT here:
//   - Migration SQL (lives in docs/phase-5-schema/MIGRATION-PLAN.md)
//   - Drop of the legacy `songs.lyricVariants` jsonb column — that happens in
//     a follow-up migration after the read-path swap and a stability window.
//
// Style notes:
//   - Snake_case in SQL, camelCase in JS via varchar("snake_case") / similar.
//     This matches the rest of the codebase (the existing file mixes
//     "lyricVariants" PG column names because of historical MySQL pedigree;
//     for the NEW tables we adopt clean snake_case PG names).
//   - All new tables use timestamptz, defaultNow(), $onUpdate for updatedAt.
//   - All FK references use integer columns; cascade behavior documented inline
//     and enforced via the ALTER TABLE DDL in MIGRATION-PLAN.md.

import {
  boolean,
  index,
  integer,
  pgEnum,
  pgTable,
  primaryKey,
  serial,
  smallint,
  text,
  timestamp,
  uniqueIndex,
  varchar,
} from "drizzle-orm/pg-core";

// ─── Helpers (mirrored from drizzle/schema.ts) ────────────────────────────────
const updatedAtColumn = () =>
  timestamp("updated_at", { withTimezone: true })
    .defaultNow()
    .notNull()
    .$onUpdate(() => new Date());
const createdAtColumn = () =>
  timestamp("created_at", { withTimezone: true }).defaultNow().notNull();

// ─── New enums ────────────────────────────────────────────────────────────────
//
// licensing_status — gates whether actual lyric text may be displayed in
// production. The Song Master row can exist as "pending" / "internal_only"
// while we negotiate; gameplay_items derived from it will be hidden until
// the song flips to "cleared".
export const licensingStatusEnum = pgEnum("licensing_status", [
  "pending",
  "in_review",
  "cleared",
  "internal_only",
  "rejected",
]);

// candidate_use_case — what gameplay surface the moment is being curated for.
// A moment can target multiple surfaces; this enum tags the PRIMARY surface
// and the four boolean fit flags below capture multi-surface fit.
export const candidateUseCaseEnum = pgEnum("candidate_use_case", [
  "song_id",
  "artist_id",
  "year_id",
  "finish_the_lyric",
  "multi_surface",
]);

// question_type / prompt_format — describe the gameplay item.
// question_type is the WHAT (song id, artist id, year id, finish-the-lyric).
// prompt_format is the HOW (multiple_choice vs typed). The current game
// supports MC for distractors and typed for free entry; both stay supported.
export const questionTypeEnum = pgEnum("question_type", [
  "song_identification",
  "artist_identification",
  "year_identification",
  "finish_the_lyric",
]);
export const promptFormatEnum = pgEnum("prompt_format", [
  "multiple_choice",
  "typed",
  "voice",
]);

// qa_status — separate from approval_status. approval_status (existing enum)
// gates curatorial sign-off; qa_status flags last-mile sanity checks
// (distractor uniqueness, year tolerance sanity, casing fixes).
export const qaStatusEnum = pgEnum("qa_status", [
  "pending",
  "passed",
  "needs_fix",
  "blocked",
]);

// ─── Layer 1: Song Master (NEW COLUMNS on existing `songs` table) ─────────────
//
// Conceptually the existing `songs` table IS the Song Master. We're adding
// the missing brief fields. Drizzle code below is a partial table definition
// showing ONLY the new columns; the actual schema.ts edit will splice these
// into the existing pgTable("songs", { ... }) block.
//
// New columns:
//   - featuredArtist: nullable; primary artist stays in artistName
//   - licensingStatus: defaults to "internal_only" so legacy rows are safe
//   - approvedForGame: bool, defaults true for legacy rows (curator flips)
//   - inCuratedBank: marks the 400-song bank-A set + future curated tiers
//   - notes: free-text curator notes at the song level
//
// The existing `approvalStatus` (pgEnum, default "approved") is reused —
// we don't need a second song-level approval column.
export const songsAdditions = {
  featuredArtist: varchar("featured_artist", { length: 256 }), // null = no feature
  licensingStatus: licensingStatusEnum("licensing_status")
    .default("internal_only")
    .notNull(),
  approvedForGame: boolean("approved_for_game").default(true).notNull(),
  inCuratedBank: boolean("in_curated_bank").default(false).notNull(),
  curatorNotes: text("curator_notes"),
};

// ─── Layer 2: Lyric Moment Bank ───────────────────────────────────────────────
//
// One row per CANDIDATE lyric moment. A song typically has 3–10 candidates;
// only a subset reach gameplay_items. Scoring fields are 1–5 (smallint with
// CHECK constraints applied via DDL — drizzle-orm doesn't natively express
// numeric CHECK, so the migration SQL adds them).
//
// The four `*_fit` booleans flag which gameplay surfaces the moment can
// support; the three difficulty `*_fit` booleans flag which difficulty tiers
// it suits. These are the brief's required fields verbatim.
//
// `overall_playability_score` is a Postgres GENERATED column computed from
// the eight 1-5 scores using the brief's weights:
//     0.20*recognition + 0.15*lyric_vividness + 0.15*artist_fingerprint
//   + 0.15*sayability + 0.15*social_recognition + 0.05*era_signal
//   + 0.10*question_variety - (ambiguity_risk * 0.03)
// Result range ≈ [0.85, 4.85]. Materialized in DB so SELECTs can ORDER BY it
// without recomputation. drizzle-orm doesn't model GENERATED columns; the
// MIGRATION-PLAN expresses this in raw SQL.
export const lyricMoments = pgTable(
  "lyric_moments",
  {
    id: serial("id").primaryKey(), // = lyric_moment_id in the brief
    songId: integer("song_id").notNull(), // FK → songs.id (ON DELETE CASCADE)
    sectionType: varchar("section_type", { length: 32 }).notNull(),
    // We keep this as varchar (not the existing lyricSectionType pgEnum) so
    // curators can use richer labels without an enum migration each time.
    // Values are constrained by application validation, not DB enum.
    sectionOrder: smallint("section_order"), // 1-indexed position in track
    candidateUseCase: candidateUseCaseEnum("candidate_use_case").notNull(),

    // Lyric text snapshot. The actual displayable lyric line. Sourced from
    // licensed text once licensing_status = "cleared"; before then this
    // mirrors the existing seed data so we can keep playing.
    lyricText: text("lyric_text").notNull(), // the full line/moment text
    lyricBefore: text("lyric_before"), // optional context before the moment
    lyricAfter: text("lyric_after"), // optional context after

    // Difficulty fit flags (independent — a moment can suit multiple tiers)
    lowFit: boolean("low_fit").default(false).notNull(),
    mediumFit: boolean("medium_fit").default(false).notNull(),
    hardFit: boolean("hard_fit").default(false).notNull(),

    // Surface fit flags
    songRecognitionFit: boolean("song_recognition_fit").default(false).notNull(),
    artistRecognitionFit: boolean("artist_recognition_fit")
      .default(false)
      .notNull(),
    yearFit: boolean("year_fit").default(false).notNull(),
    finishTheLyricFit: boolean("finish_the_lyric_fit").default(false).notNull(),

    // Scoring rubric (1-5 each). NULL until scored.
    // CHECK (col BETWEEN 1 AND 5) added in migration SQL.
    cueObviousnessScore: smallint("cue_obviousness_score"),
    lyricVividnessScore: smallint("lyric_vividness_score"),
    artistFingerprintScore: smallint("artist_fingerprint_score"),
    sayabilityScore: smallint("sayability_score"),
    socialRecognitionScore: smallint("social_recognition_score"),
    eraSignalScore: smallint("era_signal_score"),
    questionVarietyScore: smallint("question_variety_score"),
    ambiguityRiskScore: smallint("ambiguity_risk_score"),

    // GENERATED column — defined in DDL, not in drizzle.
    // Drizzle reads it back as a number. We declare it as a regular numeric
    // column here for type inference; the migration SQL adds GENERATED ALWAYS.
    // Do NOT INSERT/UPDATE this column from app code.
    overallPlayabilityScore: smallint("overall_playability_score"),
    // ^ stored as smallint*100 (i.e. 285 = 2.85). Keeps the column int-typed
    //   and avoids floating-point ORDER BY surprises.

    reviewerNotes: text("reviewer_notes"),
    approvalStatus: varchar("approval_status", { length: 16 })
      .default("pending")
      .notNull(),
    // ^ reuses the existing approval_status enum semantics
    //   ("pending" | "approved" | "rejected") but as varchar to avoid
    //   coupling Layer 2 review state to the existing songs.approval_status
    //   enum (which has a different semantic — song-level publish).

    approvedBy: integer("approved_by"), // FK → users.id, nullable
    approvedAt: timestamp("approved_at", { withTimezone: true }),

    createdAt: createdAtColumn(),
    updatedAt: updatedAtColumn(),
  },
  (t) => ({
    songIdIdx: index("lyric_moments_song_id_idx").on(t.songId),
    approvalStatusIdx: index("lyric_moments_approval_status_idx").on(
      t.approvalStatus,
    ),
    // Pull "best moments per song" queries. Composite so the planner can
    // ORDER BY overall_playability_score DESC after filtering by song.
    songScoreIdx: index("lyric_moments_song_score_idx").on(
      t.songId,
      t.overallPlayabilityScore,
    ),
    // Prevents accidental duplicate moments for the same song. Matching is
    // by (song_id, lyric_text) — same line, same song = same moment.
    songLyricUnique: uniqueIndex("lyric_moments_song_lyric_unique").on(
      t.songId,
      t.lyricText,
    ),
  }),
);

export type LyricMoment = typeof lyricMoments.$inferSelect;
export type InsertLyricMoment = typeof lyricMoments.$inferInsert;

// ─── Layer 3: Gameplay Item Bank ──────────────────────────────────────────────
//
// One row per APPROVED gameplay prompt. Derived from a lyric_moment but with
// concrete, gameplay-ready fields: the exact prompt text, the correct answer,
// three distractors, the difficulty tier, the question type, and qa_status.
//
// A single lyric_moment can spawn multiple gameplay_items (e.g. one for
// finish_the_lyric on Hard, one for song_id on Medium). difficulty here is
// EXPLICIT — not inferred from a flag soup the way the current code does
// `playableVariantIndicesOf(song, difficulty)`.
//
// year_tolerance: integer years either side that count as a "close" match
// for year_identification items. The existing scoreYear() in game.ts uses
// hardcoded 0/2/3; storing tolerance per-item lets us tune individual songs
// without code changes.
export const gameplayItems = pgTable(
  "gameplay_items",
  {
    id: serial("id").primaryKey(), // = item_id in the brief
    lyricMomentId: integer("lyric_moment_id").notNull(), // FK → lyric_moments.id
    songId: integer("song_id").notNull(), // FK → songs.id (denorm for hot-path joins)

    difficulty: varchar("difficulty", { length: 8 }).notNull(),
    // ^ "low" | "medium" | "high" — re-uses existing difficultyEnum semantics
    //   but as varchar to keep the migration smaller (drizzle's pgEnum is
    //   shared with songs.difficulty; we ALTER COLUMN it in the migration
    //   if we want strict enum here too).

    questionType: questionTypeEnum("question_type").notNull(),
    promptFormat: promptFormatEnum("prompt_format")
      .default("multiple_choice")
      .notNull(),

    promptText: text("prompt_text").notNull(),
    // ^ the displayable prompt — e.g. "Don't push me 'cause" for finish_the_lyric,
    //   or "Which song contains this lyric: 'I'm close to the edge'" for song_id

    correctAnswer: text("correct_answer").notNull(),
    distractor1: text("distractor_1"),
    distractor2: text("distractor_2"),
    distractor3: text("distractor_3"),

    yearTolerance: smallint("year_tolerance"), // null unless questionType=year_identification

    qaStatus: qaStatusEnum("qa_status").default("pending").notNull(),
    qaNotes: text("qa_notes"),

    isActive: boolean("is_active").default(true).notNull(),
    // ^ kill-switch separate from qa_status so curator can hot-disable a
    //   bad item without changing its review trail.

    timesShown: integer("times_shown").default(0).notNull(),
    // ^ analytics / dedup helper. Not authoritative — song_displays still is.

    createdAt: createdAtColumn(),
    updatedAt: updatedAtColumn(),
  },
  (t) => ({
    momentIdIdx: index("gameplay_items_moment_id_idx").on(t.lyricMomentId),
    songIdIdx: index("gameplay_items_song_id_idx").on(t.songId),
    // The hot-path query getNextSong uses: "give me a playable item for
    // (song, difficulty, question_type)". This composite covers it.
    songDiffTypeIdx: index("gameplay_items_song_diff_type_idx").on(
      t.songId,
      t.difficulty,
      t.questionType,
    ),
    activeIdx: index("gameplay_items_active_idx").on(t.isActive, t.qaStatus),
  }),
);

export type GameplayItem = typeof gameplayItems.$inferSelect;
export type InsertGameplayItem = typeof gameplayItems.$inferInsert;
