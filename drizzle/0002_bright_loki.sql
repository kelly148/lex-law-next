CREATE TABLE `uploads` (
	`id` int AUTO_INCREMENT NOT NULL,
	`matterId` varchar(64) NOT NULL,
	`phaseName` varchar(64) NOT NULL,
	`fileName` varchar(512) NOT NULL,
	`fileUrl` text NOT NULL,
	`contentType` varchar(128),
	`uploadedBy` int NOT NULL,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `uploads_id` PRIMARY KEY(`id`)
);
