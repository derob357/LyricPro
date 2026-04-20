import {
  boolean,
  int,
  json,
  mysqlEnum,
  mysqlTable,
  text,
  timestamp,
  varchar,
  float,
} from "drizzle-orm/mysql-core";

// ─── Users ────────────────────────────────────────────────────────────────────
export const users = mysqlTable("users", {
  id: int("id").autoincrement().primaryKey(),
  openId: varchar("openId", { length: 64 }).notNull().unique(),
  name: text("name"),
  firstName: varchar("firstName", { length: 128 }),
  lastName: varchar("lastName", { length: 128 }),
  email: varchar("email", { length: 320 }),
  loginMethod: varchar("loginMethod", { length: 64 }),
  role: mysqlEnum("role", ["user", "admin"]).default("user").notNull(),
  avatarUrl: text("avatarUrl"),
  // Stats
  lifetimeScore: int("lifetimeScore").default(0).notNull(),
  totalWins: int("totalWins").default(0).notNull(),
  gamesPlayed: int("gamesPlayed").default(0).notNull(),
  rankTier: varchar("rankTier", { length: 32 }).default("Rookie").notNull(),
  premiumStatus: boolean("premiumStatus").default(false).notNull(),
  favoriteGenre: varchar("favoriteGenre", { length: 64 }),
  strongestDecade: varchar("strongestDecade", { length: 32 }),
  currentStreak: int("currentStreak").default(0).notNull(),
  longestStreak: int("longestStreak").default(0).notNull(),
  lyricAccuracy: float("lyricAccuracy").default(0),
  artistAccuracy: float("artistAccuracy").default(0),
  yearAccuracy: float("yearAccuracy").default(0),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
  lastSignedIn: timestamp("lastSignedIn").defaultNow().notNull(),
});

export type User = typeof users.$inferSelect;
export type InsertUser = typeof users.$inferInsert;

// ─── Guest Sessions ───────────────────────────────────────────────────────────
export const guestSessions = mysqlTable("guest_sessions", {
  id: int("id").autoincrement().primaryKey(),
  sessionToken: varchar("sessionToken", { length: 128 }).notNull().unique(),
  nickname: varchar("nickname", { length: 64 }).notNull(),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
});

export type GuestSession = typeof guestSessions.$inferSelect;

// ─── Artist Metadata ──────────────────────────────────────────────────────────
export const artistMetadata = mysqlTable("artist_metadata", {
  id: int("id").autoincrement().primaryKey(),
  artistName: varchar("artistName", { length: 256 }).notNull(),
  aliases: text("aliases"), // JSON array of alias strings
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
  createdAt: timestamp("createdAt").defaultNow().notNull(),
});

export type ArtistMetadata = typeof artistMetadata.$inferSelect;

// ─── Songs ────────────────────────────────────────────────────────────────────
export const songs = mysqlTable("songs", {
  id: int("id").autoincrement().primaryKey(),
  title: varchar("title", { length: 256 }).notNull(),
  artistName: varchar("artistName", { length: 256 }).notNull(),
  artistMetadataId: int("artistMetadataId"),
  genre: varchar("genre", { length: 64 }).notNull(),
  subgenre: varchar("subgenre", { length: 64 }),
  releaseYear: int("releaseYear").notNull(),
  decadeRange: varchar("decadeRange", { length: 32 }).notNull(), // e.g. "1980-1990"
  lyricPrompt: text("lyricPrompt").notNull(),
  lyricAnswer: text("lyricAnswer").notNull(),
  lyricSectionType: mysqlEnum("lyricSectionType", ["chorus", "hook", "verse", "call-response", "bridge"]).notNull(),
  difficulty: mysqlEnum("difficulty", ["low", "medium", "high"]).notNull(),
  language: varchar("language", { length: 16 }).default("en").notNull(),
  explicitFlag: boolean("explicitFlag").default(false).notNull(),
  approvalStatus: mysqlEnum("approvalStatus", ["pending", "approved", "rejected"]).default("approved").notNull(),
  isActive: boolean("isActive").default(true).notNull(),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
});

export type Song = typeof songs.$inferSelect;
export type InsertSong = typeof songs.$inferInsert;

// ─── Game Rooms ───────────────────────────────────────────────────────────────
export const gameRooms = mysqlTable("game_rooms", {
  id: int("id").autoincrement().primaryKey(),
  roomCode: varchar("roomCode", { length: 8 }).notNull().unique(),
  hostUserId: int("hostUserId"),
  hostGuestToken: varchar("hostGuestToken", { length: 128 }),
  mode: mysqlEnum("mode", ["solo", "multiplayer", "team"]).notNull(),
  rankingMode: mysqlEnum("rankingMode", ["total_points", "speed_bonus", "streak_bonus"]).default("total_points").notNull(),
  timerSeconds: int("timerSeconds").default(30).notNull(),
  roundsTotal: int("roundsTotal").default(10).notNull(),
  selectedGenres: text("selectedGenres").notNull(), // JSON array
  selectedDecades: text("selectedDecades").notNull(), // JSON array
  difficulty: mysqlEnum("difficulty", ["low", "medium", "high"]).default("medium").notNull(),
  explicitFilter: boolean("explicitFilter").default(false).notNull(),
  status: mysqlEnum("status", ["waiting", "active", "finished"]).default("waiting").notNull(),
  currentRound: int("currentRound").default(0).notNull(),
  currentPlayerIndex: int("currentPlayerIndex").default(0).notNull(),
  currentSongId: int("currentSongId"),
  usedSongIds: text("usedSongIds"), // JSON array, nullable
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
});

export type GameRoom = typeof gameRooms.$inferSelect;
export type InsertGameRoom = typeof gameRooms.$inferInsert;

// ─── Teams ────────────────────────────────────────────────────────────────────
export const teams = mysqlTable("teams", {
  id: int("id").autoincrement().primaryKey(),
  roomId: int("roomId").notNull(),
  teamName: varchar("teamName", { length: 64 }).notNull(),
  teamColor: varchar("teamColor", { length: 16 }).default("#8B5CF6").notNull(),
  currentScore: int("currentScore").default(0).notNull(),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
});

export type Team = typeof teams.$inferSelect;

// ─── Room Players ─────────────────────────────────────────────────────────────
export const roomPlayers = mysqlTable("room_players", {
  id: int("id").autoincrement().primaryKey(),
  roomId: int("roomId").notNull(),
  userId: int("userId"),
  guestToken: varchar("guestToken", { length: 128 }),
  guestName: varchar("guestName", { length: 64 }),
  teamId: int("teamId"),
  joinOrder: int("joinOrder").default(0).notNull(),
  currentScore: int("currentScore").default(0).notNull(),
  currentStreak: int("currentStreak").default(0).notNull(),
  isReady: boolean("isReady").default(false).notNull(),
  isActive: boolean("isActive").default(true).notNull(),
  joinedAt: timestamp("joinedAt").defaultNow().notNull(),
});

export type RoomPlayer = typeof roomPlayers.$inferSelect;

// ─── Game Sessions ────────────────────────────────────────────────────────────
export const gameSessions = mysqlTable("game_sessions", {
  id: int("id").autoincrement().primaryKey(),
  roomId: int("roomId"),
  userId: int("userId"),
  guestToken: varchar("guestToken", { length: 128 }),
  mode: mysqlEnum("mode", ["solo", "multiplayer", "team"]).notNull(),
  rankingMode: mysqlEnum("rankingMode", ["total_points", "speed_bonus", "streak_bonus"]).default("total_points").notNull(),
  finalScore: int("finalScore").default(0).notNull(),
  placement: int("placement"),
  startedAt: timestamp("startedAt").defaultNow().notNull(),
  endedAt: timestamp("endedAt"),
});

export type GameSession = typeof gameSessions.$inferSelect;

// ─── Round Results ────────────────────────────────────────────────────────────
export const roundResults = mysqlTable("round_results", {
  id: int("id").autoincrement().primaryKey(),
  sessionId: int("sessionId"),
  roomId: int("roomId"),
  roundNumber: int("roundNumber").notNull(),
  activePlayerId: int("activePlayerId"),
  activeGuestToken: varchar("activeGuestToken", { length: 128 }),
  songId: int("songId").notNull(),
  userLyricAnswer: text("userLyricAnswer"),
  userArtistAnswer: text("userArtistAnswer"),
  userYearAnswer: int("userYearAnswer"),
  answerMethod: mysqlEnum("answerMethod", ["typed", "voice"]).default("typed").notNull(),
  responseTimeSeconds: float("responseTimeSeconds"),
  lyricPoints: int("lyricPoints").default(0).notNull(),
  artistPoints: int("artistPoints").default(0).notNull(),
  yearPoints: int("yearPoints").default(0).notNull(),
  speedBonusPoints: int("speedBonusPoints").default(0).notNull(),
  streakBonusPoints: int("streakBonusPoints").default(0).notNull(),
  totalRoundPoints: int("totalRoundPoints").default(0).notNull(),
  passUsed: boolean("passUsed").default(false).notNull(),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
});

export type RoundResult = typeof roundResults.$inferSelect;

// ─── Leaderboard Entries ──────────────────────────────────────────────────────
export const leaderboardEntries = mysqlTable("leaderboard_entries", {
  id: int("id").autoincrement().primaryKey(),
  userId: int("userId"),
  guestName: varchar("guestName", { length: 64 }),
  displayName: varchar("displayName", { length: 64 }).notNull(),
  score: int("score").notNull(),
  mode: mysqlEnum("mode", ["solo", "multiplayer", "team"]).notNull(),
  genre: varchar("genre", { length: 64 }),
  decade: varchar("decade", { length: 32 }),
  rankingMode: varchar("rankingMode", { length: 32 }).notNull(),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
});

export type LeaderboardEntry = typeof leaderboardEntries.$inferSelect;

// ─── Prize Pools ──────────────────────────────────────────────────────────────
export const prizePools = mysqlTable("prize_pools", {
  id: int("id").autoincrement().primaryKey(),
  name: varchar("name", { length: 256 }).notNull(),
  description: text("description"),
  totalAmount: float("totalAmount").notNull(), // in USD
  distributedAmount: float("distributedAmount").default(0).notNull(),
  remainingAmount: float("remainingAmount").notNull(),
  status: mysqlEnum("status", ["active", "paused", "closed"]).default("active").notNull(),
  // Prize distribution rules (JSON)
  // Example: { "1st": 50, "2nd": 30, "3rd": 20 } (percentages)
  // Or: { "1st": 100, "2nd": 50, "3rd": 25 } (USD amounts)
  distributionRules: text("distributionRules").notNull(), // JSON
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
});

export type PrizePool = typeof prizePools.$inferSelect;
export type InsertPrizePool = typeof prizePools.$inferInsert;

// ─── Prize Payouts ────────────────────────────────────────────────────────────
export const prizePayouts = mysqlTable("prize_payouts", {
  id: int("id").autoincrement().primaryKey(),
  prizePoolId: int("prizePoolId").notNull(),
  userId: int("userId").notNull(),
  amount: float("amount").notNull(), // in USD
  rank: int("rank").notNull(), // 1st, 2nd, 3rd, etc.
  reason: varchar("reason", { length: 256 }).notNull(), // e.g., "Weekly Leaderboard Winner"
  status: mysqlEnum("status", ["pending", "processing", "completed", "failed"]).default("pending").notNull(),
  stripePayoutId: varchar("stripePayoutId", { length: 256 }), // Stripe payout ID
  failureReason: text("failureReason"), // If status is failed
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
});

export type PrizePayout = typeof prizePayouts.$inferSelect;
export type InsertPrizePayout = typeof prizePayouts.$inferInsert;

// ─── Stripe Accounts ──────────────────────────────────────────────────────────
export const stripeAccounts = mysqlTable("stripe_accounts", {
  id: int("id").autoincrement().primaryKey(),
  userId: int("userId").notNull().unique(),
  stripeConnectAccountId: varchar("stripeConnectAccountId", { length: 256 }).notNull().unique(),
  status: mysqlEnum("status", ["pending", "verified", "restricted", "disabled"]).default("pending").notNull(),
  bankAccountVerified: boolean("bankAccountVerified").default(false).notNull(),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
});

export type StripeAccount = typeof stripeAccounts.$inferSelect;
export type InsertStripeAccount = typeof stripeAccounts.$inferInsert;

// ─── Payout Requests ──────────────────────────────────────────────────────────
export const payoutRequests = mysqlTable("payout_requests", {
  id: int("id").autoincrement().primaryKey(),
  userId: int("userId").notNull(),
  amount: float("amount").notNull(), // in USD
  status: mysqlEnum("status", ["pending", "approved", "rejected", "paid"]).default("pending").notNull(),
  stripePayoutId: varchar("stripePayoutId", { length: 256 }), // Stripe payout ID
  rejectionReason: text("rejectionReason"), // If status is rejected
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
});

export type PayoutRequest = typeof payoutRequests.$inferSelect;
export type InsertPayoutRequest = typeof payoutRequests.$inferInsert;

// ─── Subscriptions ────────────────────────────────────────────────────────────
export const subscriptions = mysqlTable("subscriptions", {
  id: int("id").autoincrement().primaryKey(),
  userId: int("userId").notNull().unique(),
  tier: mysqlEnum("tier", ["free", "player", "pro", "elite"]).default("free").notNull(),
  stripeSubscriptionId: varchar("stripeSubscriptionId", { length: 256 }),
  status: mysqlEnum("status", ["active", "paused", "canceled", "expired"]).default("active").notNull(),
  currentPeriodStart: timestamp("currentPeriodStart"),
  currentPeriodEnd: timestamp("currentPeriodEnd"),
  canceledAt: timestamp("canceledAt"),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
});

export type Subscription = typeof subscriptions.$inferSelect;
export type InsertSubscription = typeof subscriptions.$inferInsert;

// ─── Daily Game Tracking ──────────────────────────────────────────────────────
export const dailyGameTracking = mysqlTable("daily_game_tracking", {
  id: int("id").autoincrement().primaryKey(),
  userId: int("userId").notNull(),
  date: varchar("date", { length: 10 }).notNull(), // YYYY-MM-DD format
  gamesPlayedToday: int("gamesPlayedToday").default(0).notNull(),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
});

export type DailyGameTracking = typeof dailyGameTracking.$inferSelect;
export type InsertDailyGameTracking = typeof dailyGameTracking.$inferInsert;

// ─── Entry Fee Games ──────────────────────────────────────────────────────────
export const entryFeeGames = mysqlTable("entry_fee_games", {
  id: int("id").autoincrement().primaryKey(),
  roomId: int("roomId").notNull(),
  entryFeeAmount: float("entryFeeAmount").notNull(), // in USD
  gameType: mysqlEnum("gameType", ["solo", "team3", "team5", "team7"]).notNull(),
  prizePoolAmount: float("prizePoolAmount").notNull(), // 30% of total entry fees
  totalEntriesCollected: float("totalEntriesCollected").notNull(), // sum of all entry fees
  status: mysqlEnum("status", ["pending", "in_progress", "completed", "cancelled"]).default("pending").notNull(),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  completedAt: timestamp("completedAt"),
});

export type EntryFeeGame = typeof entryFeeGames.$inferSelect;
export type InsertEntryFeeGame = typeof entryFeeGames.$inferInsert;

// ─── Entry Fee Participants ───────────────────────────────────────────────────
export const entryFeeParticipants = mysqlTable("entry_fee_participants", {
  id: int("id").autoincrement().primaryKey(),
  entryFeeGameId: int("entryFeeGameId").notNull(),
  userId: int("userId").notNull(),
  entryFeeAmount: float("entryFeeAmount").notNull(),
  finalScore: int("finalScore").default(0),
  placement: int("placement"), // 1st, 2nd, 3rd, etc.
  prizeWon: float("prizeWon").default(0),
  payoutStatus: mysqlEnum("payoutStatus", ["pending", "processing", "completed", "failed"]).default("pending").notNull(),
  stripePayoutId: varchar("stripePayoutId", { length: 256 }),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
});

export type EntryFeeParticipant = typeof entryFeeParticipants.$inferSelect;
export type InsertEntryFeeParticipant = typeof entryFeeParticipants.$inferInsert;

// ─── Add-On Game Purchases ────────────────────────────────────────────────────
export const addOnGamePurchases = mysqlTable("addon_game_purchases", {
  id: int("id").autoincrement().primaryKey(),
  userId: int("userId").notNull(),
  quantity: int("quantity").notNull(), // number of 5-round games
  pricePerGame: float("pricePerGame").notNull(), // $0.99
  totalAmount: float("totalAmount").notNull(),
  stripePaymentIntentId: varchar("stripePaymentIntentId", { length: 256 }),
  status: mysqlEnum("status", ["pending", "completed", "failed"]).default("pending").notNull(),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
});

export type AddOnGamePurchase = typeof addOnGamePurchases.$inferSelect;
export type InsertAddOnGamePurchase = typeof addOnGamePurchases.$inferInsert;

// ─── User Wallet / Balance ────────────────────────────────────────────────────
export const userWallets = mysqlTable("user_wallets", {
  id: int("id").autoincrement().primaryKey(),
  userId: int("userId").notNull().unique(),
  availableBalance: float("availableBalance").default(0).notNull(), // winnings available for payout
  totalWinnings: float("totalWinnings").default(0).notNull(), // lifetime winnings
  totalPayouts: float("totalPayouts").default(0).notNull(), // lifetime paid out
  lastPayoutDate: timestamp("lastPayoutDate"),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
});

export type UserWallet = typeof userWallets.$inferSelect;
export type InsertUserWallet = typeof userWallets.$inferInsert;

// ─── Stripe Webhook Idempotency ───────────────────────────────────────────────
// One row per successfully-processed Stripe event. On every webhook delivery
// we INSERT IGNORE by eventId; if the row already exists we skip processing.
export const processedWebhookEvents = mysqlTable("processed_webhook_events", {
  eventId: varchar("eventId", { length: 128 }).primaryKey(),
  eventType: varchar("eventType", { length: 64 }).notNull(),
  processedAt: timestamp("processedAt").defaultNow().notNull(),
});

export type ProcessedWebhookEvent = typeof processedWebhookEvents.$inferSelect;
export type InsertProcessedWebhookEvent = typeof processedWebhookEvents.$inferInsert;
