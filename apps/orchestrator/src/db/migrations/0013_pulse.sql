-- Migration 0013: Pipeline Pulse — health-check run tracking
-- One row per `conductor pulse` invocation. Stores all 3-layer results.
--
-- NOTE (DASH-208/209/210): made idempotent so that downstream migration 0015
-- can repair databases where `pulse_runs` was created with a divergent schema
-- by older code paths. With CREATE TABLE IF NOT EXISTS this migration is a
-- no-op on those DBs; 0015 then drops and rebuilds the table to the canonical
-- shape. On a fresh DB this still creates the table on first run.

CREATE TABLE IF NOT EXISTS `pulse_runs` (
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
