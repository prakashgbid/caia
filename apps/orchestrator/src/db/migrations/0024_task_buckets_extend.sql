-- Migration 0024: BUCKET-001 — task_buckets gets project_slug + tech_sub_domain.
--
-- The bucket-placer's group key changes from (prompt_id, domain_slug) to
-- (prompt_id, project_slug, tech_sub_domain). Adding the columns here so
-- BUCKET-004 can switch the placement logic without a downstream migration.
--
-- domain_slug stays for backwards compatibility (existing rows continue to
-- read it); BUCKET-004 starts writing project_slug + tech_sub_domain on new
-- rows; a follow-up migration in BUCKET-007 cleans up legacy rows.

ALTER TABLE `task_buckets` ADD COLUMN `project_slug` text;
--> statement-breakpoint
ALTER TABLE `task_buckets` ADD COLUMN `tech_sub_domain` text;
--> statement-breakpoint
-- BUCKET-008: chain-fragmentation analyzer persists per-WCC level batches
-- here so the dashboard can render Kanban level-coloring without recomputing.
ALTER TABLE `task_buckets` ADD COLUMN `levels_json` text NOT NULL DEFAULT '[]';
--> statement-breakpoint

-- New composite index — placer queries by (prompt_id, project_slug, tech_sub_domain).
CREATE INDEX IF NOT EXISTS `idx_tb_prompt_project_tech` ON `task_buckets` (`prompt_id`, `project_slug`, `tech_sub_domain`);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `idx_tb_project_tech` ON `task_buckets` (`project_slug`, `tech_sub_domain`);
