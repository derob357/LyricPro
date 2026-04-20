CREATE TABLE `payout_requests` (
	`id` int AUTO_INCREMENT NOT NULL,
	`userId` int NOT NULL,
	`amount` float NOT NULL,
	`status` enum('pending','approved','rejected','paid') NOT NULL DEFAULT 'pending',
	`stripePayoutId` varchar(256),
	`rejectionReason` text,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	`updatedAt` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `payout_requests_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `prize_payouts` (
	`id` int AUTO_INCREMENT NOT NULL,
	`prizePoolId` int NOT NULL,
	`userId` int NOT NULL,
	`amount` float NOT NULL,
	`rank` int NOT NULL,
	`reason` varchar(256) NOT NULL,
	`status` enum('pending','processing','completed','failed') NOT NULL DEFAULT 'pending',
	`stripePayoutId` varchar(256),
	`failureReason` text,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	`updatedAt` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `prize_payouts_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `prize_pools` (
	`id` int AUTO_INCREMENT NOT NULL,
	`name` varchar(256) NOT NULL,
	`description` text,
	`totalAmount` float NOT NULL,
	`distributedAmount` float NOT NULL DEFAULT 0,
	`remainingAmount` float NOT NULL,
	`status` enum('active','paused','closed') NOT NULL DEFAULT 'active',
	`distributionRules` text NOT NULL,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	`updatedAt` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `prize_pools_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `stripe_accounts` (
	`id` int AUTO_INCREMENT NOT NULL,
	`userId` int NOT NULL,
	`stripeConnectAccountId` varchar(256) NOT NULL,
	`status` enum('pending','verified','restricted','disabled') NOT NULL DEFAULT 'pending',
	`bankAccountVerified` boolean NOT NULL DEFAULT false,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	`updatedAt` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `stripe_accounts_id` PRIMARY KEY(`id`),
	CONSTRAINT `stripe_accounts_userId_unique` UNIQUE(`userId`),
	CONSTRAINT `stripe_accounts_stripeConnectAccountId_unique` UNIQUE(`stripeConnectAccountId`)
);
