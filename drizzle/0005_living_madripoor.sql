ALTER TABLE `game_rooms` ADD `inviteCode` varchar(6);--> statement-breakpoint
ALTER TABLE `game_rooms` ADD `inviteExpiresAt` timestamp;--> statement-breakpoint
ALTER TABLE `game_rooms` ADD CONSTRAINT `game_rooms_inviteCode_unique` UNIQUE(`inviteCode`);