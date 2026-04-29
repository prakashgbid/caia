-- Migration 0030: ACR-001 — story_scope column on stories.
--
-- The Agent Section Contract Registry (ACR-001 → ACR-011) lets each
-- ticket-writing agent (PO, BA, EA, Test-Design) declare a contract
-- listing the sections it will populate, with per-scope rubrics. The
-- Validator composes contracts at runtime per story scope.
--
-- This column captures the scope a story sits at in the SAFe / Jira
-- hierarchy:
--   initiative → epic → module → story → task → subtask
--
-- The composed validation template per scope is the union of all contracts
-- whose `appliesTo` includes that scope; legacy stories without an explicit
-- scope default to 'story' (the canonical sprintable unit) — see ACR-008.
--
-- Index supports the dashboard /contracts page (groups stories by scope)
-- and the Validator's per-scope rubric cache lookup.
--
-- See ~/Documents/projects/reports/agent-contract-registry-architecture-2026-04-28.md
-- for the full design rationale + composition algorithm.

ALTER TABLE `stories` ADD COLUMN `story_scope` text NOT NULL DEFAULT 'story';
--> statement-breakpoint

CREATE INDEX IF NOT EXISTS `story_story_scope_idx` ON `stories` (`story_scope`);
