-- Migration 0009: Build run tracking
-- Captures every invocation of the build-runner wrapper with per-step detail.

CREATE TABLE `build_runs` (
  `id` text PRIMARY KEY NOT NULL,
  `trigger` text NOT NULL DEFAULT 'user',
  `git_sha` text,
  `branch` text,
  `changed_files_json` text NOT NULL DEFAULT '[]',
  `status` text NOT NULL DEFAULT 'running',
  `outcome` text,
  `started_at` text NOT NULL,
  `ended_at` text,
  `duration_ms` integer,
  `steps_total` integer NOT NULL DEFAULT 0,
  `steps_failed` integer NOT NULL DEFAULT 0,
  `error_signature` text,
  `metadata_json` text NOT NULL DEFAULT '{}'
);
--> statement-breakpoint
CREATE INDEX `br_status_idx` ON `build_runs` (`status`);
--> statement-breakpoint
CREATE INDEX `br_started_idx` ON `build_runs` (`started_at` DESC);
--> statement-breakpoint
CREATE INDEX `br_git_sha_idx` ON `build_runs` (`git_sha`);

--> statement-breakpoint
CREATE TABLE `build_steps` (
  `id` text PRIMARY KEY NOT NULL,
  `build_run_id` text NOT NULL REFERENCES `build_runs`(`id`),
  `step_name` text NOT NULL,
  `command` text NOT NULL,
  `step_order` integer NOT NULL DEFAULT 0,
  `status` text NOT NULL DEFAULT 'running',
  `exit_code` integer,
  `started_at` text NOT NULL,
  `ended_at` text,
  `duration_ms` integer,
  `stdout_tail` text,
  `stderr_tail` text,
  `error_signature` text,
  `max_rss_bytes` integer
);
--> statement-breakpoint
CREATE INDEX `bs_run_idx` ON `build_steps` (`build_run_id`);
--> statement-breakpoint
CREATE INDEX `bs_status_idx` ON `build_steps` (`status`);

--> statement-breakpoint
CREATE TABLE `build_retries` (
  `id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
  `build_run_id` text NOT NULL REFERENCES `build_runs`(`id`),
  `build_step_id` text NOT NULL REFERENCES `build_steps`(`id`),
  `attempt_n` integer NOT NULL DEFAULT 1,
  `exit_code` integer,
  `started_at` text NOT NULL,
  `ended_at` text,
  `error_signature` text
);
--> statement-breakpoint
CREATE INDEX `bret_run_idx` ON `build_retries` (`build_run_id`);
