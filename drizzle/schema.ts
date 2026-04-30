import {
  boolean,
  doublePrecision,
  integer,
  jsonb,
  pgEnum,
  pgTable,
  primaryKey,
  serial,
  text,
  timestamp,
  uniqueIndex,
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
  lyricSectionType: lyricSectionTypeEnum("lyricSectionType").notNull(),
  difficulty: difficultyEnum("difficulty").notNull(),
  language: varchar("language", { length: 16 }).default("en").notNull(),
  explicitFlag: boolean("explicitFlag").default(false).notNull(),
  approvalStatus: approvalStatusEnum("approvalStatus")
    .default("approved")
    .notNull(),
  isActive: boolean("isActive").default(true).notNull(),
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
  createdAt: createdAtColumn(),
});

export type RoundResult = typeof roundResults.$inferSelect;

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
