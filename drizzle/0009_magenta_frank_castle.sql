CREATE TABLE `feedback_evaluations` (
	`id` int AUTO_INCREMENT NOT NULL,
	`matterId` varchar(36) NOT NULL,
	`phaseName` varchar(50) NOT NULL,
	`versionNumber` int NOT NULL,
	`evaluatorProvider` varchar(50) NOT NULL,
	`narrativeReasoning` text NOT NULL,
	`pointByPoint` json NOT NULL,
	`createdAt` timestamp DEFAULT (now()),
	CONSTRAINT `feedback_evaluations_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `feedback_manual_selections` (
	`id` int AUTO_INCREMENT NOT NULL,
	`feedbackId` int NOT NULL,
	`versionNumber` int NOT NULL,
	`selectionOrder` int NOT NULL,
	`selectionKind` enum('paragraph','span') NOT NULL,
	`sourceText` text NOT NULL,
	`precedingContext` text,
	`followingContext` text,
	`editedText` text,
	`decision` enum('accepted','modified') NOT NULL,
	`createdAt` timestamp DEFAULT (now()),
	CONSTRAINT `feedback_manual_selections_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
ALTER TABLE `phases` MODIFY COLUMN `workflowState` enum('idle','model_selection','processing','drafting','awaiting_selection','awaiting_attorney_review','revising','reviewing','evaluating','awaiting_decisions','regenerating','accepted','formatting','awaiting_format_review','complete','awaiting_reviews','awaiting_feedback_action','evaluating_feedback','awaiting_evaluation_decisions','awaiting_manual_decisions') NOT NULL DEFAULT 'idle';--> statement-breakpoint
ALTER TABLE `phases` ADD `initialGeneratorModel` varchar(50);--> statement-breakpoint
ALTER TABLE `phases` ADD `iterativeMeta` json;--> statement-breakpoint
ALTER TABLE `phases` ADD `promptMode` varchar(20) DEFAULT 'base';--> statement-breakpoint
ALTER TABLE `feedback_manual_selections` ADD CONSTRAINT `feedback_manual_selections_feedbackId_feedback_id_fk` FOREIGN KEY (`feedbackId`) REFERENCES `feedback`(`id`) ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX `idx_feedback_evaluations_lookup` ON `feedback_evaluations` (`matterId`,`phaseName`,`versionNumber`);--> statement-breakpoint
CREATE INDEX `idx_fms_feedback` ON `feedback_manual_selections` (`feedbackId`,`selectionOrder`);--> statement-breakpoint
CREATE INDEX `idx_fms_version` ON `feedback_manual_selections` (`versionNumber`);