ALTER TABLE `game_rooms` MODIFY COLUMN `usedSongIds` text;--> statement-breakpoint
ALTER TABLE `users` ADD `firstName` varchar(128);--> statement-breakpoint
ALTER TABLE `users` ADD `lastName` varchar(128);