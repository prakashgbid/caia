-- HARDEN-009 — capability-broker irreversible-action ledger.
--
-- Mirrors packages/capability-broker/migrations/0001_irreversible_actions.sql.
-- Reference: caia/docs/capability-broker.md, third-party-paper §C.1.
--
-- Renumbered from 0037 to 0054 by fix/steward-001-cleanup-0037-collision (2026-05-04)
-- because the original 0037 prefix collided with 0037_story_capsule.sql, and the
-- file was never registered in meta/_journal.json. Steward analyzer migration-linter
-- and migration-numbering both flagged this. Renaming + adding statement-breakpoints
-- + registering in the journal is the safe fix; CREATE TABLE / CREATE INDEX
-- IF NOT EXISTS is idempotent so re-running on existing DBs is a no-op.

CREATE TABLE IF NOT EXISTS irreversible_actions (
  id              TEXT PRIMARY KEY,
  ts              INTEGER NOT NULL,
  agent_role      TEXT NOT NULL,
  task_id         TEXT NOT NULL,
  capability_name TEXT NOT NULL,
  scope           TEXT NOT NULL,
  reason          TEXT NOT NULL,
  action_payload_json TEXT NOT NULL,
  result_json     TEXT NOT NULL,
  undo_token      TEXT
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS irreversible_actions_task_idx
  ON irreversible_actions (task_id, ts);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS irreversible_actions_capability_idx
  ON irreversible_actions (capability_name, ts);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS irreversible_actions_ts_idx
  ON irreversible_actions (ts);
