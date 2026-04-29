-- Migration 0032: TASKMGR-001 — Phase 2 worker-pool columns on stories.
--
-- Phase 2 introduces three new agents that pick up validated + test-designed
-- tickets from the ready-pool (per BUCKET-009): Task Manager assigns tickets
-- to free Coding Agent workers; Coding Agent claims a worktree, implements
-- the story per EA's architecturalInstructions and Test-Design's testCases,
-- opens a PR; Fix-It Test Agent runs the test cases and loops with the
-- Coding Agent in-session to fix failures until all green.
--
-- These columns track the runtime state of every story once it leaves
-- `ready_for_pickup` and enters the worker pool. They are nullable so they
-- only populate for stories that actually reach Phase 2 (legacy / pre-Phase-2
-- rows stay clean).
--
-- Companion taxonomy:
--   phase2_status:
--     null                  — story has not entered Phase 2 (still pre-pickup
--                             or legacy); kept null for stories that never reach
--                             worker pool (e.g., escalated upstream).
--     coding_in_progress    — Coding Agent has claimed; PR not yet open.
--     coding_complete       — Coding Agent has opened PR; local unit/integration green.
--     testing_in_progress   — Fix-It Test Agent running the testCases.
--     testing_fixing        — mid-fix-loop (one or more retries in flight).
--     tests_passing         — every testCase green; ready for PR merge.
--     done                  — PR merged; ticket closed.
--     escalated             — fix-stuck or coding-stuck blocker filed.
--
--   pr_state mirrors GitHub PR lifecycle so the dashboard can surface it
--   without a network round-trip every render.

ALTER TABLE `stories` ADD COLUMN `assigned_worker_id` text;
--> statement-breakpoint
ALTER TABLE `stories` ADD COLUMN `coding_session_id` text;
--> statement-breakpoint
ALTER TABLE `stories` ADD COLUMN `worktree_path` text;
--> statement-breakpoint
ALTER TABLE `stories` ADD COLUMN `feature_branch` text;
--> statement-breakpoint
ALTER TABLE `stories` ADD COLUMN `pr_number` integer;
--> statement-breakpoint
ALTER TABLE `stories` ADD COLUMN `pr_url` text;
--> statement-breakpoint
ALTER TABLE `stories` ADD COLUMN `pr_state` text;
--> statement-breakpoint
ALTER TABLE `stories` ADD COLUMN `last_commit_sha` text;
--> statement-breakpoint
ALTER TABLE `stories` ADD COLUMN `coding_attempts` integer NOT NULL DEFAULT 0;
--> statement-breakpoint
ALTER TABLE `stories` ADD COLUMN `fix_attempts` integer NOT NULL DEFAULT 0;
--> statement-breakpoint
ALTER TABLE `stories` ADD COLUMN `phase2_status` text;
--> statement-breakpoint
ALTER TABLE `stories` ADD COLUMN `phase2_blocker_id` text;
--> statement-breakpoint

CREATE INDEX IF NOT EXISTS `story_assigned_worker_idx` ON `stories` (`assigned_worker_id`);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `story_phase2_status_idx` ON `stories` (`phase2_status`);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `story_pr_state_idx` ON `stories` (`pr_state`);
