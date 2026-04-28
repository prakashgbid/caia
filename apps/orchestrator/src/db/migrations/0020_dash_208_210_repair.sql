-- Migration 0015 — DASH-208/209/210 schema repair
--
-- Three dashboard endpoints (`/behavior-tests*`, `/builds`, `/pulse/*`) were
-- returning HTTP 500. Root cause is a divergent state between the drizzle
-- schema and dev/prod databases:
--
--   1. `pulse_runs` was created by an older code path (in pipeline-pulse)
--      with the legacy schema `(run_id PK, raw_json blob, ...)` instead of
--      the canonical drizzle schema `(id PK, canary_id, canary_elapsed_ms,
--      checks_json, invariants_json, heals_json, ...)`. Every
--      `db.select().from(pulseRuns)` query then hit a "no such column: id"
--      error. We DROP and recreate to match drizzle exactly. The few rows
--      that may live there are short-lived health-check ticks; data loss
--      is acceptable.
--
--   2. `behavior_tests`, `behavior_test_runs`, `behavior_test_failures`
--      were marked applied in `__drizzle_migrations` (idx 5) but the
--      tables were dropped from some dev/staging databases. We CREATE
--      TABLE IF NOT EXISTS so this migration is a no-op on databases
--      where the tables already exist (matching schema).
--
--   3. `build_runs`, `build_steps`, `build_retries` — same situation as
--      (2), via migration 0009. Same fix.
--
-- This migration is idempotent: safe to run on a fresh CI database (where
-- migrations 0005, 0009, 0013 already created the tables — the IF NOT
-- EXISTS clauses make this a no-op for them, and the pulse_runs DROP/
-- recreate is a roundtrip with no logical effect).

DROP TABLE IF EXISTS `pulse_runs`;
--> statement-breakpoint
CREATE TABLE `pulse_runs` (
  `id` text PRIMARY KEY NOT NULL,
  `ran_at` text NOT NULL,
  `outcome` text NOT NULL,
  `canary_id` text,
  `canary_elapsed_ms` integer,
  `checks_json` text NOT NULL DEFAULT '[]',
  `invariants_json` text NOT NULL DEFAULT '[]',
  `heals_json` text NOT NULL DEFAULT '[]',
  `duration_ms` integer NOT NULL DEFAULT 0
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `pulse_runs_ran_at_idx` ON `pulse_runs` (`ran_at` DESC);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `pulse_runs_outcome_idx` ON `pulse_runs` (`outcome`);
--> statement-breakpoint

CREATE TABLE IF NOT EXISTS `behavior_tests` (
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
CREATE UNIQUE INDEX IF NOT EXISTS `bt_name_feature_idx` ON `behavior_tests` (`name`, `feature`);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `bt_project_idx` ON `behavior_tests` (`project_slug`);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `bt_feature_idx` ON `behavior_tests` (`feature`);
--> statement-breakpoint

CREATE TABLE IF NOT EXISTS `behavior_test_runs` (
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
CREATE INDEX IF NOT EXISTS `btr_test_idx` ON `behavior_test_runs` (`test_id`);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `btr_run_at_idx` ON `behavior_test_runs` (`run_at`);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `btr_status_idx` ON `behavior_test_runs` (`status`);
--> statement-breakpoint

CREATE TABLE IF NOT EXISTS `behavior_test_failures` (
  `id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
  `test_run_id` integer NOT NULL,
  `conductor_blocker_id` text,
  `kind` text NOT NULL DEFAULT 'regression',
  `message` text NOT NULL DEFAULT '',
  `stack_excerpt` text,
  FOREIGN KEY (`test_run_id`) REFERENCES `behavior_test_runs`(`id`) ON DELETE CASCADE
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `btf_run_idx` ON `behavior_test_failures` (`test_run_id`);
--> statement-breakpoint

CREATE TABLE IF NOT EXISTS `build_runs` (
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
CREATE INDEX IF NOT EXISTS `br_status_idx` ON `build_runs` (`status`);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `br_started_idx` ON `build_runs` (`started_at` DESC);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `br_git_sha_idx` ON `build_runs` (`git_sha`);
--> statement-breakpoint

CREATE TABLE IF NOT EXISTS `build_steps` (
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
CREATE INDEX IF NOT EXISTS `bs_run_idx` ON `build_steps` (`build_run_id`);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `bs_status_idx` ON `build_steps` (`status`);
--> statement-breakpoint

CREATE TABLE IF NOT EXISTS `build_retries` (
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
CREATE INDEX IF NOT EXISTS `bret_run_idx` ON `build_retries` (`build_run_id`);
