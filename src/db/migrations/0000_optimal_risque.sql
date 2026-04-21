CREATE TABLE `adrs` (
	`id` text PRIMARY KEY NOT NULL,
	`number` integer NOT NULL,
	`title` text NOT NULL,
	`status` text DEFAULT 'proposed' NOT NULL,
	`context` text DEFAULT '' NOT NULL,
	`decision` text DEFAULT '' NOT NULL,
	`consequences` text DEFAULT '' NOT NULL,
	`alternatives` text DEFAULT '[]' NOT NULL,
	`supersedes` text,
	`project_id` text,
	`scope` text DEFAULT 'global' NOT NULL,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	FOREIGN KEY (`project_id`) REFERENCES `projects`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `adr_project_idx` ON `adrs` (`project_id`);--> statement-breakpoint
CREATE INDEX `adr_number_idx` ON `adrs` (`number`);--> statement-breakpoint
CREATE TABLE `audit_log` (
	`id` text PRIMARY KEY NOT NULL,
	`actor` text DEFAULT 'ai' NOT NULL,
	`action` text NOT NULL,
	`entity_kind` text NOT NULL,
	`entity_id` text NOT NULL,
	`before` text,
	`after` text,
	`project_id` text,
	`created_at` text NOT NULL,
	FOREIGN KEY (`project_id`) REFERENCES `projects`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `audit_entity_idx` ON `audit_log` (`entity_kind`,`entity_id`);--> statement-breakpoint
CREATE INDEX `audit_project_idx` ON `audit_log` (`project_id`);--> statement-breakpoint
CREATE TABLE `blockers` (
	`id` text PRIMARY KEY NOT NULL,
	`title` text NOT NULL,
	`severity` text DEFAULT 'normal' NOT NULL,
	`kind` text DEFAULT 'info' NOT NULL,
	`description` text DEFAULT '' NOT NULL,
	`resolution_steps` text DEFAULT '[]' NOT NULL,
	`approval_button` text,
	`links` text DEFAULT '[]' NOT NULL,
	`state` text DEFAULT 'open' NOT NULL,
	`requirement_id` text,
	`task_id` text,
	`resolved_at` text,
	`resolved_by` text,
	`resolution_note` text,
	`project_id` text,
	`scope` text DEFAULT 'global' NOT NULL,
	`created_at` text NOT NULL,
	FOREIGN KEY (`project_id`) REFERENCES `projects`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `blocker_project_idx` ON `blockers` (`project_id`);--> statement-breakpoint
CREATE INDEX `blocker_state_idx` ON `blockers` (`state`);--> statement-breakpoint
CREATE TABLE `business_features` (
	`id` text PRIMARY KEY NOT NULL,
	`title` text NOT NULL,
	`description` text DEFAULT '' NOT NULL,
	`phase` text DEFAULT '1' NOT NULL,
	`status` text DEFAULT 'planned' NOT NULL,
	`linked_requirements` text DEFAULT '[]' NOT NULL,
	`target_date` text,
	`project_id` text,
	`scope` text DEFAULT 'global' NOT NULL,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	FOREIGN KEY (`project_id`) REFERENCES `projects`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `bf_project_idx` ON `business_features` (`project_id`);--> statement-breakpoint
CREATE INDEX `bf_phase_idx` ON `business_features` (`phase`);--> statement-breakpoint
CREATE TABLE `proactive_suggestions` (
	`id` text PRIMARY KEY NOT NULL,
	`title` text NOT NULL,
	`rationale` text DEFAULT '' NOT NULL,
	`options` text DEFAULT '[]' NOT NULL,
	`state` text DEFAULT 'pending' NOT NULL,
	`accepted_option` text,
	`custom_answer` text,
	`project_id` text,
	`scope` text DEFAULT 'global' NOT NULL,
	`created_at` text NOT NULL,
	`resolved_at` text,
	FOREIGN KEY (`project_id`) REFERENCES `projects`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `sugg_project_idx` ON `proactive_suggestions` (`project_id`);--> statement-breakpoint
CREATE INDEX `sugg_state_idx` ON `proactive_suggestions` (`state`);--> statement-breakpoint
CREATE TABLE `projects` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`slug` text NOT NULL,
	`kind` text NOT NULL,
	`repo_url` text,
	`live_url` text,
	`local_path` text,
	`status` text DEFAULT 'active' NOT NULL,
	`color` text,
	`icon` text,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `projects_slug_unique` ON `projects` (`slug`);--> statement-breakpoint
CREATE TABLE `questions` (
	`id` text PRIMARY KEY NOT NULL,
	`title` text NOT NULL,
	`priority` text DEFAULT 'normal' NOT NULL,
	`context` text DEFAULT '' NOT NULL,
	`recommendations` text DEFAULT '[]' NOT NULL,
	`custom_answer_placeholder` text,
	`state` text DEFAULT 'open' NOT NULL,
	`requirement_id` text,
	`task_id` text,
	`answer` text,
	`answered_at` text,
	`project_id` text,
	`scope` text DEFAULT 'global' NOT NULL,
	`created_at` text NOT NULL,
	FOREIGN KEY (`project_id`) REFERENCES `projects`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `question_project_idx` ON `questions` (`project_id`);--> statement-breakpoint
CREATE INDEX `question_state_idx` ON `questions` (`state`);--> statement-breakpoint
CREATE TABLE `requirements` (
	`id` text PRIMARY KEY NOT NULL,
	`title` text NOT NULL,
	`description` text DEFAULT '' NOT NULL,
	`state` text DEFAULT 'captured' NOT NULL,
	`priority` integer DEFAULT 3 NOT NULL,
	`labels` text DEFAULT '[]' NOT NULL,
	`target_project` text,
	`estimated_files` text DEFAULT '[]' NOT NULL,
	`depends_on` text DEFAULT '[]' NOT NULL,
	`linked_task_ids` text DEFAULT '[]' NOT NULL,
	`spec` text,
	`project_id` text,
	`scope` text DEFAULT 'global' NOT NULL,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	FOREIGN KEY (`project_id`) REFERENCES `projects`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `req_project_idx` ON `requirements` (`project_id`);--> statement-breakpoint
CREATE INDEX `req_state_idx` ON `requirements` (`state`);--> statement-breakpoint
CREATE TABLE `tasks` (
	`id` text PRIMARY KEY NOT NULL,
	`title` text NOT NULL,
	`session_id` text,
	`status` text DEFAULT 'queued' NOT NULL,
	`cwd` text DEFAULT '/' NOT NULL,
	`declared_files` text DEFAULT '[]' NOT NULL,
	`actual_files` text,
	`depends_on` text DEFAULT '[]' NOT NULL,
	`spawned_by` text DEFAULT 'user' NOT NULL,
	`bypass_used` integer DEFAULT false NOT NULL,
	`notes` text,
	`project_id` text,
	`scope` text DEFAULT 'global' NOT NULL,
	`created_at` text NOT NULL,
	`started_at` text,
	`completed_at` text,
	FOREIGN KEY (`project_id`) REFERENCES `projects`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `task_project_idx` ON `tasks` (`project_id`);--> statement-breakpoint
CREATE INDEX `task_status_idx` ON `tasks` (`status`);--> statement-breakpoint
CREATE TABLE `timeline_events` (
	`id` text PRIMARY KEY NOT NULL,
	`kind` text NOT NULL,
	`subject_id` text NOT NULL,
	`subject_kind` text NOT NULL,
	`payload` text DEFAULT '{}' NOT NULL,
	`project_id` text,
	`created_at` text NOT NULL,
	FOREIGN KEY (`project_id`) REFERENCES `projects`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `tl_project_idx` ON `timeline_events` (`project_id`);--> statement-breakpoint
CREATE INDEX `tl_kind_idx` ON `timeline_events` (`kind`);--> statement-breakpoint
CREATE INDEX `tl_created_idx` ON `timeline_events` (`created_at`);