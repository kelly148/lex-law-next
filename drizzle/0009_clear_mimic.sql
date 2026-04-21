CREATE TABLE `documents` (
	`id` int AUTO_INCREMENT NOT NULL,
	`matterId` varchar(36) NOT NULL,
	`phaseName` varchar(50) NOT NULL,
	`documentType` varchar(50) NOT NULL,
	`customTypeLabel` varchar(200),
	`title` varchar(200) NOT NULL,
	`notes` text,
	`status` enum('drafting','complete','archived') NOT NULL DEFAULT 'drafting',
	`workflowState` varchar(50) NOT NULL DEFAULT 'idle',
	`initialGeneratorModel` varchar(50),
	`iterativeMeta` json,
	`officialFinalVersionNumber` int,
	`promptMode` varchar(20) DEFAULT 'base',
	`createdAt` timestamp DEFAULT (now()),
	`updatedAt` timestamp DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `documents_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `feedback_evaluations` (
	`id` int AUTO_INCREMENT NOT NULL,
	`matterId` varchar(36) NOT NULL,
	`phaseName` varchar(50) NOT NULL,
	`versionNumber` int NOT NULL,
	`evaluatorProvider` varchar(50) NOT NULL,
	`narrativeReasoning` text NOT NULL,
	`pointByPoint` json NOT NULL,
	`documentId` int,
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
ALTER TABLE `feedback` ADD `documentId` int;--> statement-breakpoint
ALTER TABLE `matters` ADD `workflowModelVersion` int DEFAULT 2 NOT NULL;--> statement-breakpoint
ALTER TABLE `phases` ADD `initialGeneratorModel` varchar(50);--> statement-breakpoint
ALTER TABLE `phases` ADD `iterativeMeta` json;--> statement-breakpoint
ALTER TABLE `phases` ADD `promptMode` varchar(20) DEFAULT 'base';--> statement-breakpoint
ALTER TABLE `versions` ADD `documentId` int;--> statement-breakpoint
ALTER TABLE `versions` ADD CONSTRAINT `uniq_versions_document_version` UNIQUE(`documentId`,`versionNumber`);--> statement-breakpoint
ALTER TABLE `documents` ADD CONSTRAINT `documents_matterId_matters_id_fk` FOREIGN KEY (`matterId`) REFERENCES `matters`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `feedback_evaluations` ADD CONSTRAINT `feedback_evaluations_documentId_documents_id_fk` FOREIGN KEY (`documentId`) REFERENCES `documents`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `feedback_manual_selections` ADD CONSTRAINT `feedback_manual_selections_feedbackId_feedback_id_fk` FOREIGN KEY (`feedbackId`) REFERENCES `feedback`(`id`) ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX `idx_documents_matter_phase_status` ON `documents` (`matterId`,`phaseName`,`status`);--> statement-breakpoint
CREATE INDEX `idx_documents_matter_created` ON `documents` (`matterId`,`createdAt`);--> statement-breakpoint
CREATE INDEX `idx_feedback_evaluations_lookup` ON `feedback_evaluations` (`matterId`,`phaseName`,`versionNumber`);--> statement-breakpoint
CREATE INDEX `idx_feedback_evaluations_document_version` ON `feedback_evaluations` (`documentId`,`versionNumber`);--> statement-breakpoint
CREATE INDEX `idx_fms_feedback` ON `feedback_manual_selections` (`feedbackId`,`selectionOrder`);--> statement-breakpoint
CREATE INDEX `idx_fms_version` ON `feedback_manual_selections` (`versionNumber`);--> statement-breakpoint
ALTER TABLE `feedback` ADD CONSTRAINT `feedback_documentId_documents_id_fk` FOREIGN KEY (`documentId`) REFERENCES `documents`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `versions` ADD CONSTRAINT `versions_documentId_documents_id_fk` FOREIGN KEY (`documentId`) REFERENCES `documents`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX `idx_feedback_document_version` ON `feedback` (`documentId`,`versionNumber`);--> statement-breakpoint
CREATE INDEX `idx_versions_document_latest` ON `versions` (`documentId`,`versionNumber`);
--> statement-breakpoint
-- CHECK constraints on documents table (added manually; Drizzle MySQL dialect does not auto-generate these).
-- phaseName must be a document-holding phase only.
ALTER TABLE `documents` ADD CONSTRAINT `chk_documents_phaseName`
  CHECK (`phaseName` IN ('engagement', 'memo', 'matrix', 'agreement'));--> statement-breakpoint
-- workflowState must be one of the v2.3 expanded state values.
ALTER TABLE `documents` ADD CONSTRAINT `chk_documents_workflowState`
  CHECK (`workflowState` IN (
    'idle', 'model_selection', 'processing', 'drafting', 'awaiting_selection',
    'awaiting_attorney_review', 'revising', 'reviewing', 'evaluating',
    'awaiting_decisions', 'regenerating', 'accepted', 'formatting',
    'awaiting_format_review', 'complete',
    'awaiting_reviews', 'awaiting_feedback_action', 'evaluating_feedback',
    'awaiting_evaluation_decisions', 'awaiting_manual_decisions'
  ));--> statement-breakpoint
-- customTypeLabel must be present and non-empty when documentType is 'custom'.
ALTER TABLE `documents` ADD CONSTRAINT `chk_documents_custom_label`
  CHECK (`documentType` != 'custom' OR (`customTypeLabel` IS NOT NULL AND LENGTH(TRIM(`customTypeLabel`)) > 0));
