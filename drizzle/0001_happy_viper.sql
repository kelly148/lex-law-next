CREATE TABLE `fact_changes` (
	`id` int AUTO_INCREMENT NOT NULL,
	`matterId` varchar(64) NOT NULL,
	`description` text NOT NULL,
	`affectedPhases` json NOT NULL,
	`createdBy` int NOT NULL,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `fact_changes_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `feedback` (
	`id` int AUTO_INCREMENT NOT NULL,
	`matterId` varchar(64) NOT NULL,
	`phaseName` varchar(64) NOT NULL,
	`versionNumber` int NOT NULL,
	`reviewerProvider` varchar(64) NOT NULL,
	`category` varchar(128),
	`point` text NOT NULL,
	`decision` enum('pending','accepted','rejected','modified') NOT NULL DEFAULT 'pending',
	`attorneyNote` text,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `feedback_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `matters` (
	`id` int AUTO_INCREMENT NOT NULL,
	`matterId` varchar(64) NOT NULL,
	`jurisdiction` varchar(256) NOT NULL,
	`workflowPath` enum('full','core_only') NOT NULL DEFAULT 'full',
	`status` enum('active','completed','archived') NOT NULL DEFAULT 'active',
	`createdBy` int NOT NULL,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	`updatedAt` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `matters_id` PRIMARY KEY(`id`),
	CONSTRAINT `matters_matterId_unique` UNIQUE(`matterId`)
);
--> statement-breakpoint
CREATE TABLE `phases` (
	`id` int AUTO_INCREMENT NOT NULL,
	`matterId` varchar(64) NOT NULL,
	`phaseName` enum('intake','issues','planning','engagement','memo','matrix','agreement') NOT NULL,
	`phaseLabel` varchar(128) NOT NULL,
	`phaseOrder` int NOT NULL,
	`status` enum('not_started','in_progress','completed','skipped') NOT NULL DEFAULT 'not_started',
	`workflowState` enum('idle','drafting','awaiting_selection','reviewing','evaluating','awaiting_decisions','regenerating','complete') NOT NULL DEFAULT 'idle',
	`isOptional` int NOT NULL DEFAULT 0,
	`isStale` int NOT NULL DEFAULT 0,
	`workflowData` json,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	`updatedAt` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `phases_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `versions` (
	`id` int AUTO_INCREMENT NOT NULL,
	`matterId` varchar(64) NOT NULL,
	`phaseName` varchar(64) NOT NULL,
	`versionNumber` int NOT NULL,
	`provider` varchar(64) NOT NULL,
	`content` text NOT NULL,
	`isSelected` int NOT NULL DEFAULT 0,
	`metadata` json,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `versions_id` PRIMARY KEY(`id`)
);
