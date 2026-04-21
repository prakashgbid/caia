CREATE TABLE `behavior_tests` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`feature` text NOT NULL,
	`scope` text NOT NULL,
	`project_slug` text,
	`domain_slugs` text NOT NULL DEFAULT '[]',
	`source_path` text,
	`first_seen_at` text NOT NULL,
	`last_seen_at` text NOT NULL,
	`expected_behavior` text NOT NULL DEFAULT '',
	`layout_contract` text,
	`notes` text
);
--> statement-breakpoint
CREATE UNIQUE INDEX `bt_name_feature_idx` ON `behavior_tests` (`name`, `feature`);
--> statement-breakpoint
CREATE INDEX `bt_project_idx` ON `behavior_tests` (`project_slug`);
--> statement-breakpoint
CREATE INDEX `bt_feature_idx` ON `behavior_tests` (`feature`);
--> statement-breakpoint
CREATE TABLE `behavior_test_runs` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`test_id` text NOT NULL,
	`run_at` text NOT NULL,
	`duration_ms` integer,
	`status` text NOT NULL DEFAULT 'skip',
	`evidence_url` text,
	`failure_excerpt` text,
	`git_sha` text,
	`ci` integer NOT NULL DEFAULT 0,
	FOREIGN KEY (`test_id`) REFERENCES `behavior_tests`(`id`) ON DELETE CASCADE
);
--> statement-breakpoint
CREATE INDEX `btr_test_idx` ON `behavior_test_runs` (`test_id`);
--> statement-breakpoint
CREATE INDEX `btr_run_at_idx` ON `behavior_test_runs` (`run_at`);
--> statement-breakpoint
CREATE INDEX `btr_status_idx` ON `behavior_test_runs` (`status`);
--> statement-breakpoint
CREATE TABLE `behavior_test_failures` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`test_run_id` integer NOT NULL,
	`conductor_blocker_id` text,
	`kind` text NOT NULL DEFAULT 'regression',
	`message` text NOT NULL DEFAULT '',
	`stack_excerpt` text,
	FOREIGN KEY (`test_run_id`) REFERENCES `behavior_test_runs`(`id`) ON DELETE CASCADE
);
--> statement-breakpoint
CREATE INDEX `btf_run_idx` ON `behavior_test_failures` (`test_run_id`);
