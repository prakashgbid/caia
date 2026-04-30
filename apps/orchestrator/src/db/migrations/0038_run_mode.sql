-- Migration 0038: RUN-MODES — plan-only and test-only run modes.
--
-- Adds a `run_mode` column to `prompts`. Every prompt is a CAIA run; the
-- run mode controls how far down the pipeline the run goes:
--
--   'full'       — default. PO + BA + EA + Validator + Test-Design +
--                  Task Manager + worker-assignment (Coding Agent +
--                  Fix-It if needed). The mode the dashboard's "Run
--                  full" button has always meant.
--
--   'plan-only'  — pipeline runs PO + BA + EA + Validator + Test-Design
--                  + Task Manager (bucket placement). Stories reach
--                  `bucket_placed` / `ready_for_pickup` and stay there.
--                  ReadyPoolConsumer skips worker assignment for these
--                  prompts. Useful for "show me the plan + cost before
--                  I commit". The dashboard exposes this as
--                  "Run plan only — show me the cost".
--
--   'test-only'  — pipeline runs full, but the per-run capability
--                  allowlist is restricted: deploy/publish/push-main
--                  capabilities are stripped before the capsule is
--                  frozen (D1, migration 0037). Code is written and
--                  tested; nothing is deployed or published. Once
--                  Track 1's capability broker is online, the broker
--                  enforces the restricted allowlist; until then this
--                  is plumbed through but not strictly enforced (the
--                  Coding Agent honours the capsule's allowlist on
--                  best-effort).
--
-- Default 'full' preserves all existing behaviour for in-flight prompts.
-- Migration is non-idempotent (ALTER TABLE ADD COLUMN); Drizzle's
-- journal prevents re-application.
--
-- The column is denormalised onto stories in the same migration so
-- ReadyPoolConsumer can gate worker assignment without joining
-- prompts on every pump.

ALTER TABLE `prompts` ADD COLUMN `run_mode` text NOT NULL DEFAULT 'full';
--> statement-breakpoint
ALTER TABLE `stories` ADD COLUMN `run_mode` text NOT NULL DEFAULT 'full';
--> statement-breakpoint
CREATE INDEX `prm_run_mode_idx` ON `prompts` (`run_mode`);
--> statement-breakpoint
CREATE INDEX `story_run_mode_idx` ON `stories` (`run_mode`);
