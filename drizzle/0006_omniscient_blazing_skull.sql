ALTER TABLE `game_rooms` DROP INDEX `game_rooms_inviteCode_unique`;--> statement-breakpoint
ALTER TABLE `game_rooms` DROP COLUMN `inviteCode`;--> statement-breakpoint
ALTER TABLE `game_rooms` DROP COLUMN `inviteExpiresAt`;