-- Migration 0025: declarative inputDependencies column on stories.
--
-- Today the only dependency mechanism is `taxonomy.blocked_by` (a hard
-- ordering on story IDs). That conflates two distinct concepts:
--
--   1. "this story is blocked until story X completes" — a hard, ID-keyed
--      relationship between two existing stories.
--   2. "this story needs an input that doesn't exist yet" — e.g. a login
--      flow, a DB schema, an API key, a feature flag. Often surfaces
--      BEFORE the producing story exists, and BA/PO need to record it
--      anyway so the Task Manager can route the story when the input
--      becomes available.
--
-- This migration adds an input-requirement column that captures (2) as
-- structured metadata, separate from blocker relationships. It feeds the
-- resource-claim / scheduler routing planned in BUCKET-009 — the scheduler
-- will not start a story until every declared input has a `satisfied_by`
-- pointer, and will surface input gaps as `story.input_missing` events.
--
-- Schema:
--   input_dependencies_json → object[]  (each entry shape below)
--
-- Each entry:
--   { kind: 'capability'|'data'|'env'|'flag'|'route'|'schema'|'secret',
--     name: string,                       // human-readable, e.g. "login flow"
--     description?: string,                // optional clarifier
--     required: boolean,                  // hard requirement (default true)
--     satisfied_by?: string,              // story ID once known (set by EA / BA)
--     declared_by: 'po'|'ba'|'ea'|'human' // who put it on the ticket
--     declared_at: number                  // unix ms
--   }
--
-- All entries are optional on this migration so existing stories continue
-- to validate; PO/BA agents start populating it on new stories immediately.

ALTER TABLE `stories` ADD COLUMN `input_dependencies_json` text NOT NULL DEFAULT '[]';
--> statement-breakpoint

-- Index — bundle endpoint reads input_dependencies on every story load,
-- and BUCKET-009's scheduler scans for `satisfied_by IS NULL` entries to
-- gate routing. Keeping this index lean (status + parent) so the scan stays
-- bounded.
CREATE INDEX IF NOT EXISTS `story_input_deps_idx`
  ON `stories` (`status`, `parent_entity_id`);
