import {
  bigint,
  boolean,
  doublePrecision,
  index,
  integer,
  jsonb,
  pgEnum,
  pgSchema,
  pgTable,
  primaryKey,
  serial,
  smallint,
  text,
  timestamp,
  uniqueIndex,
  uuid,
  varchar,
} from "drizzle-orm/pg-core";

// ─── Enums ────────────────────────────────────────────────────────────────────
// Postgres requires enums be declared once at the top level and referenced by
// name. Drizzle creates the CREATE TYPE statements automatically via
// migrations. Enum values stay identical to the MySQL versions.
export const userRoleEnum = pgEnum("user_role", ["user", "admin"]);
export const lyricSectionTypeEnum = pgEnum("lyric_section_type", [
  "chorus",
  "hook",
  "verse",
  "call-response",
  "bridge",
]);
export const difficultyEnum = pgEnum("difficulty", ["low", "medium", "high"]);
export const approvalStatusEnum = pgEnum("approval_status", [
  "pending",
  "approved",
  "rejected",
]);
export const gameModeEnum = pgEnum("game_mode", [
  "solo",
  "multiplayer",
  "team",
  "remote_live",
]);
export const rankingModeEnum = pgEnum("ranking_mode", [
  "total_points",
  "speed_bonus",
  "streak_bonus",
]);
export const gameStatusEnum = pgEnum("game_status", [
  "waiting",
  "active",
  "finished",
]);
export const answerMethodEnum = pgEnum("answer_method", ["typed", "voice"]);
export const prizePoolStatusEnum = pgEnum("prize_pool_status", [
  "active",
  "paused",
  "closed",
]);
export const payoutStatusEnum = pgEnum("payout_status", [
  "pending",
  "processing",
  "completed",
  "failed",
]);
export const stripeAccountStatusEnum = pgEnum("stripe_account_status", [
  "pending",
  "verified",
  "restricted",
  "disabled",
]);
export const payoutRequestStatusEnum = pgEnum("payout_request_status", [
  "pending",
  "approved",
  "rejected",
  "paid",
]);
export const subscriptionTierEnum = pgEnum("subscription_tier", [
  "free",
  "player",
  "pro",
  "elite",
]);
export const subscriptionStatusEnum = pgEnum("subscription_status", [
  "active",
  "paused",
  "canceled",
  "expired",
  "past_due",
  "unpaid",
  "trialing",
  "incomplete",
  "incomplete_expired",
]);
export const entryFeeGameTypeEnum = pgEnum("entry_fee_game_type", [
  "solo",
  "team3",
  "team5",
  "team7",
]);
export const entryFeeGameStatusEnum = pgEnum("entry_fee_game_status", [
  "pending",
  "in_progress",
  "completed",
  "cancelled",
]);
export const addOnPurchaseStatusEnum = pgEnum("addon_purchase_status", [
  "pending",
  "completed",
  "failed",
]);
export const avatarRarityEnum = pgEnum("avatar_rarity", [
  "starter",
  "common",
  "rare",
  "epic",
  "legendary",
]);
export const avatarAcquiredViaEnum = pgEnum("avatar_acquired_via", [
  "starter",
  "purchase",
  "admin_grant",
]);

// ─── Three-layer content schema enums (Phase 5b) ─────────────────────────────
// licensing_status — gates whether actual lyric text may be displayed in
// production. The Song Master row can exist as "pending" / "internal_only"
// while licensing is negotiated; gameplay items derived from it are hidden
// until the parent song flips to "cleared".
export const licensingStatusEnum = pgEnum("licensing_status", [
  "pending",
  "in_review",
  "cleared",
  "internal_only",
  "rejected",
]);

// candidate_use_case — what gameplay surface the moment is curated for.
// A moment can target multiple surfaces; this enum tags the PRIMARY surface
// while the four surface-fit boolean columns capture multi-surface fit.
export const candidateUseCaseEnum = pgEnum("candidate_use_case", [
  "song_id",
  "artist_id",
  "year_id",
  "finish_the_lyric",
  "multi_surface",
]);

// question_type / prompt_format — describe the gameplay item.
// question_type is the WHAT (song id, artist id, year id, finish-the-lyric).
// prompt_format is the HOW (multiple_choice / typed / voice).
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

// qa_status — last-mile sanity check on the gameplay item itself
// (distractor uniqueness, year-tolerance sanity, prompt typo check).
// Distinct from approval_status, which gates curatorial sign-off on the
// parent moment.
export const qaStatusEnum = pgEnum("qa_status", [
  "pending",
  "passed",
  "needs_fix",
  "blocked",
]);

export const lyricSourceProviderEnum = pgEnum("lyric_source_provider", [
  "internal",
  "lyricfind",
  "musixmatch",
  "direct_publisher",
]);

export const commercialModelEnum = pgEnum("commercial_model", [
  "free",
  "subscription",
  "ad_supported",
  "entry_fee",
]);

// Shared helper: all tables with an `updatedAt` use Drizzle's $onUpdate to
// mirror MySQL's `ON UPDATE CURRENT_TIMESTAMP`. Postgres has no native
// equivalent — the ORM layer rewrites the value on every UPDATE issued
// through Drizzle. Raw SQL outside Drizzle must set `updatedAt` explicitly.
const updatedAtColumn = () =>
  timestamp("updatedAt", { withTimezone: true })
    .defaultNow()
    .notNull()
    .$onUpdate(() => new Date());
const createdAtColumn = () =>
  timestamp("createdAt", { withTimezone: true }).defaultNow().notNull();

// Snake_case variants — for tables whose migrations declared `created_at` /
// `updated_at` (genres, banners, suggestion_rules, commentary_templates).
// Without this mapping, `db.select().from(<table>)` issues SQL referencing
// `"createdAt"` and the query 500s because the actual column is `created_at`.
const createdAtSnakeColumn = () =>
  timestamp("created_at", { withTimezone: true }).defaultNow().notNull();
const updatedAtSnakeColumn = () =>
  timestamp("updated_at", { withTimezone: true })
    .defaultNow()
    .notNull()
    .$onUpdate(() => new Date());

// ─── Users ────────────────────────────────────────────────────────────────────
export const users = pgTable("users", {
  id: serial("id").primaryKey(),
  openId: varchar("openId", { length: 64 }).notNull().unique(),
  name: text("name"),
  firstName: varchar("firstName", { length: 128 }),
  lastName: varchar("lastName", { length: 128 }),
  email: varchar("email", { length: 320 }),
  loginMethod: varchar("loginMethod", { length: 64 }),
  role: userRoleEnum("role").default("user").notNull(),
  avatarUrl: text("avatarUrl"),
  equippedAvatarId: integer("equippedAvatarId"),
  // Stats
  lifetimeScore: integer("lifetimeScore").default(0).notNull(),
  totalWins: integer("totalWins").default(0).notNull(),
  gamesPlayed: integer("gamesPlayed").default(0).notNull(),
  rankTier: varchar("rankTier", { length: 32 }).default("Rookie").notNull(),
  premiumStatus: boolean("premiumStatus").default(false).notNull(),
  favoriteGenre: varchar("favoriteGenre", { length: 64 }),
  strongestDecade: varchar("strongestDecade", { length: 32 }),
  currentStreak: integer("currentStreak").default(0).notNull(),
  longestStreak: integer("longestStreak").default(0).notNull(),
  lyricAccuracy: doublePrecision("lyricAccuracy").default(0),
  artistAccuracy: doublePrecision("artistAccuracy").default(0),
  yearAccuracy: doublePrecision("yearAccuracy").default(0),
  gamePrefs: jsonb("gamePrefs").$type<{
    mode: "solo" | "multiplayer" | "team";
    genres: string[];
    decades: string[];
    difficulty: "low" | "medium" | "high";
    timerSeconds: number;
    rounds: number;
    explicitFilter: boolean;
  }>(),
  createdAt: createdAtColumn(),
  updatedAt: updatedAtColumn(),
  lastSignedIn: timestamp("lastSignedIn", { withTimezone: true })
    .defaultNow()
    .notNull(),
});

export type User = typeof users.$inferSelect;
export type InsertUser = typeof users.$inferInsert;

// ─── Guest Sessions ───────────────────────────────────────────────────────────
export const guestSessions = pgTable("guest_sessions", {
  id: serial("id").primaryKey(),
  sessionToken: varchar("sessionToken", { length: 128 }).notNull().unique(),
  nickname: varchar("nickname", { length: 64 }).notNull(),
  createdAt: createdAtColumn(),
});

export type GuestSession = typeof guestSessions.$inferSelect;

// ─── Artist Metadata ──────────────────────────────────────────────────────────
export const artistMetadata = pgTable("artist_metadata", {
  id: serial("id").primaryKey(),
  artistName: varchar("artistName", { length: 256 }).notNull(),
  aliases: text("aliases"), // JSON array of alias strings (stored as text)
  officialWebsite: text("officialWebsite"),
  instagramUrl: text("instagramUrl"),
  facebookUrl: text("facebookUrl"),
  xUrl: text("xUrl"),
  tiktokUrl: text("tiktokUrl"),
  youtubeUrl: text("youtubeUrl"),
  spotifyUrl: text("spotifyUrl"),
  appleMusicUrl: text("appleMusicUrl"),
  newsSearchUrl: text("newsSearchUrl"),
  isActive: boolean("isActive").default(true).notNull(),
  createdAt: createdAtColumn(),
});

export type ArtistMetadata = typeof artistMetadata.$inferSelect;

// ─── Genres (managed reference table) ────────────────────────────────────────
export const genres = pgTable("genres", {
  id: serial("id").primaryKey(),
  name: varchar("name", { length: 64 }).notNull(),
  parentId: integer("parent_id"),
  isActive: boolean("is_active").default(true).notNull(),
  sortOrder: integer("sort_order").default(100).notNull(),
  createdAt: createdAtSnakeColumn(),
});

export type Genre = typeof genres.$inferSelect;

// ─── Songs ────────────────────────────────────────────────────────────────────
export const songs = pgTable("songs", {
  id: serial("id").primaryKey(),
  title: varchar("title", { length: 256 }).notNull(),
  artistName: varchar("artistName", { length: 256 }).notNull(),
  artistMetadataId: integer("artistMetadataId"),
  genre: varchar("genre", { length: 64 }).notNull(),
  subgenre: varchar("subgenre", { length: 64 }),
  releaseYear: integer("releaseYear").notNull(),
  decadeRange: varchar("decadeRange", { length: 32 }).notNull(),
  lyricPrompt: text("lyricPrompt").notNull(),
  lyricAnswer: text("lyricAnswer").notNull(),
  distractors: jsonb("distractors").$type<string[]>(),
  // Per-song lyric variants. Each entry is a complete question
  // ({prompt, answer, distractors, sectionType}). Populated by
  // scripts/seed-lyric-variants.mjs (variant[0] from legacy columns) and
  // scripts/generate-lyric-variants.mjs (LLM-rewritten variants[1..]).
  // getNextSong picks an unseen variant per user within the dedup window
  // so the same song can be re-shown with a different lyric line.
  lyricVariants: jsonb("lyricVariants").$type<
    Array<{
      prompt: string;
      answer: string;
      distractors: string[];
      sectionType: string;
    }>
  >(),
  lyricSectionType: lyricSectionTypeEnum("lyricSectionType").notNull(),
  difficulty: difficultyEnum("difficulty").notNull(),
  language: varchar("language", { length: 16 }).default("en").notNull(),
  explicitFlag: boolean("explicitFlag").default(false).notNull(),
  approvalStatus: approvalStatusEnum("approvalStatus")
    .default("approved")
    .notNull(),
  isActive: boolean("isActive").default(true).notNull(),
  // ── Phase 5b additions (three-layer content schema, song-master fields) ──
  // featured_artist: nullable; primary artist stays in artistName.
  featuredArtist: varchar("featured_artist", { length: 256 }),
  // licensing_status: defaults to internal_only so legacy rows are safe.
  // Curator flips to cleared once licensing is in place.
  licensingStatus: licensingStatusEnum("licensing_status")
    .default("internal_only")
    .notNull(),
  // approved_for_game: curatorial publish flag separate from approvalStatus
  // (which is the content-review state) and isActive (operational kill switch).
  // A song appears in gameplay only when isActive AND approvalStatus='approved'
  // AND approvedForGame.
  approvedForGame: boolean("approved_for_game").default(true).notNull(),
  // in_curated_bank: marks the 400-song bank-A set + future curated tiers.
  inCuratedBank: boolean("in_curated_bank").default(false).notNull(),
  // curator_notes: free-text song-level notes from the curator.
  curatorNotes: text("curator_notes"),
  // ── PRO-grade licensing metadata (Phase 0 of admin-audit-and-ddex-logging) ──
  iswc: varchar("iswc", { length: 15 }),
  isrc: varchar("isrc", { length: 15 }),
  songwriters: jsonb("songwriters")
    .$type<Array<{ name: string; share?: number; ipiNumber?: string }>>()
    .default([])
    .notNull(),
  publishers: jsonb("publishers")
    .$type<Array<{ name: string; share?: number; territory?: string }>>()
    .default([])
    .notNull(),
  lyricSourceProvider: lyricSourceProviderEnum("lyric_source_provider")
    .default("internal")
    .notNull(),
  providerTrackId: varchar("provider_track_id", { length: 64 }),
  // Aggregate counters seeded by scripts/backfill-song-displays.mjs and
  // updated transactionally by getNextSong. Used to power the global
  // over-show penalty in selection + the admin usage report. song_displays
  // remains the source of truth — these columns are a denormalized cache.
  displayCount: integer("displayCount").default(0).notNull(),
  lastShownAt: timestamp("lastShownAt", { withTimezone: true }),
  createdAt: createdAtColumn(),
  updatedAt: updatedAtColumn(),
}, (t) => ({
  // Prevents duplicate seeds of the same song. Idempotent re-runs use
  // ON CONFLICT against this index.
  titleArtistUnique: uniqueIndex("songs_title_artist_unique").on(
    t.title,
    t.artistName
  ),
}));

export type Song = typeof songs.$inferSelect;
export type InsertSong = typeof songs.$inferInsert;

// ─── Song Displays ────────────────────────────────────────────────────────────
// Insert-only audit log of every (user|guest, song) display. Drives the
// per-identity 10-day dedup window in getNextSong and the usage report.
// userId XOR guestToken is set per row; both null is invalid (we always
// have at least one identity from the room context).
//
// Indexes are ESSENTIAL for the hot path:
//   - (userId, shownAt)     — dedup query for signed-in players
//   - (guestToken, shownAt) — dedup query for guests
//   - (songId)              — usage report aggregations
export const songDisplays = pgTable(
  "song_displays",
  {
    id: serial("id").primaryKey(),
    songId: integer("songId").notNull(),
    userId: integer("userId"),
    guestToken: varchar("guestToken", { length: 64 }),
    roomCode: varchar("roomCode", { length: 8 }),
    // Placeholder for future per-song lyric-variant rotation. Always 0
    // today; extending later requires no schema change.
    variantIndex: integer("variantIndex").default(0).notNull(),
    shownAt: timestamp("shownAt", { withTimezone: true }).defaultNow().notNull(),
    // ── DDEX-ready event metadata (Phase 0 of admin-audit-and-ddex-logging) ──
    territoryCode: varchar("territory_code", { length: 2 }),
    durationOfUseSeconds: integer("duration_of_use_seconds"),
    lyricFragmentLengthChars: integer("lyric_fragment_length_chars"),
    lyricFragmentLengthLines: integer("lyric_fragment_length_lines"),
    commercialModelType: commercialModelEnum("commercial_model_type")
      .default("free")
      .notNull(),
    serviceDescription: varchar("service_description", { length: 64 })
      .default("lyricpro-web")
      .notNull(),
    grossRevenuePerEventMicros: bigint("gross_revenue_per_event_micros", {
      mode: "number",
    })
      .default(0)
      .notNull(),
    currencyCode: varchar("currency_code", { length: 3 }).default("USD").notNull(),
    attributionServed: varchar("attribution_served", { length: 64 }),
    userIdHashed: varchar("user_id_hashed", { length: 64 }),
    sessionId: varchar("session_id", { length: 64 }),
    // Generated column — Drizzle does not yet support GENERATED in TS DSL,
    // so we declare it as a regular column and the migration SQL converts it.
    // See Task 0.6 for the ALTER TABLE that adds GENERATED ALWAYS AS.
    reportingPeriodYyyymm: varchar("reporting_period_yyyymm", { length: 6 }),
  },
  (t) => ({
    userShownAtIdx: index("song_displays_user_shown_at_idx").on(
      t.userId,
      t.shownAt,
    ),
    guestShownAtIdx: index("song_displays_guest_shown_at_idx").on(
      t.guestToken,
      t.shownAt,
    ),
    songIdIdx: index("song_displays_song_id_idx").on(t.songId),
    reportingPeriodSongIdx: index(
      "song_displays_reporting_period_song_idx"
    ).on(t.reportingPeriodYyyymm, t.songId),
    songIdVariantIdx: index("song_displays_song_id_variant_idx").on(
      t.songId,
      t.variantIndex,
    ),
  }),
);

export type SongDisplay = typeof songDisplays.$inferSelect;
export type InsertSongDisplay = typeof songDisplays.$inferInsert;

// ─── Game Rooms ───────────────────────────────────────────────────────────────
export const gameRooms = pgTable("game_rooms", {
  id: serial("id").primaryKey(),
  roomCode: varchar("roomCode", { length: 8 }).notNull().unique(),
  hostUserId: integer("hostUserId"),
  hostGuestToken: varchar("hostGuestToken", { length: 128 }),
  mode: gameModeEnum("mode").notNull(),
  rankingMode: rankingModeEnum("rankingMode")
    .default("total_points")
    .notNull(),
  timerSeconds: integer("timerSeconds").default(30).notNull(),
  roundsTotal: integer("roundsTotal").default(10).notNull(),
  selectedGenres: text("selectedGenres").notNull(), // JSON string
  selectedDecades: text("selectedDecades").notNull(), // JSON string
  difficulty: difficultyEnum("difficulty").default("medium").notNull(),
  explicitFilter: boolean("explicitFilter").default(false).notNull(),
  status: gameStatusEnum("status").default("waiting").notNull(),
  currentRound: integer("currentRound").default(0).notNull(),
  currentPlayerIndex: integer("currentPlayerIndex").default(0).notNull(),
  currentSongId: integer("currentSongId"),
  usedSongIds: text("usedSongIds"), // JSON array as text, nullable
  customPackSongIds: jsonb("customPackSongIds").$type<number[]>(),
  isVideoRoom: boolean("isVideoRoom").default(false).notNull(),
  videoRoomName: text("videoRoomName"),
  maxPlayers: integer("maxPlayers").default(8).notNull(),
  turnOrder: jsonb("turnOrder").$type<number[] | null>(),
  inviteCode: varchar("inviteCode", { length: 16 }),
  inviteExpiresAt: timestamp("inviteExpiresAt", { withTimezone: true }),
  streakInsurance: boolean("streakInsurance").default(false).notNull(),
  createdAt: createdAtColumn(),
  updatedAt: updatedAtColumn(),
});

export type GameRoom = typeof gameRooms.$inferSelect;
export type InsertGameRoom = typeof gameRooms.$inferInsert;

// ─── Teams ────────────────────────────────────────────────────────────────────
export const teams = pgTable("teams", {
  id: serial("id").primaryKey(),
  roomId: integer("roomId").notNull(),
  teamName: varchar("teamName", { length: 64 }).notNull(),
  teamColor: varchar("teamColor", { length: 16 }).default("#8B5CF6").notNull(),
  currentScore: integer("currentScore").default(0).notNull(),
  createdAt: createdAtColumn(),
});

export type Team = typeof teams.$inferSelect;

// ─── Room Players ─────────────────────────────────────────────────────────────
export const roomPlayers = pgTable("room_players", {
  id: serial("id").primaryKey(),
  roomId: integer("roomId").notNull(),
  userId: integer("userId"),
  guestToken: varchar("guestToken", { length: 128 }),
  guestName: varchar("guestName", { length: 64 }),
  teamId: integer("teamId"),
  joinOrder: integer("joinOrder").default(0).notNull(),
  currentScore: integer("currentScore").default(0).notNull(),
  currentStreak: integer("currentStreak").default(0).notNull(),
  isReady: boolean("isReady").default(false).notNull(),
  isActive: boolean("isActive").default(true).notNull(),
  joinedAt: timestamp("joinedAt", { withTimezone: true })
    .defaultNow()
    .notNull(),
});

export type RoomPlayer = typeof roomPlayers.$inferSelect;

// ─── Game Sessions ────────────────────────────────────────────────────────────
export const gameSessions = pgTable("game_sessions", {
  id: serial("id").primaryKey(),
  roomId: integer("roomId"),
  userId: integer("userId"),
  guestToken: varchar("guestToken", { length: 128 }),
  mode: gameModeEnum("mode").notNull(),
  rankingMode: rankingModeEnum("rankingMode")
    .default("total_points")
    .notNull(),
  finalScore: integer("finalScore").default(0).notNull(),
  placement: integer("placement"),
  startedAt: timestamp("startedAt", { withTimezone: true })
    .defaultNow()
    .notNull(),
  endedAt: timestamp("endedAt", { withTimezone: true }),
});

export type GameSession = typeof gameSessions.$inferSelect;

// ─── Round Results ────────────────────────────────────────────────────────────
export const roundResults = pgTable("round_results", {
  id: serial("id").primaryKey(),
  sessionId: integer("sessionId"),
  roomId: integer("roomId"),
  roundNumber: integer("roundNumber").notNull(),
  activePlayerId: integer("activePlayerId"),
  activeGuestToken: varchar("activeGuestToken", { length: 128 }),
  songId: integer("songId").notNull(),
  userLyricAnswer: text("userLyricAnswer"),
  userArtistAnswer: text("userArtistAnswer"),
  userYearAnswer: integer("userYearAnswer"),
  answerMethod: answerMethodEnum("answerMethod").default("typed").notNull(),
  responseTimeSeconds: doublePrecision("responseTimeSeconds"),
  lyricPoints: integer("lyricPoints").default(0).notNull(),
  artistPoints: integer("artistPoints").default(0).notNull(),
  yearPoints: integer("yearPoints").default(0).notNull(),
  speedBonusPoints: integer("speedBonusPoints").default(0).notNull(),
  streakBonusPoints: integer("streakBonusPoints").default(0).notNull(),
  totalRoundPoints: integer("totalRoundPoints").default(0).notNull(),
  passUsed: boolean("passUsed").default(false).notNull(),
  hintUsed: boolean("hintUsed").default(false).notNull(),
  streakInsuranceUsed: boolean("streakInsuranceUsed").default(false).notNull(),
  createdAt: createdAtColumn(),
});

export type RoundResult = typeof roundResults.$inferSelect;

// ─── Player Profiles (AI Player Intelligence) ────────────────────────────────
export const playerProfiles = pgTable("player_profiles", {
  userId: integer("user_id").primaryKey().references(() => users.id, { onDelete: "cascade" }),
  profile: jsonb("profile").notNull().default({}),
  computedAt: timestamp("computed_at", { withTimezone: true }).defaultNow().notNull(),
  gamesAtCompute: integer("games_at_compute").default(0).notNull(),
});

export type PlayerProfile = typeof playerProfiles.$inferSelect;

// ─── Suggestion Rules (admin-editable, AI Player Intelligence Phase 2) ───────
export const suggestionRuleCategoryEnum = pgEnum("suggestion_rule_category", ["mode", "upsell"]);

export const suggestionRules = pgTable("suggestion_rules", {
  id: serial("id").primaryKey(),
  category: suggestionRuleCategoryEnum("category").notNull(),
  triggerKey: varchar("trigger_key", { length: 64 }).notNull().unique(),
  text: text("text").notNull(),
  action: varchar("action", { length: 256 }).notNull(),
  priority: integer("priority").default(100).notNull(),
  isActive: boolean("is_active").default(true).notNull(),
  createdAt: createdAtSnakeColumn(),
  updatedAt: updatedAtSnakeColumn(),
});

export type SuggestionRule = typeof suggestionRules.$inferSelect;

// ─── Commentary Templates (admin-editable, AI Player Intelligence Phase 3) ───
export const commentaryTemplates = pgTable("commentary_templates", {
  id: serial("id").primaryKey(),
  triggerKey: varchar("trigger_key", { length: 64 }).notNull(),
  text: text("text").notNull(),
  priority: integer("priority").default(100).notNull(),
  isActive: boolean("is_active").default(true).notNull(),
  createdAt: createdAtSnakeColumn(),
  updatedAt: updatedAtSnakeColumn(),
});

export type CommentaryTemplate = typeof commentaryTemplates.$inferSelect;

// ─── Banners (partner/news hero banners) ─────────────────────────────────────
export const banners = pgTable("banners", {
  id: serial("id").primaryKey(),
  title: varchar("title", { length: 256 }).notNull(),
  subtitle: text("subtitle"),
  ctaText: varchar("cta_text", { length: 64 }).default("Learn More").notNull(),
  ctaAction: varchar("cta_action", { length: 512 }).notNull(),
  partnerName: varchar("partner_name", { length: 128 }),
  partnerLogoUrl: varchar("partner_logo_url", { length: 512 }),
  badgeText: varchar("badge_text", { length: 32 }).default("Featured"),
  badgeColor: varchar("badge_color", { length: 7 }).default("#EF4444"),
  imageEmoji: varchar("image_emoji", { length: 8 }),
  imageUrl: varchar("image_url", { length: 512 }),
  audience: varchar("audience", { length: 32 }).default("all").notNull(),
  targetJson: jsonb("target_json").default({}),
  priority: integer("priority").default(100).notNull(),
  isActive: boolean("is_active").default(true).notNull(),
  startsAt: timestamp("starts_at", { withTimezone: true }),
  endsAt: timestamp("ends_at", { withTimezone: true }),
  createdAt: createdAtSnakeColumn(),
  updatedAt: updatedAtSnakeColumn(),
});

export type Banner = typeof banners.$inferSelect;

export const bannerImpressions = pgTable("banner_impressions", {
  id: serial("id").primaryKey(),
  bannerId: integer("banner_id").notNull().references(() => banners.id, { onDelete: "cascade" }),
  userId: integer("user_id"),
  clickedAt: timestamp("clicked_at", { withTimezone: true }),
  shownAt: timestamp("shown_at", { withTimezone: true }).defaultNow().notNull(),
});

// ─── Leaderboard Entries ──────────────────────────────────────────────────────
export const leaderboardEntries = pgTable("leaderboard_entries", {
  id: serial("id").primaryKey(),
  userId: integer("userId"),
  guestName: varchar("guestName", { length: 64 }),
  displayName: varchar("displayName", { length: 64 }).notNull(),
  score: integer("score").notNull(),
  mode: gameModeEnum("mode").notNull(),
  genre: varchar("genre", { length: 64 }),
  decade: varchar("decade", { length: 32 }),
  rankingMode: varchar("rankingMode", { length: 32 }).notNull(),
  createdAt: createdAtColumn(),
});

export type LeaderboardEntry = typeof leaderboardEntries.$inferSelect;

// ─── Prize Pools ──────────────────────────────────────────────────────────────
export const prizePools = pgTable("prize_pools", {
  id: serial("id").primaryKey(),
  name: varchar("name", { length: 256 }).notNull(),
  description: text("description"),
  totalAmount: doublePrecision("totalAmount").notNull(),
  distributedAmount: doublePrecision("distributedAmount").default(0).notNull(),
  remainingAmount: doublePrecision("remainingAmount").notNull(),
  status: prizePoolStatusEnum("status").default("active").notNull(),
  distributionRules: text("distributionRules").notNull(),
  createdAt: createdAtColumn(),
  updatedAt: updatedAtColumn(),
});

export type PrizePool = typeof prizePools.$inferSelect;
export type InsertPrizePool = typeof prizePools.$inferInsert;

// ─── Prize Payouts ────────────────────────────────────────────────────────────
export const prizePayouts = pgTable("prize_payouts", {
  id: serial("id").primaryKey(),
  prizePoolId: integer("prizePoolId").notNull(),
  userId: integer("userId").notNull(),
  amount: doublePrecision("amount").notNull(),
  rank: integer("rank").notNull(),
  reason: varchar("reason", { length: 256 }).notNull(),
  status: payoutStatusEnum("status").default("pending").notNull(),
  stripePayoutId: varchar("stripePayoutId", { length: 256 }),
  failureReason: text("failureReason"),
  createdAt: createdAtColumn(),
  updatedAt: updatedAtColumn(),
});

export type PrizePayout = typeof prizePayouts.$inferSelect;
export type InsertPrizePayout = typeof prizePayouts.$inferInsert;

// ─── Stripe Accounts ──────────────────────────────────────────────────────────
export const stripeAccounts = pgTable("stripe_accounts", {
  id: serial("id").primaryKey(),
  userId: integer("userId").notNull().unique(),
  stripeConnectAccountId: varchar("stripeConnectAccountId", { length: 256 })
    .notNull()
    .unique(),
  status: stripeAccountStatusEnum("status").default("pending").notNull(),
  bankAccountVerified: boolean("bankAccountVerified").default(false).notNull(),
  createdAt: createdAtColumn(),
  updatedAt: updatedAtColumn(),
});

export type StripeAccount = typeof stripeAccounts.$inferSelect;
export type InsertStripeAccount = typeof stripeAccounts.$inferInsert;

// ─── Payout Requests ──────────────────────────────────────────────────────────
export const payoutRequests = pgTable("payout_requests", {
  id: serial("id").primaryKey(),
  userId: integer("userId").notNull(),
  amount: doublePrecision("amount").notNull(),
  status: payoutRequestStatusEnum("status").default("pending").notNull(),
  stripePayoutId: varchar("stripePayoutId", { length: 256 }),
  rejectionReason: text("rejectionReason"),
  createdAt: createdAtColumn(),
  updatedAt: updatedAtColumn(),
});

export type PayoutRequest = typeof payoutRequests.$inferSelect;
export type InsertPayoutRequest = typeof payoutRequests.$inferInsert;

// ─── Subscriptions ────────────────────────────────────────────────────────────
export const subscriptions = pgTable("subscriptions", {
  id: serial("id").primaryKey(),
  userId: integer("userId").notNull().unique(),
  tier: subscriptionTierEnum("tier").default("free").notNull(),
  stripeSubscriptionId: varchar("stripeSubscriptionId", { length: 256 }),
  status: subscriptionStatusEnum("status").default("active").notNull(),
  currentPeriodStart: timestamp("currentPeriodStart", { withTimezone: true }),
  currentPeriodEnd: timestamp("currentPeriodEnd", { withTimezone: true }),
  canceledAt: timestamp("canceledAt", { withTimezone: true }),
  createdAt: createdAtColumn(),
  updatedAt: updatedAtColumn(),
});

export type Subscription = typeof subscriptions.$inferSelect;
export type InsertSubscription = typeof subscriptions.$inferInsert;

// ─── Daily Game Tracking ──────────────────────────────────────────────────────
export const dailyGameTracking = pgTable("daily_game_tracking", {
  id: serial("id").primaryKey(),
  userId: integer("userId").notNull(),
  date: varchar("date", { length: 10 }).notNull(), // YYYY-MM-DD
  gamesPlayedToday: integer("gamesPlayedToday").default(0).notNull(),
  createdAt: createdAtColumn(),
  updatedAt: updatedAtColumn(),
});

export type DailyGameTracking = typeof dailyGameTracking.$inferSelect;
export type InsertDailyGameTracking = typeof dailyGameTracking.$inferInsert;

// ─── Entry Fee Games ──────────────────────────────────────────────────────────
export const entryFeeGames = pgTable("entry_fee_games", {
  id: serial("id").primaryKey(),
  roomId: integer("roomId").notNull(),
  entryFeeAmount: doublePrecision("entryFeeAmount").notNull(),
  gameType: entryFeeGameTypeEnum("gameType").notNull(),
  prizePoolAmount: doublePrecision("prizePoolAmount").notNull(),
  totalEntriesCollected: doublePrecision("totalEntriesCollected").notNull(),
  status: entryFeeGameStatusEnum("status").default("pending").notNull(),
  createdAt: createdAtColumn(),
  completedAt: timestamp("completedAt", { withTimezone: true }),
});

export type EntryFeeGame = typeof entryFeeGames.$inferSelect;
export type InsertEntryFeeGame = typeof entryFeeGames.$inferInsert;

// ─── Entry Fee Participants ───────────────────────────────────────────────────
export const entryFeeParticipants = pgTable("entry_fee_participants", {
  id: serial("id").primaryKey(),
  entryFeeGameId: integer("entryFeeGameId").notNull(),
  userId: integer("userId").notNull(),
  entryFeeAmount: doublePrecision("entryFeeAmount").notNull(),
  finalScore: integer("finalScore").default(0),
  placement: integer("placement"),
  prizeWon: doublePrecision("prizeWon").default(0),
  payoutStatus: payoutStatusEnum("payoutStatus").default("pending").notNull(),
  stripePayoutId: varchar("stripePayoutId", { length: 256 }),
  createdAt: createdAtColumn(),
  updatedAt: updatedAtColumn(),
});

export type EntryFeeParticipant = typeof entryFeeParticipants.$inferSelect;
export type InsertEntryFeeParticipant = typeof entryFeeParticipants.$inferInsert;

// ─── Add-On Game Purchases ────────────────────────────────────────────────────
export const addOnGamePurchases = pgTable("addon_game_purchases", {
  id: serial("id").primaryKey(),
  userId: integer("userId").notNull(),
  quantity: integer("quantity").notNull(),
  pricePerGame: doublePrecision("pricePerGame").notNull(),
  totalAmount: doublePrecision("totalAmount").notNull(),
  stripePaymentIntentId: varchar("stripePaymentIntentId", { length: 256 }),
  status: addOnPurchaseStatusEnum("status").default("pending").notNull(),
  createdAt: createdAtColumn(),
});

export type AddOnGamePurchase = typeof addOnGamePurchases.$inferSelect;
export type InsertAddOnGamePurchase = typeof addOnGamePurchases.$inferInsert;

// ─── User Wallet / Balance ────────────────────────────────────────────────────
export const userWallets = pgTable("user_wallets", {
  id: serial("id").primaryKey(),
  userId: integer("userId").notNull().unique(),
  availableBalance: doublePrecision("availableBalance").default(0).notNull(),
  totalWinnings: doublePrecision("totalWinnings").default(0).notNull(),
  totalPayouts: doublePrecision("totalPayouts").default(0).notNull(),
  lastPayoutDate: timestamp("lastPayoutDate", { withTimezone: true }),
  createdAt: createdAtColumn(),
  updatedAt: updatedAtColumn(),
});

export type UserWallet = typeof userWallets.$inferSelect;
export type InsertUserWallet = typeof userWallets.$inferInsert;

// ─── Stripe Webhook Idempotency ───────────────────────────────────────────────
// One row per successfully-processed Stripe event. On every webhook delivery
// we INSERT ... ON CONFLICT DO NOTHING by eventId; if the row already exists
// we skip processing.
export const processedWebhookEvents = pgTable("processed_webhook_events", {
  eventId: varchar("eventId", { length: 128 }).primaryKey(),
  eventType: varchar("eventType", { length: 64 }).notNull(),
  processedAt: createdAtColumn(),
});

export type ProcessedWebhookEvent = typeof processedWebhookEvents.$inferSelect;
export type InsertProcessedWebhookEvent =
  typeof processedWebhookEvents.$inferInsert;

// ─── Golden Notes — in-account virtual currency ──────────────────────────────
// See docs/golden-notes-design.md for the full spec. Summary:
//   - Users buy GN packs on the web (Stripe Checkout). Webhook mints notes.
//   - Users spend GN on extra games, tournaments, advanced modes.
//   - Users can gift GN to friends (web only; deferred for later session).
//   - Mobile reads + spends; purchases stay web-only per App Store policy.

export const goldenNoteTransactionKindEnum = pgEnum(
  "golden_note_transaction_kind",
  [
    "purchase",
    "spend_extra_game",
    "spend_tournament",
    "spend_advanced_mode",
    "spend_avatar_unlock",
    "gift_sent",
    "gift_received",
    "refund",
    "expiry",
    "admin_adjustment",
  ]
);

export const goldenNoteGiftStatusEnum = pgEnum("golden_note_gift_status", [
  "pending",
  "accepted",
  "declined",
  "expired",
]);

// One row per user. Current balance + lifetime counters for analytics.
export const goldenNoteBalances = pgTable("golden_note_balances", {
  userId: integer("userId").primaryKey(),
  balance: integer("balance").default(0).notNull(),
  lifetimePurchased: integer("lifetimePurchased").default(0).notNull(),
  lifetimeSpent: integer("lifetimeSpent").default(0).notNull(),
  lifetimeGiftedSent: integer("lifetimeGiftedSent").default(0).notNull(),
  lifetimeGiftedReceived: integer("lifetimeGiftedReceived")
    .default(0)
    .notNull(),
  lastPurchaseAt: timestamp("lastPurchaseAt", { withTimezone: true }),
  createdAt: createdAtColumn(),
  updatedAt: updatedAtColumn(),
});

export type GoldenNoteBalance = typeof goldenNoteBalances.$inferSelect;
export type InsertGoldenNoteBalance = typeof goldenNoteBalances.$inferInsert;

// Insert-only audit log. One row per credit / debit. Balance snapshot per row
// so reconstruction works without joining a separate table.
export const goldenNoteTransactions = pgTable("golden_note_transactions", {
  id: serial("id").primaryKey(),
  userId: integer("userId").notNull(),
  amount: integer("amount").notNull(), // signed: positive credit, negative debit
  kind: goldenNoteTransactionKindEnum("kind").notNull(),
  reason: varchar("reason", { length: 256 }),
  relatedUserId: integer("relatedUserId"), // gift counterparty
  stripePaymentIntentId: varchar("stripePaymentIntentId", { length: 256 }),
  balanceAfter: integer("balanceAfter").notNull(),
  createdAt: createdAtColumn(),
});

export type GoldenNoteTransaction =
  typeof goldenNoteTransactions.$inferSelect;
export type InsertGoldenNoteTransaction =
  typeof goldenNoteTransactions.$inferInsert;

// Pending gifts. When created, sender balance is debited and this row is
// inserted atomically. On accept, recipient balance is credited and this row
// deleted. Gifting UI ships in a later session — table exists now to avoid
// a second migration.
export const goldenNoteGifts = pgTable("golden_note_gifts", {
  id: serial("id").primaryKey(),
  senderUserId: integer("senderUserId").notNull(),
  recipientUserId: integer("recipientUserId").notNull(),
  amount: integer("amount").notNull(),
  message: text("message"),
  status: goldenNoteGiftStatusEnum("status").default("pending").notNull(),
  expiresAt: timestamp("expiresAt", { withTimezone: true }).notNull(),
  createdAt: createdAtColumn(),
  resolvedAt: timestamp("resolvedAt", { withTimezone: true }),
});

export type GoldenNoteGift = typeof goldenNoteGifts.$inferSelect;
export type InsertGoldenNoteGift = typeof goldenNoteGifts.$inferInsert;

// ─── Avatars (catalog + ownership) ───────────────────────────────────────────
export const avatars = pgTable("avatars", {
  id: serial("id").primaryKey(),
  slug: varchar("slug", { length: 64 }).notNull().unique(),
  name: varchar("name", { length: 128 }).notNull(),
  imageUrl: varchar("imageUrl", { length: 256 }).notNull(),
  rarity: avatarRarityEnum("rarity").notNull(),
  priceGn: integer("priceGn").default(0).notNull(),
  isActive: boolean("isActive").default(true).notNull(),
  sortOrder: integer("sortOrder").default(0).notNull(),
  createdAt: createdAtColumn(),
});
export type Avatar = typeof avatars.$inferSelect;
export type InsertAvatar = typeof avatars.$inferInsert;

export const userAvatars = pgTable(
  "user_avatars",
  {
    userId: integer("userId").notNull(),
    avatarId: integer("avatarId").notNull(),
    acquiredAt: timestamp("acquiredAt", { withTimezone: true }).defaultNow().notNull(),
    acquiredVia: avatarAcquiredViaEnum("acquiredVia").notNull(),
    spentGn: integer("spentGn").default(0).notNull(),
  },
  (t) => ({
    pk: primaryKey({ columns: [t.userId, t.avatarId] }),
  }),
);
export type UserAvatar = typeof userAvatars.$inferSelect;
export type InsertUserAvatar = typeof userAvatars.$inferInsert;

// ─── User Insights ────────────────────────────────────────────────────────────
// Cached AI-generated weakness diagnosis + recommended practice-pack song IDs.
// One row per user; refreshed when stale (>24h) or invalidated on next round.
export const userInsights = pgTable("user_insights", {
  id: serial("id").primaryKey(),
  userId: integer("userId").notNull().unique(),
  diagnosis: text("diagnosis").notNull(),
  packSongIds: jsonb("packSongIds").$type<number[]>().notNull(),
  roundsAnalyzed: integer("roundsAnalyzed").notNull(),
  weakestGenre: varchar("weakestGenre", { length: 64 }),
  weakestDecade: varchar("weakestDecade", { length: 32 }),
  weakestCategory: varchar("weakestCategory", { length: 16 }), // 'lyric' | 'artist' | 'year' | 'title'
  computedAt: timestamp("computedAt", { withTimezone: true }).defaultNow().notNull(),
});

export type UserInsights = typeof userInsights.$inferSelect;

// ─── Layer 2: Lyric Moments (Phase 5b) ───────────────────────────────────────
// One row per CANDIDATE lyric moment. A song typically has 3-10 candidates;
// only a subset reach gameplay_items. Scoring fields are 1-5 smallint with
// CHECK constraints applied via DDL (see
// scripts/migrations/applied/2026-05-06-three-layer-schema.sql).
//
// The four `*_fit` boolean columns flag which gameplay surfaces the moment can
// support; the three difficulty `*_fit` booleans flag which difficulty tiers
// it suits.
//
// `overall_playability_score` is a Postgres GENERATED column computed from the
// eight 1-5 scores using the brief's weights. drizzle-orm doesn't model
// GENERATED columns natively — declared here as a regular smallint for type
// inference; the migration SQL adds GENERATED ALWAYS. Do NOT INSERT/UPDATE
// this column from app code.
export const lyricMoments = pgTable(
  "lyric_moments",
  {
    id: serial("id").primaryKey(),
    songId: integer("song_id").notNull(), // FK -> songs.id ON DELETE CASCADE
    sectionType: varchar("section_type", { length: 32 }).notNull(),
    sectionOrder: smallint("section_order"),
    candidateUseCase: candidateUseCaseEnum("candidate_use_case").notNull(),

    lyricText: text("lyric_text").notNull(),
    lyricBefore: text("lyric_before"),
    lyricAfter: text("lyric_after"),

    // Difficulty-tier fit flags (independent — a moment can suit multiple).
    lowFit: boolean("low_fit").default(false).notNull(),
    mediumFit: boolean("medium_fit").default(false).notNull(),
    hardFit: boolean("hard_fit").default(false).notNull(),

    // Surface-fit flags
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

    // GENERATED ALWAYS column — see migration SQL for the formula.
    overallPlayabilityScore: smallint("overall_playability_score"),

    reviewerNotes: text("reviewer_notes"),
    approvalStatus: varchar("approval_status", { length: 16 })
      .default("pending")
      .notNull(),
    approvedBy: integer("approved_by"), // FK -> users.id (ON DELETE SET NULL)
    approvedAt: timestamp("approved_at", { withTimezone: true }),

    createdAt: timestamp("created_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .defaultNow()
      .notNull()
      .$onUpdate(() => new Date()),
  },
  (t) => ({
    songIdIdx: index("lyric_moments_song_id_idx").on(t.songId),
    approvalStatusIdx: index("lyric_moments_approval_status_idx").on(
      t.approvalStatus,
    ),
    songScoreIdx: index("lyric_moments_song_score_idx").on(
      t.songId,
      t.overallPlayabilityScore,
    ),
    songLyricUnique: uniqueIndex("lyric_moments_song_lyric_unique").on(
      t.songId,
      t.lyricText,
    ),
  }),
);

export type LyricMoment = typeof lyricMoments.$inferSelect;
export type InsertLyricMoment = typeof lyricMoments.$inferInsert;

// ─── Layer 3: Gameplay Items (Phase 5b) ──────────────────────────────────────
// One row per APPROVED gameplay prompt. This is what the game runtime reads
// (Phase 5c repoints reads here). A single lyric_moment can spawn multiple
// gameplay_items at different difficulties / question types.
//
// difficulty here is EXPLICIT — not inferred from text length the way the
// legacy playableVariantIndicesOf() helper does.
export const gameplayItems = pgTable(
  "gameplay_items",
  {
    id: serial("id").primaryKey(),
    lyricMomentId: integer("lyric_moment_id").notNull(), // FK -> lyric_moments.id (RESTRICT)
    songId: integer("song_id").notNull(), // FK -> songs.id (CASCADE)
    difficulty: varchar("difficulty", { length: 8 }).notNull(),
    questionType: questionTypeEnum("question_type").notNull(),
    promptFormat: promptFormatEnum("prompt_format")
      .default("multiple_choice")
      .notNull(),
    promptText: text("prompt_text").notNull(),
    correctAnswer: text("correct_answer").notNull(),
    distractor1: text("distractor_1"),
    distractor2: text("distractor_2"),
    distractor3: text("distractor_3"),
    yearTolerance: smallint("year_tolerance"),
    qaStatus: qaStatusEnum("qa_status").default("pending").notNull(),
    qaNotes: text("qa_notes"),
    isActive: boolean("is_active").default(true).notNull(),
    timesShown: integer("times_shown").default(0).notNull(),
    createdAt: timestamp("created_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .defaultNow()
      .notNull()
      .$onUpdate(() => new Date()),
  },
  (t) => ({
    momentIdIdx: index("gameplay_items_moment_id_idx").on(t.lyricMomentId),
    songIdIdx: index("gameplay_items_song_id_idx").on(t.songId),
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

// ─── Audit: admin_actions ─────────────────────────────────────────────────
// Append-only forensics log of every admin action. Hard-immutable at the DB
// level — the migration also runs REVOKE UPDATE/DELETE + a deny-change
// trigger because Supabase service_role bypasses RLS. We declare the table
// inline here so Drizzle can introspect it for queries; the immutability
// enforcement happens in raw SQL in the migration (Task 0.6).
//
// Lives in the `audit` Postgres schema. Drizzle's pgTable accepts a schema
// via the second argument syntax `pgTable('admin_actions', {...}, () => ({
// schema: 'audit' }))` — but the recommended pattern is `pgSchema` so we
// use that.
export const auditSchema = pgSchema("audit");

export const adminActions = auditSchema.table("admin_actions", {
  id: uuid("id").primaryKey().defaultRandom(),
  occurredAt: timestamp("occurred_at", { withTimezone: true })
    .defaultNow()
    .notNull(),
  actorType: varchar("actor_type", { length: 16 }).notNull(),
  actorId: integer("actor_id"),
  actorEmail: varchar("actor_email", { length: 320 }),
  action: varchar("action", { length: 64 }).notNull(),
  targetType: varchar("target_type", { length: 32 }).notNull(),
  targetId: varchar("target_id", { length: 64 }).notNull(),
  targetVariantIndex: integer("target_variant_index"),
  payload: jsonb("payload").$type<{
    before?: Record<string, unknown>;
    after?: Record<string, unknown>;
    params?: Record<string, unknown>;
    reason?: string;
  }>().default({}).notNull(),
  requestId: varchar("request_id", { length: 64 }),
  ipTruncated: text("ip_truncated"), // 'inet' type maps to text in drizzle here
  userAgent: text("user_agent"),
}, (t) => ({
  actorIdx: index("idx_admin_actions_actor").on(t.actorId, t.occurredAt),
  targetIdx: index("idx_admin_actions_target").on(
    t.targetType,
    t.targetId,
    t.occurredAt
  ),
  actionIdx: index("idx_admin_actions_action").on(t.action, t.occurredAt),
}));

export type AdminActionRow = typeof adminActions.$inferSelect;
export type InsertAdminActionRow = typeof adminActions.$inferInsert;

export const adminActionsRedactions = auditSchema.table(
  "admin_actions_redactions",
  {
    actionId: uuid("action_id")
      .primaryKey()
      .references(() => adminActions.id),
    redactedAt: timestamp("redacted_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
    reason: text("reason").notNull(),
    fields: text("fields").array().notNull(),
  },
);
