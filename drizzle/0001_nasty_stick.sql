CREATE TABLE `artist_metadata` (
	`id` int AUTO_INCREMENT NOT NULL,
	`artistName` varchar(256) NOT NULL,
	`aliases` text,
	`officialWebsite` text,
	`instagramUrl` text,
	`facebookUrl` text,
	`xUrl` text,
	`tiktokUrl` text,
	`youtubeUrl` text,
	`spotifyUrl` text,
	`appleMusicUrl` text,
	`newsSearchUrl` text,
	`isActive` boolean NOT NULL DEFAULT true,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `artist_metadata_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `game_rooms` (
	`id` int AUTO_INCREMENT NOT NULL,
	`roomCode` varchar(8) NOT NULL,
	`hostUserId` int,
	`hostGuestToken` varchar(128),
	`mode` enum('solo','multiplayer','team') NOT NULL,
	`rankingMode` enum('total_points','speed_bonus','streak_bonus') NOT NULL DEFAULT 'total_points',
	`timerSeconds` int NOT NULL DEFAULT 30,
	`roundsTotal` int NOT NULL DEFAULT 10,
	`selectedGenres` text NOT NULL,
	`selectedDecades` text NOT NULL,
	`difficulty` enum('low','medium','high') NOT NULL DEFAULT 'medium',
	`explicitFilter` boolean NOT NULL DEFAULT false,
	`status` enum('waiting','active','finished') NOT NULL DEFAULT 'waiting',
	`currentRound` int NOT NULL DEFAULT 0,
	`currentPlayerIndex` int NOT NULL DEFAULT 0,
	`currentSongId` int,
	`usedSongIds` text NOT NULL DEFAULT ('[]'),
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	`updatedAt` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `game_rooms_id` PRIMARY KEY(`id`),
	CONSTRAINT `game_rooms_roomCode_unique` UNIQUE(`roomCode`)
);
--> statement-breakpoint
CREATE TABLE `game_sessions` (
	`id` int AUTO_INCREMENT NOT NULL,
	`roomId` int,
	`userId` int,
	`guestToken` varchar(128),
	`mode` enum('solo','multiplayer','team') NOT NULL,
	`rankingMode` enum('total_points','speed_bonus','streak_bonus') NOT NULL DEFAULT 'total_points',
	`finalScore` int NOT NULL DEFAULT 0,
	`placement` int,
	`startedAt` timestamp NOT NULL DEFAULT (now()),
	`endedAt` timestamp,
	CONSTRAINT `game_sessions_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `guest_sessions` (
	`id` int AUTO_INCREMENT NOT NULL,
	`sessionToken` varchar(128) NOT NULL,
	`nickname` varchar(64) NOT NULL,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `guest_sessions_id` PRIMARY KEY(`id`),
	CONSTRAINT `guest_sessions_sessionToken_unique` UNIQUE(`sessionToken`)
);
--> statement-breakpoint
CREATE TABLE `leaderboard_entries` (
	`id` int AUTO_INCREMENT NOT NULL,
	`userId` int,
	`guestName` varchar(64),
	`displayName` varchar(64) NOT NULL,
	`score` int NOT NULL,
	`mode` enum('solo','multiplayer','team') NOT NULL,
	`genre` varchar(64),
	`decade` varchar(32),
	`rankingMode` varchar(32) NOT NULL,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `leaderboard_entries_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `room_players` (
	`id` int AUTO_INCREMENT NOT NULL,
	`roomId` int NOT NULL,
	`userId` int,
	`guestToken` varchar(128),
	`guestName` varchar(64),
	`teamId` int,
	`joinOrder` int NOT NULL DEFAULT 0,
	`currentScore` int NOT NULL DEFAULT 0,
	`currentStreak` int NOT NULL DEFAULT 0,
	`isReady` boolean NOT NULL DEFAULT false,
	`isActive` boolean NOT NULL DEFAULT true,
	`joinedAt` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `room_players_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `round_results` (
	`id` int AUTO_INCREMENT NOT NULL,
	`sessionId` int,
	`roomId` int,
	`roundNumber` int NOT NULL,
	`activePlayerId` int,
	`activeGuestToken` varchar(128),
	`songId` int NOT NULL,
	`userLyricAnswer` text,
	`userArtistAnswer` text,
	`userYearAnswer` int,
	`answerMethod` enum('typed','voice') NOT NULL DEFAULT 'typed',
	`responseTimeSeconds` float,
	`lyricPoints` int NOT NULL DEFAULT 0,
	`artistPoints` int NOT NULL DEFAULT 0,
	`yearPoints` int NOT NULL DEFAULT 0,
	`speedBonusPoints` int NOT NULL DEFAULT 0,
	`streakBonusPoints` int NOT NULL DEFAULT 0,
	`totalRoundPoints` int NOT NULL DEFAULT 0,
	`passUsed` boolean NOT NULL DEFAULT false,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `round_results_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `songs` (
	`id` int AUTO_INCREMENT NOT NULL,
	`title` varchar(256) NOT NULL,
	`artistName` varchar(256) NOT NULL,
	`artistMetadataId` int,
	`genre` varchar(64) NOT NULL,
	`subgenre` varchar(64),
	`releaseYear` int NOT NULL,
	`decadeRange` varchar(32) NOT NULL,
	`lyricPrompt` text NOT NULL,
	`lyricAnswer` text NOT NULL,
	`lyricSectionType` enum('chorus','hook','verse','call-response','bridge') NOT NULL,
	`difficulty` enum('low','medium','high') NOT NULL,
	`language` varchar(16) NOT NULL DEFAULT 'en',
	`explicitFlag` boolean NOT NULL DEFAULT false,
	`approvalStatus` enum('pending','approved','rejected') NOT NULL DEFAULT 'approved',
	`isActive` boolean NOT NULL DEFAULT true,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	`updatedAt` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `songs_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `teams` (
	`id` int AUTO_INCREMENT NOT NULL,
	`roomId` int NOT NULL,
	`teamName` varchar(64) NOT NULL,
	`teamColor` varchar(16) NOT NULL DEFAULT '#8B5CF6',
	`currentScore` int NOT NULL DEFAULT 0,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `teams_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
ALTER TABLE `users` ADD `avatarUrl` text;--> statement-breakpoint
ALTER TABLE `users` ADD `lifetimeScore` int DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE `users` ADD `totalWins` int DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE `users` ADD `gamesPlayed` int DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE `users` ADD `rankTier` varchar(32) DEFAULT 'Rookie' NOT NULL;--> statement-breakpoint
ALTER TABLE `users` ADD `premiumStatus` boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE `users` ADD `favoriteGenre` varchar(64);--> statement-breakpoint
ALTER TABLE `users` ADD `strongestDecade` varchar(32);--> statement-breakpoint
ALTER TABLE `users` ADD `currentStreak` int DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE `users` ADD `longestStreak` int DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE `users` ADD `lyricAccuracy` float DEFAULT 0;--> statement-breakpoint
ALTER TABLE `users` ADD `artistAccuracy` float DEFAULT 0;--> statement-breakpoint
ALTER TABLE `users` ADD `yearAccuracy` float DEFAULT 0;