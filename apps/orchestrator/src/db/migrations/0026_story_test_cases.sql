-- Migration 0026: TEST-001 — story.test_cases JSONB column for the testing
-- framework Phase A.
--
-- The Testing Agent populates this column after BA enrichment completes.
-- Each row is the JSON-stringified `testCases` array from the v1 ticket
-- template (see @chiefaia/ticket-template). We mirror the data on stories
-- in addition to the ticket payload so dashboard queries stay cheap.
--
-- Companion: `test_designed_at` (epoch ms) and `test_design_status` track
-- the Testing Agent's lifecycle on this story:
--   pending  → Testing Agent has not yet run.
--   designed → Testing Agent populated testCases successfully.
--   skipped  → No tests applicable (e.g. lifecycle='docs').
--   error    → Testing Agent failed; see template_validation_errors.

ALTER TABLE `stories` ADD COLUMN `test_cases_json` text NOT NULL DEFAULT '[]';
--> statement-breakpoint
ALTER TABLE `stories` ADD COLUMN `test_designed_at` integer;
--> statement-breakpoint
ALTER TABLE `stories` ADD COLUMN `test_design_status` text NOT NULL DEFAULT 'pending';
--> statement-breakpoint

CREATE INDEX IF NOT EXISTS `story_test_design_status_idx` ON `stories` (`test_design_status`);
