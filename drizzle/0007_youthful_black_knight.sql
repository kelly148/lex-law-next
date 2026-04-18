CREATE TABLE `matter_folders` (
	`id` int AUTO_INCREMENT NOT NULL,
	`folderId` varchar(64) NOT NULL,
	`name` varchar(256) NOT NULL,
	`color` varchar(32) NOT NULL DEFAULT '#2E75B6',
	`createdBy` int NOT NULL,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	`updatedAt` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `matter_folders_id` PRIMARY KEY(`id`),
	CONSTRAINT `matter_folders_folderId_unique` UNIQUE(`folderId`)
);
--> statement-breakpoint
ALTER TABLE `matters` ADD `folderId` varchar(64);