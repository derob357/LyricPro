CREATE TABLE `processed_webhook_events` (
	`eventId` varchar(128) NOT NULL,
	`eventType` varchar(64) NOT NULL,
	`processedAt` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `processed_webhook_events_eventId` PRIMARY KEY(`eventId`)
);
