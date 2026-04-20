-- Rollback for 0009_magenta_frank_castle.sql
-- Run ONLY if the migration needs to be reverted before Phase 4 ships.

-- Drop indexes first (on tables that will be dropped)
DROP INDEX `idx_fms_version` ON `feedback_manual_selections`;
DROP INDEX `idx_fms_feedback` ON `feedback_manual_selections`;
DROP INDEX `idx_feedback_evaluations_lookup` ON `feedback_evaluations`;

-- Drop FK constraint before dropping table
ALTER TABLE `feedback_manual_selections` DROP FOREIGN KEY `feedback_manual_selections_feedbackId_feedback_id_fk`;

-- Drop new tables
DROP TABLE IF EXISTS `feedback_manual_selections`;
DROP TABLE IF EXISTS `feedback_evaluations`;

-- Remove phase column additions (reverse order of addition)
ALTER TABLE `phases` DROP COLUMN `promptMode`;
ALTER TABLE `phases` DROP COLUMN `iterativeMeta`;
ALTER TABLE `phases` DROP COLUMN `initialGeneratorModel`;

-- Restore workflowState enum to its pre-migration state.
-- Any rows with new state values must be reset to a legacy state first.
-- This rollback assumes no iterative_review phases have been created,
-- which is true if rollback runs before Phase 2 completes.
UPDATE `phases` SET `workflowState` = 'awaiting_attorney_review'
WHERE `workflowState` IN (
  'awaiting_reviews', 'awaiting_feedback_action', 'evaluating_feedback',
  'awaiting_evaluation_decisions', 'awaiting_manual_decisions'
);

-- Restore the original enum value list (native enum extension path)
ALTER TABLE `phases` MODIFY COLUMN `workflowState` enum(
  'idle','model_selection','processing','drafting','awaiting_selection',
  'awaiting_attorney_review','revising','reviewing','evaluating',
  'awaiting_decisions','regenerating','accepted','formatting',
  'awaiting_format_review','complete'
) NOT NULL DEFAULT 'idle';
