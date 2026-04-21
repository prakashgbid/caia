-- Migration 0006: Completeness sentinel tables

CREATE TABLE `stories` (
  `id` text PRIMARY KEY NOT NULL,
  `parent_id` text,
  `prev_sibling_id` text,
  `next_sibling_id` text,
  `ordinal` integer NOT NULL DEFAULT 0,
  `kind` text NOT NULL DEFAULT 'task',
  `title` text NOT NULL,
  `description` text NOT NULL DEFAULT '',
  `expected_behavior` text NOT NULL DEFAULT '',
  `acceptance_criteria_json` text NOT NULL DEFAULT '[]',
  `verification_plan_json` text NOT NULL DEFAULT '[]',
  `behavior_test_path` text,
  `depends_on_json` text NOT NULL DEFAULT '[]',
  `project_slug` text,
  `domain_slugs_json` text NOT NULL DEFAULT '[]',
  `status` text NOT NULL DEFAULT 'pending',
  `created_at` text NOT NULL,
  `last_decomposed_at` text,
  `behavior_test_skeleton` text
);
--> statement-breakpoint
CREATE INDEX `story_parent_idx` ON `stories` (`parent_id`);
--> statement-breakpoint
CREATE INDEX `story_project_idx` ON `stories` (`project_slug`);
--> statement-breakpoint
CREATE INDEX `story_kind_idx` ON `stories` (`kind`);

--> statement-breakpoint
CREATE TABLE `story_revisions` (
  `id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
  `story_id` text NOT NULL,
  `version` integer NOT NULL DEFAULT 1,
  `snapshot_json` text NOT NULL DEFAULT '{}',
  `changed_at` text NOT NULL,
  `changed_by` text NOT NULL DEFAULT 'system'
);
--> statement-breakpoint
CREATE INDEX `sr_story_idx` ON `story_revisions` (`story_id`, `version`);

--> statement-breakpoint
CREATE TABLE `lock_contracts` (
  `id` text PRIMARY KEY NOT NULL,
  `slug` text NOT NULL UNIQUE,
  `kind` text NOT NULL DEFAULT 'standard',
  `title` text NOT NULL,
  `body_md` text NOT NULL DEFAULT '',
  `version` integer NOT NULL DEFAULT 1,
  `active` integer NOT NULL DEFAULT 1,
  `created_at` text NOT NULL,
  `updated_at` text NOT NULL,
  `checksum` text NOT NULL DEFAULT ''
);
--> statement-breakpoint
CREATE INDEX `lc_slug_idx` ON `lock_contracts` (`slug`);
--> statement-breakpoint
CREATE INDEX `lc_kind_idx` ON `lock_contracts` (`kind`);

--> statement-breakpoint
CREATE TABLE `lock_contract_revisions` (
  `id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
  `contract_id` text NOT NULL,
  `version` integer NOT NULL,
  `body_md` text NOT NULL DEFAULT '',
  `changed_at` text NOT NULL,
  `changed_by` text NOT NULL DEFAULT 'system'
);
--> statement-breakpoint
CREATE INDEX `lcr_contract_idx` ON `lock_contract_revisions` (`contract_id`, `version`);

--> statement-breakpoint
CREATE TABLE `memory_anchors` (
  `path` text PRIMARY KEY NOT NULL,
  `kind` text NOT NULL DEFAULT 'lock_contract',
  `ref_id` text NOT NULL,
  `ref_table` text NOT NULL,
  `last_synced_at` text NOT NULL,
  `checksum_at_sync` text NOT NULL DEFAULT ''
);
--> statement-breakpoint
CREATE INDEX `ma_ref_idx` ON `memory_anchors` (`ref_table`, `ref_id`);

--> statement-breakpoint
CREATE TABLE `db_backups` (
  `id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
  `taken_at` text NOT NULL,
  `path` text NOT NULL,
  `size_bytes` integer NOT NULL DEFAULT 0,
  `row_counts_json` text NOT NULL DEFAULT '{}',
  `checksum` text NOT NULL DEFAULT ''
);
--> statement-breakpoint
CREATE INDEX `dbb_taken_idx` ON `db_backups` (`taken_at`);

--> statement-breakpoint
CREATE TABLE `completeness_runs` (
  `id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
  `run_at` text NOT NULL,
  `entity_kind` text NOT NULL,
  `entity_id` text NOT NULL,
  `checks_total` integer NOT NULL DEFAULT 0,
  `checks_passed` integer NOT NULL DEFAULT 0,
  `score_pct` integer NOT NULL DEFAULT 0,
  `status` text NOT NULL DEFAULT 'pending',
  `findings_json` text NOT NULL DEFAULT '[]',
  `duration_ms` integer
);
--> statement-breakpoint
CREATE INDEX `cr_entity_idx` ON `completeness_runs` (`entity_kind`, `entity_id`);
--> statement-breakpoint
CREATE INDEX `cr_run_at_idx` ON `completeness_runs` (`run_at`);
--> statement-breakpoint
CREATE INDEX `cr_status_idx` ON `completeness_runs` (`status`);

--> statement-breakpoint
CREATE TABLE `completeness_findings` (
  `id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
  `run_id` integer NOT NULL REFERENCES `completeness_runs`(`id`),
  `entity_kind` text NOT NULL,
  `entity_id` text NOT NULL,
  `check_kind` text NOT NULL,
  `expected` text NOT NULL DEFAULT '',
  `actual` text NOT NULL DEFAULT '',
  `severity` text NOT NULL DEFAULT 'warning',
  `message` text NOT NULL DEFAULT '',
  `evidence_url` text
);
--> statement-breakpoint
CREATE INDEX `cf_run_idx` ON `completeness_findings` (`run_id`);
--> statement-breakpoint
CREATE INDEX `cf_entity_idx` ON `completeness_findings` (`entity_kind`, `entity_id`);

--> statement-breakpoint
CREATE TABLE `completeness_schedule` (
  `id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
  `schedule_cron` text NOT NULL DEFAULT '0 */2 * * *',
  `enabled` integer NOT NULL DEFAULT 1,
  `last_run_at` text,
  `next_run_at` text
);
