CREATE TABLE `addon_game_purchases` (
	`id` int AUTO_INCREMENT NOT NULL,
	`userId` int NOT NULL,
	`quantity` int NOT NULL,
	`pricePerGame` float NOT NULL,
	`totalAmount` float NOT NULL,
	`stripePaymentIntentId` varchar(256),
	`status` enum('pending','completed','failed') NOT NULL DEFAULT 'pending',
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `addon_game_purchases_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `daily_game_tracking` (
	`id` int AUTO_INCREMENT NOT NULL,
	`userId` int NOT NULL,
	`date` varchar(10) NOT NULL,
	`gamesPlayedToday` int NOT NULL DEFAULT 0,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	`updatedAt` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `daily_game_tracking_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `entry_fee_games` (
	`id` int AUTO_INCREMENT NOT NULL,
	`roomId` int NOT NULL,
	`entryFeeAmount` float NOT NULL,
	`gameType` enum('solo','team3','team5','team7') NOT NULL,
	`prizePoolAmount` float NOT NULL,
	`totalEntriesCollected` float NOT NULL,
	`status` enum('pending','in_progress','completed','cancelled') NOT NULL DEFAULT 'pending',
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	`completedAt` timestamp,
	CONSTRAINT `entry_fee_games_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `entry_fee_participants` (
	`id` int AUTO_INCREMENT NOT NULL,
	`entryFeeGameId` int NOT NULL,
	`userId` int NOT NULL,
	`entryFeeAmount` float NOT NULL,
	`finalScore` int DEFAULT 0,
	`placement` int,
	`prizeWon` float DEFAULT 0,
	`payoutStatus` enum('pending','processing','completed','failed') NOT NULL DEFAULT 'pending',
	`stripePayoutId` varchar(256),
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	`updatedAt` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `entry_fee_participants_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `subscriptions` (
	`id` int AUTO_INCREMENT NOT NULL,
	`userId` int NOT NULL,
	`tier` enum('free','player','pro','elite') NOT NULL DEFAULT 'free',
	`stripeSubscriptionId` varchar(256),
	`status` enum('active','paused','canceled','expired') NOT NULL DEFAULT 'active',
	`currentPeriodStart` timestamp,
	`currentPeriodEnd` timestamp,
	`canceledAt` timestamp,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	`updatedAt` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `subscriptions_id` PRIMARY KEY(`id`),
	CONSTRAINT `subscriptions_userId_unique` UNIQUE(`userId`)
);
--> statement-breakpoint
CREATE TABLE `user_wallets` (
	`id` int AUTO_INCREMENT NOT NULL,
	`userId` int NOT NULL,
	`availableBalance` float NOT NULL DEFAULT 0,
	`totalWinnings` float NOT NULL DEFAULT 0,
	`totalPayouts` float NOT NULL DEFAULT 0,
	`lastPayoutDate` timestamp,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	`updatedAt` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `user_wallets_id` PRIMARY KEY(`id`),
	CONSTRAINT `user_wallets_userId_unique` UNIQUE(`userId`)
);
