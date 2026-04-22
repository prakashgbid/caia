-- Migration 0013: Pipeline Pulse — health-check run tracking
-- One row per `conductor pulse` invocation. Stores all 3-layer results.

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
CREATE INDEX `pulse_runs_ran_at_idx` ON `pulse_runs` (`ran_at` DESC);
--> statement-breakpoint
CREATE INDEX `pulse_runs_outcome_idx` ON `pulse_runs` (`outcome`);
