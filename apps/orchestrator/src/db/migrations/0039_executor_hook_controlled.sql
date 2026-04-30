-- Migration 0039: SAFETY-001 — flip executor_config.permission_mode
-- default from 'bypassPermissions' to 'hook-controlled'.
--
-- The dispatcher now wires a Unix-socket-backed `@chiefaia/capability-broker`
-- hook subprocess for every claude-p invocation when the mode is
-- `hook-controlled`. See `apps/executor/broker-integration.ts` and
-- `caia/docs/capability-broker.md` §"Hook-controlled mode".
--
-- For P0 the broker's policy mapper allows the existing capability set
-- (every tool call → allow), so this is plumbing-only — no behaviour
-- regression vs. `bypassPermissions`. Future PRs tighten the policy.
--
-- Backward compat:
--   - Existing rows with `bypassPermissions` are migrated to
--     `hook-controlled` so the singleton row picks up the new default.
--   - Operators can revert per-process with `CAIA_BROKER_DISABLED=1`.

UPDATE `executor_config`
   SET `permission_mode` = 'hook-controlled'
 WHERE `permission_mode` = 'bypassPermissions';

-- SQLite cannot ALTER COLUMN DEFAULT; the schema-side default in
-- `apps/orchestrator/src/db/schema.ts` is the source of truth for new
-- databases. Drizzle picks it up on the next regenerated migration.
