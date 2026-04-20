-- Rollback for 0009_magenta_frank_castle.sql
-- Run ONLY if the migration needs to be reverted before Phase 4 ships.
-- Idempotent: safe to run even if migration was never applied or was partially applied.

-- Drop new tables (CASCADE handles indexes and FK constraints automatically in MySQL/TiDB)
DROP TABLE IF EXISTS `feedback_manual_selections`;
DROP TABLE IF EXISTS `feedback_evaluations`;

-- Remove phase column additions (reverse order of addition)
-- Use stored procedure pattern to make column drops idempotent
SET @col_exists = (SELECT COUNT(*) FROM information_schema.columns WHERE table_schema = DATABASE() AND table_name = 'phases' AND column_name = 'promptMode');
SET @sql = IF(@col_exists > 0, 'ALTER TABLE `phases` DROP COLUMN `promptMode`', 'SELECT 1');
PREPARE stmt FROM @sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

SET @col_exists = (SELECT COUNT(*) FROM information_schema.columns WHERE table_schema = DATABASE() AND table_name = 'phases' AND column_name = 'iterativeMeta');
SET @sql = IF(@col_exists > 0, 'ALTER TABLE `phases` DROP COLUMN `iterativeMeta`', 'SELECT 1');
PREPARE stmt FROM @sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

SET @col_exists = (SELECT COUNT(*) FROM information_schema.columns WHERE table_schema = DATABASE() AND table_name = 'phases' AND column_name = 'initialGeneratorModel');
SET @sql = IF(@col_exists > 0, 'ALTER TABLE `phases` DROP COLUMN `initialGeneratorModel`', 'SELECT 1');
PREPARE stmt FROM @sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

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
