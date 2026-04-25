CREATE TABLE `task_runs` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`session_id` text NOT NULL,
	`title` text NOT NULL,
	`kind` text NOT NULL DEFAULT 'task',
	`cwd` text,
	`prompt` text,
	`status` text NOT NULL DEFAULT 'pending',
	`project_slug` text,
	`domain_slugs` text NOT NULL DEFAULT '[]',
	`parent_session_id` text,
	`respawn_of_session_id` text,
	`started_at` text NOT NULL,
	`last_activity_at` text NOT NULL,
	`ended_at` text,
	`turn_count` integer NOT NULL DEFAULT 0,
	`completion_summary` text,
	`result_ok` integer
);
--> statement-breakpoint
CREATE UNIQUE INDEX `tr_session_id_idx` ON `task_runs` (`session_id`);
--> statement-breakpoint
CREATE INDEX `tr_status_idx` ON `task_runs` (`status`);
--> statement-breakpoint
CREATE INDEX `tr_started_idx` ON `task_runs` (`started_at`);
--> statement-breakpoint
CREATE INDEX `tr_project_idx` ON `task_runs` (`project_slug`);
--> statement-breakpoint
CREATE INDEX `tr_respawn_idx` ON `task_runs` (`respawn_of_session_id`);
--> statement-breakpoint
CREATE TABLE `task_subtasks` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`task_run_id` integer NOT NULL,
	`ordinal` integer,
	`title` text NOT NULL,
	`status` text NOT NULL DEFAULT 'pending',
	`source` text DEFAULT 'manual',
	`evidence_kind` text,
	`evidence_value` text,
	`started_at` text,
	`completed_at` text,
	`detail` text,
	FOREIGN KEY (`task_run_id`) REFERENCES `task_runs`(`id`) ON DELETE CASCADE
);
--> statement-breakpoint
CREATE INDEX `ts_task_run_idx` ON `task_subtasks` (`task_run_id`);
--> statement-breakpoint
CREATE TABLE `task_run_events` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`task_run_id` integer NOT NULL,
	`at` text NOT NULL,
	`turn_count` integer,
	`event_kind` text NOT NULL,
	`excerpt` text,
	`payload` text NOT NULL DEFAULT '{}',
	FOREIGN KEY (`task_run_id`) REFERENCES `task_runs`(`id`) ON DELETE CASCADE
);
--> statement-breakpoint
CREATE INDEX `tre_task_run_idx` ON `task_run_events` (`task_run_id`);
--> statement-breakpoint
CREATE INDEX `tre_at_idx` ON `task_run_events` (`at`);
