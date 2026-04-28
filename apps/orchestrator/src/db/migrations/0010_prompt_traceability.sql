-- Migration 0010: Prompt traceability — root-cause lineage from prompt to every descendant
-- Tables: prompts, prompt_responses, task_status_transitions
-- Alters: stories, requirements, tasks, task_runs, blockers, questions

CREATE TABLE `prompts` (
  `id` text PRIMARY KEY NOT NULL,
  `body` text NOT NULL,
  `received_at` text NOT NULL,
  `received_via` text NOT NULL DEFAULT 'chat',
  `user_id` text,
  `session_id` text,
  `correlation_id` text NOT NULL,
  `hash` text NOT NULL,
  `tokens_in` integer,
  `metadata_json` text NOT NULL DEFAULT '{}',
  `status` text NOT NULL DEFAULT 'received',
  `completed_at` text,
  `elapsed_ms` integer
);
--> statement-breakpoint
CREATE INDEX `prm_received_idx` ON `prompts` (`received_at` DESC);
--> statement-breakpoint
CREATE INDEX `prm_user_idx` ON `prompts` (`user_id`, `received_at` DESC);
--> statement-breakpoint
CREATE INDEX `prm_status_idx` ON `prompts` (`status`);
--> statement-breakpoint
CREATE INDEX `prm_hash_idx` ON `prompts` (`hash`);

--> statement-breakpoint
CREATE TABLE `prompt_responses` (
  `id` text PRIMARY KEY NOT NULL,
  `prompt_id` text NOT NULL REFERENCES `prompts`(`id`),
  `response_body` text NOT NULL DEFAULT '',
  `responded_at` text NOT NULL,
  `response_kind` text NOT NULL DEFAULT 'chat',
  `tokens_out` integer,
  `decomposition_tree_json` text
);
--> statement-breakpoint
CREATE INDEX `pr_prompt_idx` ON `prompt_responses` (`prompt_id`);

--> statement-breakpoint
CREATE TABLE `task_status_transitions` (
  `id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
  `task_id` text NOT NULL REFERENCES `tasks`(`id`),
  `from_status` text,
  `to_status` text NOT NULL,
  `transitioned_at` text NOT NULL,
  `actor` text NOT NULL DEFAULT 'system',
  `trigger_event_id` text,
  `notes` text,
  `root_prompt_id` text
);
--> statement-breakpoint
CREATE INDEX `tst_task_idx` ON `task_status_transitions` (`task_id`);
--> statement-breakpoint
CREATE INDEX `tst_prompt_idx` ON `task_status_transitions` (`root_prompt_id`);
--> statement-breakpoint
CREATE INDEX `tst_at_idx` ON `task_status_transitions` (`transitioned_at`);

--> statement-breakpoint
ALTER TABLE `stories` ADD COLUMN `root_prompt_id` text;
--> statement-breakpoint
ALTER TABLE `stories` ADD COLUMN `parent_entity_type` text;
--> statement-breakpoint
ALTER TABLE `stories` ADD COLUMN `parent_entity_id` text;
--> statement-breakpoint
CREATE INDEX `story_root_prompt_idx` ON `stories` (`root_prompt_id`);
--> statement-breakpoint
CREATE INDEX `story_parent_entity_idx` ON `stories` (`parent_entity_id`);

--> statement-breakpoint
ALTER TABLE `requirements` ADD COLUMN `root_prompt_id` text;
--> statement-breakpoint
ALTER TABLE `requirements` ADD COLUMN `parent_entity_type` text;
--> statement-breakpoint
ALTER TABLE `requirements` ADD COLUMN `parent_entity_id` text;
--> statement-breakpoint
CREATE INDEX `req_root_prompt_idx` ON `requirements` (`root_prompt_id`);
--> statement-breakpoint
CREATE INDEX `req_parent_entity_idx` ON `requirements` (`parent_entity_id`);

--> statement-breakpoint
ALTER TABLE `tasks` ADD COLUMN `root_prompt_id` text;
--> statement-breakpoint
ALTER TABLE `tasks` ADD COLUMN `parent_entity_type` text;
--> statement-breakpoint
ALTER TABLE `tasks` ADD COLUMN `parent_entity_id` text;
--> statement-breakpoint
CREATE INDEX `task_root_prompt_idx` ON `tasks` (`root_prompt_id`);
--> statement-breakpoint
CREATE INDEX `task_parent_entity_idx` ON `tasks` (`parent_entity_id`);

--> statement-breakpoint
ALTER TABLE `task_runs` ADD COLUMN `root_prompt_id` text;
--> statement-breakpoint
ALTER TABLE `task_runs` ADD COLUMN `parent_entity_type` text;
--> statement-breakpoint
ALTER TABLE `task_runs` ADD COLUMN `parent_entity_id` text;
--> statement-breakpoint
CREATE INDEX `tr_root_prompt_idx` ON `task_runs` (`root_prompt_id`);
--> statement-breakpoint
CREATE INDEX `tr_parent_entity_idx` ON `task_runs` (`parent_entity_id`);

--> statement-breakpoint
ALTER TABLE `blockers` ADD COLUMN `root_prompt_id` text;
--> statement-breakpoint
ALTER TABLE `blockers` ADD COLUMN `parent_entity_type` text;
--> statement-breakpoint
ALTER TABLE `blockers` ADD COLUMN `parent_entity_id` text;
--> statement-breakpoint
CREATE INDEX `blocker_root_prompt_idx` ON `blockers` (`root_prompt_id`);
--> statement-breakpoint
CREATE INDEX `blocker_parent_entity_idx` ON `blockers` (`parent_entity_id`);

--> statement-breakpoint
ALTER TABLE `questions` ADD COLUMN `root_prompt_id` text;
--> statement-breakpoint
ALTER TABLE `questions` ADD COLUMN `parent_entity_type` text;
--> statement-breakpoint
ALTER TABLE `questions` ADD COLUMN `parent_entity_id` text;
--> statement-breakpoint
CREATE INDEX `question_root_prompt_idx` ON `questions` (`root_prompt_id`);
--> statement-breakpoint
CREATE INDEX `question_parent_entity_idx` ON `questions` (`parent_entity_id`);
