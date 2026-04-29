-- Migration 0027: VAL-003 — story validation report + status + attempt counter.
--
-- The Story Validator Agent (VAL-004) runs after BA enrichment and writes
-- a structured ValidationReport into validation_report. validation_status
-- mirrors the headline outcome so dashboard / scheduler queries stay cheap;
-- validation_attempts counts BA → Validator round-trips before escalation.
--
-- Companion taxonomy:
--   validation_status:
--     pending     — Validator has not run yet (default for new stories).
--     in_progress — Validator currently scoring (set at start, cleared on finish).
--     passed      — Validator score ≥ thresholds; story may advance.
--     failed      — Validator score < thresholds; orchestrator re-invokes BA.
--     escalated   — Max attempts exhausted; manual intervention required.
--
-- See ~/Documents/projects/reports/story-validator-architecture-2026-04-28.md
-- for the validation pipeline + verdict aggregation rules.

ALTER TABLE `stories` ADD COLUMN `validation_report` text;
--> statement-breakpoint
ALTER TABLE `stories` ADD COLUMN `validation_status` text NOT NULL DEFAULT 'pending';
--> statement-breakpoint
ALTER TABLE `stories` ADD COLUMN `validation_attempts` integer NOT NULL DEFAULT 0;
--> statement-breakpoint
ALTER TABLE `stories` ADD COLUMN `last_validated_at` integer;
--> statement-breakpoint

-- Indexes — the bucket placer's ready-pool query filters on validation_status
-- to ensure only validator-passed stories advance to bucket placement.
CREATE INDEX IF NOT EXISTS `story_validation_status_idx` ON `stories` (`validation_status`);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `story_validation_attempts_idx` ON `stories` (`validation_attempts`);
