-- 0045_recommendations — formal recommendation records for spike/research tasks.
-- When an AI worker completes a spike and must "recommend one" option, it
-- writes a row here via the `recommend_one` MCP tool. `chosen` names the
-- selected option; `alternatives` (JSON array) preserves the decision audit.
CREATE TABLE IF NOT EXISTS `recommendations` (
  `id` text PRIMARY KEY,
  `title` text NOT NULL,
  `chosen` text NOT NULL,
  `rationale` text NOT NULL DEFAULT '',
  `alternatives` text NOT NULL DEFAULT '[]',
  `context` text NOT NULL DEFAULT '',
  `task_id` text,
  `requirement_id` text,
  `project_id` text REFERENCES `projects`(`id`),
  `scope` text NOT NULL DEFAULT 'global',
  `created_at` text NOT NULL
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `rcm_project_idx` ON `recommendations` (`project_id`);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `rcm_task_idx` ON `recommendations` (`task_id`);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `rcm_created_idx` ON `recommendations` (`created_at`);
