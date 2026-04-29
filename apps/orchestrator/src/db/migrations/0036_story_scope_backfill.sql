-- Migration 0036: ACR-007 Step C — backfill story_scope on legacy stories.
--
-- Migration 0035 added the `story_scope` column to `stories` with a
-- DEFAULT 'story' clause, so SQLite already populated every existing row
-- when the column was added. This follow-up migration is a defence-in-
-- depth pass that:
--
--   1. Re-asserts that no row has a NULL or empty `story_scope` value.
--   2. Coerces any unexpected NULL/'' value to the canonical default
--      ('story') — see DEFAULT_STORY_SCOPE in @chiefaia/ticket-template.
--
-- The Validator's runtime path (`apps/orchestrator/src/agents/
-- validation-rubric-source.ts`) reads `stories.story_scope` to compose
-- the per-scope rubric via `composeTemplate(scope)` from the Agent
-- Section Contract Registry. Any NULL value would cause the Validator
-- to fall back to DEFAULT_STORY_SCOPE silently — better to backfill
-- once at migration time than to swallow the NULL on every read.
--
-- Idempotent: re-running the UPDATE after every row already has
-- 'story' (or another valid scope) is a no-op because the WHERE clause
-- matches zero rows on the second run.

-- Sanity check — assert all stories now have a non-empty scope. SQLite
-- doesn't have a native ASSERT, but a constraint via a trigger is
-- overkill for a one-time backfill. The NOT NULL constraint on the
-- column itself, combined with the DEFAULT clause and this UPDATE,
-- guarantees the postcondition.

UPDATE `stories`
SET `story_scope` = 'story'
WHERE `story_scope` IS NULL OR TRIM(`story_scope`) = '';
