-- Migration 0007: Executor daemon tables + task column additions

ALTER TABLE `tasks` ADD COLUMN `attempt_count` integer NOT NULL DEFAULT 0;
--> statement-breakpoint
ALTER TABLE `tasks` ADD COLUMN `paused` integer NOT NULL DEFAULT 0;
--> statement-breakpoint
ALTER TABLE `tasks` ADD COLUMN `pause_reason` text;
--> statement-breakpoint
ALTER TABLE `tasks` ADD COLUMN `domain_slug` text;
--> statement-breakpoint
CREATE INDEX `task_paused_idx` ON `tasks` (`paused`, `status`);
--> statement-breakpoint

CREATE TABLE `executor_runs` (
  `id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
  `task_id` text NOT NULL,
  `attempt_n` integer NOT NULL DEFAULT 1,
  `session_id` text,
  `pid` integer,
  `worker_kind` text NOT NULL DEFAULT 'claude-p',
  `worktree_path` text,
  `started_at` text NOT NULL,
  `ended_at` text,
  `status` text NOT NULL DEFAULT 'running',
  `turn_count_at_end` integer,
  `result_summary` text,
  `failure_reason` text,
  `cost_usd` real
);
--> statement-breakpoint
CREATE INDEX `er_task_idx` ON `executor_runs` (`task_id`);
--> statement-breakpoint
CREATE INDEX `er_status_idx` ON `executor_runs` (`status`);
--> statement-breakpoint
CREATE INDEX `er_started_idx` ON `executor_runs` (`started_at`);

--> statement-breakpoint
CREATE TABLE `executor_config` (
  `id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
  `enabled` integer NOT NULL DEFAULT 0,
  `max_concurrent` integer NOT NULL DEFAULT 3,
  `max_per_domain_concurrent` integer NOT NULL DEFAULT 1,
  `circuit_breaker_threshold` integer NOT NULL DEFAULT 3,
  `poll_interval_ms` integer NOT NULL DEFAULT 10000,
  `monitor_interval_ms` integer NOT NULL DEFAULT 30000,
  `max_turns` integer NOT NULL DEFAULT 40,
  `permission_mode` text NOT NULL DEFAULT 'bypassPermissions',
  `updated_at` text NOT NULL
);

--> statement-breakpoint
CREATE TABLE `task_attempts` (
  `id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
  `task_id` text NOT NULL,
  `attempt_n` integer NOT NULL,
  `executor_run_id` integer,
  `status` text NOT NULL DEFAULT 'running',
  `started_at` text NOT NULL,
  `ended_at` text,
  `failure_reason` text
);
--> statement-breakpoint
CREATE INDEX `ta_task_idx` ON `task_attempts` (`task_id`);
--> statement-breakpoint
CREATE INDEX `ta_status_idx` ON `task_attempts` (`status`);
