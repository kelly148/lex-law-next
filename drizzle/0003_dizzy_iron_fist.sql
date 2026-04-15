ALTER TABLE `phases` MODIFY COLUMN `status` enum('not_started','in_progress','completed','skipped','waiting_on_client') NOT NULL DEFAULT 'not_started';--> statement-breakpoint
ALTER TABLE `phases` MODIFY COLUMN `workflowState` enum('idle','model_selection','processing','drafting','awaiting_selection','awaiting_attorney_review','revising','reviewing','evaluating','awaiting_decisions','regenerating','accepted','formatting','awaiting_format_review','complete') NOT NULL DEFAULT 'idle';--> statement-breakpoint
ALTER TABLE `phases` ADD `activeWorkflowMode` varchar(64);--> statement-breakpoint
ALTER TABLE `phases` ADD `selectedModelId` varchar(64);--> statement-breakpoint
ALTER TABLE `phases` ADD `acceptedSubstantiveVersion` int;--> statement-breakpoint
ALTER TABLE `phases` ADD `officialFinalVersion` int;--> statement-breakpoint
ALTER TABLE `versions` ADD `isFormattingPass` int DEFAULT 0 NOT NULL;