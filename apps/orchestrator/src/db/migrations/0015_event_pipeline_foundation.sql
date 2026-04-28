-- Migration 0015: Event pipeline foundation
-- Adds telemetry columns to task_runs for executor observability.
-- Creates prompt_pipeline_stages for end-to-end prompt lineage tracking.

-- ─── task_runs: executor telemetry columns ───────────────────────────────────
ALTER TABLE `task_runs` ADD COLUMN `executor_pid` integer;
--> statement-breakpoint
ALTER TABLE `task_runs` ADD COLUMN `worktree_path` text;
--> statement-breakpoint
ALTER TABLE `task_runs` ADD COLUMN `tool_call_count` integer DEFAULT 0;
--> statement-breakpoint
ALTER TABLE `task_runs` ADD COLUMN `input_tokens` integer DEFAULT 0;
--> statement-breakpoint
ALTER TABLE `task_runs` ADD COLUMN `output_tokens` integer DEFAULT 0;
--> statement-breakpoint
ALTER TABLE `task_runs` ADD COLUMN `files_changed` text DEFAULT '[]';
--> statement-breakpoint
ALTER TABLE `task_runs` ADD COLUMN `duration_ms` integer;
--> statement-breakpoint
ALTER TABLE `task_runs` ADD COLUMN `raw_claude_output` text;

--> statement-breakpoint
-- ─── prompt_pipeline_stages ──────────────────────────────────────────────────
CREATE TABLE `prompt_pipeline_stages` (
  `id`           text    PRIMARY KEY NOT NULL,
  `prompt_id`    text    NOT NULL REFERENCES `prompts`(`id`),
  `stage`        text    NOT NULL,
  `entity_kind`  text,
  `entity_id`    text,
  `entered_at`   integer NOT NULL,
  `duration_ms`  integer,
  `metadata`     text
);
--> statement-breakpoint
CREATE INDEX `pps_prompt_idx` ON `prompt_pipeline_stages` (`prompt_id`);
--> statement-breakpoint
CREATE INDEX `pps_stage_idx`  ON `prompt_pipeline_stages` (`stage`);
