// server/db.ts
import { eq, sql } from "drizzle-orm";
import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";

// drizzle/schema.ts
import {
  boolean,
  doublePrecision,
  index,
  integer,
  jsonb,
  pgEnum,
  pgTable,
  primaryKey,
  serial,
  smallint,
  text,
  timestamp,
  uniqueIndex,
  varchar
} from "drizzle-orm/pg-core";
var userRoleEnum = pgEnum("user_role", ["user", "admin"]);
var lyricSectionTypeEnum = pgEnum("lyric_section_type", [
  "chorus",
  "hook",
  "verse",
  "call-response",
  "bridge"
]);
var difficultyEnum = pgEnum("difficulty", ["low", "medium", "high"]);
var approvalStatusEnum = pgEnum("approval_status", [
  "pending",
  "approved",
  "rejected"
]);
var gameModeEnum = pgEnum("game_mode", [
  "solo",
  "multiplayer",
  "team"
]);
var rankingModeEnum = pgEnum("ranking_mode", [
  "total_points",
  "speed_bonus",
  "streak_bonus"
]);
var gameStatusEnum = pgEnum("game_status", [
  "waiting",
  "active",
  "finished"
]);
var answerMethodEnum = pgEnum("answer_method", ["typed", "voice"]);
var prizePoolStatusEnum = pgEnum("prize_pool_status", [
  "active",
  "paused",
  "closed"
]);
var payoutStatusEnum = pgEnum("payout_status", [
  "pending",
  "processing",
  "completed",
  "failed"
]);
var stripeAccountStatusEnum = pgEnum("stripe_account_status", [
  "pending",
  "verified",
  "restricted",
  "disabled"
]);
var payoutRequestStatusEnum = pgEnum("payout_request_status", [
  "pending",
  "approved",
  "rejected",
  "paid"
]);
var subscriptionTierEnum = pgEnum("subscription_tier", [
  "free",
  "player",
  "pro",
  "elite"
]);
var subscriptionStatusEnum = pgEnum("subscription_status", [
  "active",
  "paused",
  "canceled",
  "expired",
  "past_due",
  "unpaid",
  "trialing",
  "incomplete",
  "incomplete_expired"
]);
var entryFeeGameTypeEnum = pgEnum("entry_fee_game_type", [
  "solo",
  "team3",
  "team5",
  "team7"
]);
var entryFeeGameStatusEnum = pgEnum("entry_fee_game_status", [
  "pending",
  "in_progress",
  "completed",
  "cancelled"
]);
var addOnPurchaseStatusEnum = pgEnum("addon_purchase_status", [
  "pending",
  "completed",
  "failed"
]);
var avatarRarityEnum = pgEnum("avatar_rarity", [
  "starter",
  "common",
  "rare",
  "epic",
  "legendary"
]);
var avatarAcquiredViaEnum = pgEnum("avatar_acquired_via", [
  "starter",
  "purchase",
  "admin_grant"
]);
var licensingStatusEnum = pgEnum("licensing_status", [
  "pending",
  "in_review",
  "cleared",
  "internal_only",
  "rejected"
]);
var candidateUseCaseEnum = pgEnum("candidate_use_case", [
  "song_id",
  "artist_id",
  "year_id",
  "finish_the_lyric",
  "multi_surface"
]);
var questionTypeEnum = pgEnum("question_type", [
  "song_identification",
  "artist_identification",
  "year_identification",
  "finish_the_lyric"
]);
var promptFormatEnum = pgEnum("prompt_format", [
  "multiple_choice",
  "typed",
  "voice"
]);
var qaStatusEnum = pgEnum("qa_status", [
  "pending",
  "passed",
  "needs_fix",
  "blocked"
]);
var updatedAtColumn = () => timestamp("updatedAt", { withTimezone: true }).defaultNow().notNull().$onUpdate(() => /* @__PURE__ */ new Date());
var createdAtColumn = () => timestamp("createdAt", { withTimezone: true }).defaultNow().notNull();
var users = pgTable("users", {
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
  gamePrefs: jsonb("gamePrefs").$type(),
  createdAt: createdAtColumn(),
  updatedAt: updatedAtColumn(),
  lastSignedIn: timestamp("lastSignedIn", { withTimezone: true }).defaultNow().notNull()
});
var guestSessions = pgTable("guest_sessions", {
  id: serial("id").primaryKey(),
  sessionToken: varchar("sessionToken", { length: 128 }).notNull().unique(),
  nickname: varchar("nickname", { length: 64 }).notNull(),
  createdAt: createdAtColumn()
});
var artistMetadata = pgTable("artist_metadata", {
  id: serial("id").primaryKey(),
  artistName: varchar("artistName", { length: 256 }).notNull(),
  aliases: text("aliases"),
  // JSON array of alias strings (stored as text)
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
  createdAt: createdAtColumn()
});
var songs = pgTable("songs", {
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
  distractors: jsonb("distractors").$type(),
  // Per-song lyric variants. Each entry is a complete question
  // ({prompt, answer, distractors, sectionType}). Populated by
  // scripts/seed-lyric-variants.mjs (variant[0] from legacy columns) and
  // scripts/generate-lyric-variants.mjs (LLM-rewritten variants[1..]).
  // getNextSong picks an unseen variant per user within the dedup window
  // so the same song can be re-shown with a different lyric line.
  lyricVariants: jsonb("lyricVariants").$type(),
  lyricSectionType: lyricSectionTypeEnum("lyricSectionType").notNull(),
  difficulty: difficultyEnum("difficulty").notNull(),
  language: varchar("language", { length: 16 }).default("en").notNull(),
  explicitFlag: boolean("explicitFlag").default(false).notNull(),
  approvalStatus: approvalStatusEnum("approvalStatus").default("approved").notNull(),
  isActive: boolean("isActive").default(true).notNull(),
  // ── Phase 5b additions (three-layer content schema, song-master fields) ──
  // featured_artist: nullable; primary artist stays in artistName.
  featuredArtist: varchar("featured_artist", { length: 256 }),
  // licensing_status: defaults to internal_only so legacy rows are safe.
  // Curator flips to cleared once licensing is in place.
  licensingStatus: licensingStatusEnum("licensing_status").default("internal_only").notNull(),
  // approved_for_game: curatorial publish flag separate from approvalStatus
  // (which is the content-review state) and isActive (operational kill switch).
  // A song appears in gameplay only when isActive AND approvalStatus='approved'
  // AND approvedForGame.
  approvedForGame: boolean("approved_for_game").default(true).notNull(),
  // in_curated_bank: marks the 400-song bank-A set + future curated tiers.
  inCuratedBank: boolean("in_curated_bank").default(false).notNull(),
  // curator_notes: free-text song-level notes from the curator.
  curatorNotes: text("curator_notes"),
  // Aggregate counters seeded by scripts/backfill-song-displays.mjs and
  // updated transactionally by getNextSong. Used to power the global
  // over-show penalty in selection + the admin usage report. song_displays
  // remains the source of truth — these columns are a denormalized cache.
  displayCount: integer("displayCount").default(0).notNull(),
  lastShownAt: timestamp("lastShownAt", { withTimezone: true }),
  createdAt: createdAtColumn(),
  updatedAt: updatedAtColumn()
}, (t) => ({
  // Prevents duplicate seeds of the same song. Idempotent re-runs use
  // ON CONFLICT against this index.
  titleArtistUnique: uniqueIndex("songs_title_artist_unique").on(
    t.title,
    t.artistName
  )
}));
var songDisplays = pgTable(
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
    shownAt: timestamp("shownAt", { withTimezone: true }).defaultNow().notNull()
  },
  (t) => ({
    userShownAtIdx: index("song_displays_user_shown_at_idx").on(
      t.userId,
      t.shownAt
    ),
    guestShownAtIdx: index("song_displays_guest_shown_at_idx").on(
      t.guestToken,
      t.shownAt
    ),
    songIdIdx: index("song_displays_song_id_idx").on(t.songId)
  })
);
var gameRooms = pgTable("game_rooms", {
  id: serial("id").primaryKey(),
  roomCode: varchar("roomCode", { length: 8 }).notNull().unique(),
  hostUserId: integer("hostUserId"),
  hostGuestToken: varchar("hostGuestToken", { length: 128 }),
  mode: gameModeEnum("mode").notNull(),
  rankingMode: rankingModeEnum("rankingMode").default("total_points").notNull(),
  timerSeconds: integer("timerSeconds").default(30).notNull(),
  roundsTotal: integer("roundsTotal").default(10).notNull(),
  selectedGenres: text("selectedGenres").notNull(),
  // JSON string
  selectedDecades: text("selectedDecades").notNull(),
  // JSON string
  difficulty: difficultyEnum("difficulty").default("medium").notNull(),
  explicitFilter: boolean("explicitFilter").default(false).notNull(),
  status: gameStatusEnum("status").default("waiting").notNull(),
  currentRound: integer("currentRound").default(0).notNull(),
  currentPlayerIndex: integer("currentPlayerIndex").default(0).notNull(),
  currentSongId: integer("currentSongId"),
  usedSongIds: text("usedSongIds"),
  // JSON array as text, nullable
  customPackSongIds: jsonb("customPackSongIds").$type(),
  streakInsurance: boolean("streakInsurance").default(false).notNull(),
  createdAt: createdAtColumn(),
  updatedAt: updatedAtColumn()
});
var teams = pgTable("teams", {
  id: serial("id").primaryKey(),
  roomId: integer("roomId").notNull(),
  teamName: varchar("teamName", { length: 64 }).notNull(),
  teamColor: varchar("teamColor", { length: 16 }).default("#8B5CF6").notNull(),
  currentScore: integer("currentScore").default(0).notNull(),
  createdAt: createdAtColumn()
});
var roomPlayers = pgTable("room_players", {
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
  joinedAt: timestamp("joinedAt", { withTimezone: true }).defaultNow().notNull()
});
var gameSessions = pgTable("game_sessions", {
  id: serial("id").primaryKey(),
  roomId: integer("roomId"),
  userId: integer("userId"),
  guestToken: varchar("guestToken", { length: 128 }),
  mode: gameModeEnum("mode").notNull(),
  rankingMode: rankingModeEnum("rankingMode").default("total_points").notNull(),
  finalScore: integer("finalScore").default(0).notNull(),
  placement: integer("placement"),
  startedAt: timestamp("startedAt", { withTimezone: true }).defaultNow().notNull(),
  endedAt: timestamp("endedAt", { withTimezone: true })
});
var roundResults = pgTable("round_results", {
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
  createdAt: createdAtColumn()
});
var leaderboardEntries = pgTable("leaderboard_entries", {
  id: serial("id").primaryKey(),
  userId: integer("userId"),
  guestName: varchar("guestName", { length: 64 }),
  displayName: varchar("displayName", { length: 64 }).notNull(),
  score: integer("score").notNull(),
  mode: gameModeEnum("mode").notNull(),
  genre: varchar("genre", { length: 64 }),
  decade: varchar("decade", { length: 32 }),
  rankingMode: varchar("rankingMode", { length: 32 }).notNull(),
  createdAt: createdAtColumn()
});
var prizePools = pgTable("prize_pools", {
  id: serial("id").primaryKey(),
  name: varchar("name", { length: 256 }).notNull(),
  description: text("description"),
  totalAmount: doublePrecision("totalAmount").notNull(),
  distributedAmount: doublePrecision("distributedAmount").default(0).notNull(),
  remainingAmount: doublePrecision("remainingAmount").notNull(),
  status: prizePoolStatusEnum("status").default("active").notNull(),
  distributionRules: text("distributionRules").notNull(),
  createdAt: createdAtColumn(),
  updatedAt: updatedAtColumn()
});
var prizePayouts = pgTable("prize_payouts", {
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
  updatedAt: updatedAtColumn()
});
var stripeAccounts = pgTable("stripe_accounts", {
  id: serial("id").primaryKey(),
  userId: integer("userId").notNull().unique(),
  stripeConnectAccountId: varchar("stripeConnectAccountId", { length: 256 }).notNull().unique(),
  status: stripeAccountStatusEnum("status").default("pending").notNull(),
  bankAccountVerified: boolean("bankAccountVerified").default(false).notNull(),
  createdAt: createdAtColumn(),
  updatedAt: updatedAtColumn()
});
var payoutRequests = pgTable("payout_requests", {
  id: serial("id").primaryKey(),
  userId: integer("userId").notNull(),
  amount: doublePrecision("amount").notNull(),
  status: payoutRequestStatusEnum("status").default("pending").notNull(),
  stripePayoutId: varchar("stripePayoutId", { length: 256 }),
  rejectionReason: text("rejectionReason"),
  createdAt: createdAtColumn(),
  updatedAt: updatedAtColumn()
});
var subscriptions = pgTable("subscriptions", {
  id: serial("id").primaryKey(),
  userId: integer("userId").notNull().unique(),
  tier: subscriptionTierEnum("tier").default("free").notNull(),
  stripeSubscriptionId: varchar("stripeSubscriptionId", { length: 256 }),
  status: subscriptionStatusEnum("status").default("active").notNull(),
  currentPeriodStart: timestamp("currentPeriodStart", { withTimezone: true }),
  currentPeriodEnd: timestamp("currentPeriodEnd", { withTimezone: true }),
  canceledAt: timestamp("canceledAt", { withTimezone: true }),
  createdAt: createdAtColumn(),
  updatedAt: updatedAtColumn()
});
var dailyGameTracking = pgTable("daily_game_tracking", {
  id: serial("id").primaryKey(),
  userId: integer("userId").notNull(),
  date: varchar("date", { length: 10 }).notNull(),
  // YYYY-MM-DD
  gamesPlayedToday: integer("gamesPlayedToday").default(0).notNull(),
  createdAt: createdAtColumn(),
  updatedAt: updatedAtColumn()
});
var entryFeeGames = pgTable("entry_fee_games", {
  id: serial("id").primaryKey(),
  roomId: integer("roomId").notNull(),
  entryFeeAmount: doublePrecision("entryFeeAmount").notNull(),
  gameType: entryFeeGameTypeEnum("gameType").notNull(),
  prizePoolAmount: doublePrecision("prizePoolAmount").notNull(),
  totalEntriesCollected: doublePrecision("totalEntriesCollected").notNull(),
  status: entryFeeGameStatusEnum("status").default("pending").notNull(),
  createdAt: createdAtColumn(),
  completedAt: timestamp("completedAt", { withTimezone: true })
});
var entryFeeParticipants = pgTable("entry_fee_participants", {
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
  updatedAt: updatedAtColumn()
});
var addOnGamePurchases = pgTable("addon_game_purchases", {
  id: serial("id").primaryKey(),
  userId: integer("userId").notNull(),
  quantity: integer("quantity").notNull(),
  pricePerGame: doublePrecision("pricePerGame").notNull(),
  totalAmount: doublePrecision("totalAmount").notNull(),
  stripePaymentIntentId: varchar("stripePaymentIntentId", { length: 256 }),
  status: addOnPurchaseStatusEnum("status").default("pending").notNull(),
  createdAt: createdAtColumn()
});
var userWallets = pgTable("user_wallets", {
  id: serial("id").primaryKey(),
  userId: integer("userId").notNull().unique(),
  availableBalance: doublePrecision("availableBalance").default(0).notNull(),
  totalWinnings: doublePrecision("totalWinnings").default(0).notNull(),
  totalPayouts: doublePrecision("totalPayouts").default(0).notNull(),
  lastPayoutDate: timestamp("lastPayoutDate", { withTimezone: true }),
  createdAt: createdAtColumn(),
  updatedAt: updatedAtColumn()
});
var processedWebhookEvents = pgTable("processed_webhook_events", {
  eventId: varchar("eventId", { length: 128 }).primaryKey(),
  eventType: varchar("eventType", { length: 64 }).notNull(),
  processedAt: createdAtColumn()
});
var goldenNoteTransactionKindEnum = pgEnum(
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
    "admin_adjustment"
  ]
);
var goldenNoteGiftStatusEnum = pgEnum("golden_note_gift_status", [
  "pending",
  "accepted",
  "declined",
  "expired"
]);
var goldenNoteBalances = pgTable("golden_note_balances", {
  userId: integer("userId").primaryKey(),
  balance: integer("balance").default(0).notNull(),
  lifetimePurchased: integer("lifetimePurchased").default(0).notNull(),
  lifetimeSpent: integer("lifetimeSpent").default(0).notNull(),
  lifetimeGiftedSent: integer("lifetimeGiftedSent").default(0).notNull(),
  lifetimeGiftedReceived: integer("lifetimeGiftedReceived").default(0).notNull(),
  lastPurchaseAt: timestamp("lastPurchaseAt", { withTimezone: true }),
  createdAt: createdAtColumn(),
  updatedAt: updatedAtColumn()
});
var goldenNoteTransactions = pgTable("golden_note_transactions", {
  id: serial("id").primaryKey(),
  userId: integer("userId").notNull(),
  amount: integer("amount").notNull(),
  // signed: positive credit, negative debit
  kind: goldenNoteTransactionKindEnum("kind").notNull(),
  reason: varchar("reason", { length: 256 }),
  relatedUserId: integer("relatedUserId"),
  // gift counterparty
  stripePaymentIntentId: varchar("stripePaymentIntentId", { length: 256 }),
  balanceAfter: integer("balanceAfter").notNull(),
  createdAt: createdAtColumn()
});
var goldenNoteGifts = pgTable("golden_note_gifts", {
  id: serial("id").primaryKey(),
  senderUserId: integer("senderUserId").notNull(),
  recipientUserId: integer("recipientUserId").notNull(),
  amount: integer("amount").notNull(),
  message: text("message"),
  status: goldenNoteGiftStatusEnum("status").default("pending").notNull(),
  expiresAt: timestamp("expiresAt", { withTimezone: true }).notNull(),
  createdAt: createdAtColumn(),
  resolvedAt: timestamp("resolvedAt", { withTimezone: true })
});
var avatars = pgTable("avatars", {
  id: serial("id").primaryKey(),
  slug: varchar("slug", { length: 64 }).notNull().unique(),
  name: varchar("name", { length: 128 }).notNull(),
  imageUrl: varchar("imageUrl", { length: 256 }).notNull(),
  rarity: avatarRarityEnum("rarity").notNull(),
  priceGn: integer("priceGn").default(0).notNull(),
  isActive: boolean("isActive").default(true).notNull(),
  sortOrder: integer("sortOrder").default(0).notNull(),
  createdAt: createdAtColumn()
});
var userAvatars = pgTable(
  "user_avatars",
  {
    userId: integer("userId").notNull(),
    avatarId: integer("avatarId").notNull(),
    acquiredAt: timestamp("acquiredAt", { withTimezone: true }).defaultNow().notNull(),
    acquiredVia: avatarAcquiredViaEnum("acquiredVia").notNull(),
    spentGn: integer("spentGn").default(0).notNull()
  },
  (t) => ({
    pk: primaryKey({ columns: [t.userId, t.avatarId] })
  })
);
var userInsights = pgTable("user_insights", {
  id: serial("id").primaryKey(),
  userId: integer("userId").notNull().unique(),
  diagnosis: text("diagnosis").notNull(),
  packSongIds: jsonb("packSongIds").$type().notNull(),
  roundsAnalyzed: integer("roundsAnalyzed").notNull(),
  weakestGenre: varchar("weakestGenre", { length: 64 }),
  weakestDecade: varchar("weakestDecade", { length: 32 }),
  weakestCategory: varchar("weakestCategory", { length: 16 }),
  // 'lyric' | 'artist' | 'year' | 'title'
  computedAt: timestamp("computedAt", { withTimezone: true }).defaultNow().notNull()
});
var lyricMoments = pgTable(
  "lyric_moments",
  {
    id: serial("id").primaryKey(),
    songId: integer("song_id").notNull(),
    // FK -> songs.id ON DELETE CASCADE
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
    artistRecognitionFit: boolean("artist_recognition_fit").default(false).notNull(),
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
    approvalStatus: varchar("approval_status", { length: 16 }).default("pending").notNull(),
    approvedBy: integer("approved_by"),
    // FK -> users.id (ON DELETE SET NULL)
    approvedAt: timestamp("approved_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull().$onUpdate(() => /* @__PURE__ */ new Date())
  },
  (t) => ({
    songIdIdx: index("lyric_moments_song_id_idx").on(t.songId),
    approvalStatusIdx: index("lyric_moments_approval_status_idx").on(
      t.approvalStatus
    ),
    songScoreIdx: index("lyric_moments_song_score_idx").on(
      t.songId,
      t.overallPlayabilityScore
    ),
    songLyricUnique: uniqueIndex("lyric_moments_song_lyric_unique").on(
      t.songId,
      t.lyricText
    )
  })
);
var gameplayItems = pgTable(
  "gameplay_items",
  {
    id: serial("id").primaryKey(),
    lyricMomentId: integer("lyric_moment_id").notNull(),
    // FK -> lyric_moments.id (RESTRICT)
    songId: integer("song_id").notNull(),
    // FK -> songs.id (CASCADE)
    difficulty: varchar("difficulty", { length: 8 }).notNull(),
    questionType: questionTypeEnum("question_type").notNull(),
    promptFormat: promptFormatEnum("prompt_format").default("multiple_choice").notNull(),
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
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull().$onUpdate(() => /* @__PURE__ */ new Date())
  },
  (t) => ({
    momentIdIdx: index("gameplay_items_moment_id_idx").on(t.lyricMomentId),
    songIdIdx: index("gameplay_items_song_id_idx").on(t.songId),
    songDiffTypeIdx: index("gameplay_items_song_diff_type_idx").on(
      t.songId,
      t.difficulty,
      t.questionType
    ),
    activeIdx: index("gameplay_items_active_idx").on(t.isActive, t.qaStatus)
  })
);

// server/_core/env.ts
var ENV = {
  databaseUrl: process.env.DATABASE_URL ?? "",
  isProduction: process.env.NODE_ENV === "production",
  forgeApiUrl: process.env.BUILT_IN_FORGE_API_URL ?? "",
  forgeApiKey: process.env.BUILT_IN_FORGE_API_KEY ?? ""
};

// server/db.ts
var _db = null;
var _client = null;
async function getDb() {
  if (_db) return _db;
  const url = process.env.SUPABASE_TRANSACTION_POOLER_STRING ?? process.env.DATABASE_URL;
  if (!url) return null;
  try {
    _client = postgres(url, {
      // Reasonable defaults for Vercel serverless + Supabase pooler. Short
      // idle timeout so idle connections are returned to the pool; the pool
      // handles re-opening on next use.
      max: 10,
      idle_timeout: 20,
      connect_timeout: 10,
      // Supabase's pgbouncer doesn't support prepared statements in
      // transaction mode. Drizzle's postgres-js driver respects this flag.
      prepare: false
    });
    _db = drizzle(_client);
  } catch (error) {
    console.warn(
      "[Database] Failed to connect:",
      error instanceof Error ? error.message : "unknown"
    );
    _db = null;
  }
  return _db;
}

// server/stripe-integration.ts
import Stripe from "stripe";
var stripe = new Stripe(process.env.STRIPE_SECRET_KEY || "", {
  apiVersion: "2026-03-25.dahlia"
});
async function handleCheckoutSessionCompleted(session) {
  const userId = parseInt(session.client_reference_id || "0");
  const metadata = session.metadata || {};
  if (metadata.type === "subscription") {
    return {
      type: "subscription",
      userId,
      tier: metadata.tier,
      stripeSubscriptionId: session.subscription
    };
  }
  if (metadata.type === "entry_fee") {
    return {
      type: "entry_fee",
      userId,
      entryFeeGameId: parseInt(metadata.entryFeeGameId || "0"),
      entryFeeAmount: parseFloat(metadata.entryFeeAmount || "0"),
      gameType: metadata.gameType
    };
  }
  if (metadata.type === "add_on_games") {
    return {
      type: "add_on_games",
      userId,
      quantity: parseInt(metadata.quantity || "0")
    };
  }
  if (metadata.type === "golden_notes") {
    return {
      type: "golden_notes",
      userId,
      packId: metadata.packId,
      notes: parseInt(metadata.notes || "0"),
      paymentIntentId: typeof session.payment_intent === "string" ? session.payment_intent : session.payment_intent?.id ?? null
    };
  }
  return null;
}
async function handleInvoicePaid(invoice) {
  const subscriptionId = typeof invoice.subscription === "string" ? invoice.subscription : invoice.subscription?.id;
  return {
    type: "invoice_paid",
    subscriptionId,
    amount: invoice.amount_paid
  };
}
async function handleCustomerSubscriptionDeleted(subscription) {
  return {
    type: "subscription_canceled",
    subscriptionId: subscription.id
  };
}
async function handleCustomerSubscriptionUpdated(subscription) {
  const meta = subscription.metadata ?? {};
  return {
    type: "subscription_updated",
    subscriptionId: subscription.id,
    status: subscription.status,
    currentPeriodEnd: subscription.current_period_end,
    userId: meta.userId ? parseInt(meta.userId) : void 0,
    tier: meta.tier
  };
}
async function handleInvoicePaymentFailed(invoice) {
  const sub = invoice.subscription;
  const subscriptionId = typeof sub === "string" ? sub : sub?.id;
  return {
    type: "invoice_payment_failed",
    subscriptionId,
    invoiceId: invoice.id,
    amountDue: invoice.amount_due
  };
}
async function getInvoiceSubscriptionId(invoiceId) {
  try {
    const invoice = await stripe.invoices.retrieve(invoiceId);
    const sub = invoice.subscription;
    if (!sub) return null;
    return typeof sub === "string" ? sub : sub.id;
  } catch {
    return null;
  }
}
function constructWebhookEvent(body, signature, secret) {
  return stripe.webhooks.constructEvent(body, signature, secret);
}

// server/db-monetization.ts
import { eq as eq2, and } from "drizzle-orm";
var getDatabase = async () => {
  const db = await getDb();
  if (!db) throw new Error("Database connection failed");
  return db;
};
async function updateSubscription(userId, tier, stripeSubscriptionId, status, currentPeriodEnd) {
  const db = await getDatabase();
  return await db.update(subscriptions).set({
    tier,
    stripeSubscriptionId,
    currentPeriodEnd,
    status: status ?? "active",
    updatedAt: /* @__PURE__ */ new Date()
  }).where(eq2(subscriptions.userId, userId));
}

// server/_core/stripeWebhook.ts
import { eq as eq3, sql as sql2 } from "drizzle-orm";
function redact(value) {
  if (value == null) return "<null>";
  const s = String(value);
  if (s.length <= 10) return "***";
  return `${s.slice(0, 4)}\u2026${s.slice(-4)}`;
}
async function handleStripeWebhook(req, res) {
  const signature = req.headers["stripe-signature"];
  if (!signature) {
    console.error("[Webhook] Missing stripe-signature header");
    return res.status(400).json({ error: "Missing signature" });
  }
  const secret = process.env.STRIPE_WEBHOOK_SECRET;
  if (!secret || secret === "whsec_placeholder") {
    console.error("[Webhook] STRIPE_WEBHOOK_SECRET is not configured");
    return res.status(500).json({ error: "Webhook not configured" });
  }
  let event;
  try {
    event = constructWebhookEvent(req.body, signature, secret);
  } catch (err) {
    console.error("[Webhook] Signature verification failed");
    return res.status(400).json({ error: "Webhook signature verification failed" });
  }
  if (event.id.startsWith("evt_test_")) {
    return res.json({ verified: true });
  }
  try {
    const db = await getDb();
    if (!db) throw new Error("Database connection failed");
    try {
      await db.insert(processedWebhookEvents).values({
        eventId: event.id,
        eventType: event.type
      });
    } catch (e) {
      console.log(`[Webhook] Event ${redact(event.id)} already processed; acking`);
      return res.json({ received: true, duplicate: true });
    }
    switch (event.type) {
      case "checkout.session.completed": {
        const session = event.data.object;
        const result = await handleCheckoutSessionCompleted(session);
        if (!result) break;
        if (result.type === "subscription") {
          console.log(
            `[Webhook] Subscription purchased user=${result.userId} tier=${result.tier} sub=${redact(
              result.stripeSubscriptionId
            )}`
          );
          await updateSubscription(
            result.userId,
            result.tier,
            result.stripeSubscriptionId
          );
        }
        if (result.type === "entry_fee") {
          console.log(
            `[Webhook] Entry fee paid user=${result.userId} game=${result.entryFeeGameId}`
          );
          if (result.entryFeeGameId && result.entryFeeAmount) {
            await db.insert(entryFeeParticipants).values([
              {
                entryFeeGameId: result.entryFeeGameId,
                userId: result.userId,
                entryFeeAmount: result.entryFeeAmount,
                payoutStatus: "pending"
              }
            ]);
          }
        }
        if (result.type === "add_on_games") {
          console.log(
            `[Webhook] Add-on games purchased user=${result.userId} qty=${result.quantity}`
          );
        }
        if (result.type === "golden_notes") {
          const gnUserId = result.userId;
          const gnNotes = result.notes ?? 0;
          const gnPackId = result.packId;
          const gnPaymentIntent = result.paymentIntentId ?? null;
          console.log(
            `[Webhook] Golden Notes purchased user=${gnUserId} pack=${gnPackId} notes=${gnNotes}`
          );
          if (gnUserId && gnNotes > 0) {
            await db.transaction(async (tx) => {
              await tx.insert(goldenNoteBalances).values({
                userId: gnUserId,
                balance: gnNotes,
                lifetimePurchased: gnNotes,
                lastPurchaseAt: /* @__PURE__ */ new Date()
              }).onConflictDoUpdate({
                target: goldenNoteBalances.userId,
                set: {
                  balance: sql2`${goldenNoteBalances.balance} + ${gnNotes}`,
                  lifetimePurchased: sql2`${goldenNoteBalances.lifetimePurchased} + ${gnNotes}`,
                  lastPurchaseAt: /* @__PURE__ */ new Date(),
                  updatedAt: /* @__PURE__ */ new Date()
                }
              });
              const [after] = await tx.select({ balance: goldenNoteBalances.balance }).from(goldenNoteBalances).where(eq3(goldenNoteBalances.userId, gnUserId));
              await tx.insert(goldenNoteTransactions).values({
                userId: gnUserId,
                amount: gnNotes,
                kind: "purchase",
                reason: gnPackId ? `pack:${gnPackId}` : null,
                stripePaymentIntentId: gnPaymentIntent,
                balanceAfter: after?.balance ?? gnNotes
              });
            });
          }
        }
        break;
      }
      case "invoice.paid": {
        const invoice = event.data.object;
        const result = await handleInvoicePaid(invoice);
        if (result.subscriptionId) {
          const newEnd = /* @__PURE__ */ new Date();
          newEnd.setMonth(newEnd.getMonth() + 1);
          await db.update(subscriptions).set({
            currentPeriodEnd: newEnd,
            status: "active",
            updatedAt: /* @__PURE__ */ new Date()
          }).where(
            eq3(subscriptions.stripeSubscriptionId, result.subscriptionId)
          );
          console.log(
            `[Webhook] Renewed subscription ${redact(result.subscriptionId)} until ${newEnd.toISOString().slice(0, 10)}`
          );
        }
        break;
      }
      case "invoice.payment_failed": {
        const invoice = event.data.object;
        const result = await handleInvoicePaymentFailed(invoice);
        if (!result?.subscriptionId) break;
        console.log(
          `[Webhook] Invoice payment failed sub=${redact(result.subscriptionId)} due=${result.amountDue}`
        );
        await db.update(subscriptions).set({ status: "past_due" }).where(eq3(subscriptions.stripeSubscriptionId, result.subscriptionId));
        break;
      }
      case "customer.subscription.updated": {
        const subscription = event.data.object;
        const result = await handleCustomerSubscriptionUpdated(subscription);
        if (!result || !result.userId) break;
        console.log(
          `[Webhook] Subscription updated user=${result.userId} status=${result.status} sub=${redact(result.subscriptionId)}`
        );
        await updateSubscription(
          result.userId,
          result.tier,
          result.subscriptionId,
          result.status,
          new Date(result.currentPeriodEnd * 1e3)
        );
        break;
      }
      case "customer.subscription.deleted": {
        const subscription = event.data.object;
        const result = await handleCustomerSubscriptionDeleted(subscription);
        await db.update(subscriptions).set({
          status: "canceled",
          canceledAt: /* @__PURE__ */ new Date(),
          tier: "free",
          updatedAt: /* @__PURE__ */ new Date()
        }).where(eq3(subscriptions.stripeSubscriptionId, result.subscriptionId));
        console.log(
          `[Webhook] Canceled subscription ${redact(result.subscriptionId)}`
        );
        break;
      }
      case "charge.refunded": {
        const charge = event.data.object;
        console.log(
          `[Webhook] Charge refunded id=${redact(charge.id)} amount=${charge.amount_refunded ?? 0}`
        );
        if (charge.payment_intent) {
          await db.update(entryFeeParticipants).set({ payoutStatus: "failed", updatedAt: /* @__PURE__ */ new Date() }).where(
            eq3(
              entryFeeParticipants.stripePayoutId,
              charge.payment_intent
            )
          );
        }
        if (charge.invoice) {
          const invoiceId = typeof charge.invoice === "string" ? charge.invoice : charge.invoice.id;
          if (charge.amount_refunded === charge.amount) {
            const stripeSubId = await getInvoiceSubscriptionId(invoiceId);
            console.log(
              `[Webhook] Full refund on subscription invoice=${redact(invoiceId)} sub=${redact(stripeSubId)} \u2014 marking canceled`
            );
            if (stripeSubId) {
              await db.update(subscriptions).set({
                status: "canceled",
                canceledAt: /* @__PURE__ */ new Date(),
                tier: "free",
                updatedAt: /* @__PURE__ */ new Date()
              }).where(eq3(subscriptions.stripeSubscriptionId, stripeSubId));
            }
          } else {
            console.log(
              `[Webhook] Partial refund on subscription invoice=${redact(invoiceId)} amount_refunded=${charge.amount_refunded ?? 0} \u2014 manual review needed`
            );
          }
        }
        break;
      }
      default:
        console.log(`[Webhook] Unhandled event type: ${event.type}`);
    }
    res.json({ received: true });
  } catch (error) {
    try {
      const db = await getDb();
      if (db) {
        await db.delete(processedWebhookEvents).where(eq3(processedWebhookEvents.eventId, event.id));
      }
    } catch {
    }
    console.error(
      `[Webhook] Error processing ${event.type} event=${redact(event.id)}:`,
      error instanceof Error ? error.message : "unknown"
    );
    res.status(500).json({ error: "Internal server error" });
  }
}

// api-src/stripe/webhook.ts
var config = {
  api: {
    // Stripe signature verification requires the raw request body. Disable
    // Vercel's default body parser so we can read the untouched buffer.
    bodyParser: false
  },
  runtime: "nodejs",
  // Stripe retries after ~20s without 2xx. Cold-start + raw-body parse +
  // signature verify + DB writes can approach the default lambda timeout.
  // 30s gives headroom while staying well under Stripe's retry threshold.
  maxDuration: 30
};
function readRawBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    req.on(
      "data",
      (chunk) => chunks.push(typeof chunk === "string" ? Buffer.from(chunk) : chunk)
    );
    req.on("end", () => resolve(Buffer.concat(chunks)));
    req.on("error", reject);
  });
}
async function handler(req, res) {
  if (req.method !== "POST") {
    res.status(405).json({ error: "Method not allowed" });
    return;
  }
  const raw = await readRawBody(req);
  req.body = raw;
  await handleStripeWebhook(
    req,
    res
  );
}
export {
  config,
  handler as default
};
