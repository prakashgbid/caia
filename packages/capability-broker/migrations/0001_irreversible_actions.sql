-- @chiefaia/capability-broker — irreversible-action ledger.
--
-- Append-only. Every privileged execution (capability redemption) records
-- here regardless of success/failure. Operators query this from the
-- dashboard "Capability ledger" page.
--
-- The orchestrator's drizzle schema mirrors this DDL in apps/orchestrator/
-- src/db/schema.ts (irreversibleActions table) so reads can join against
-- tasks / runs.

CREATE TABLE IF NOT EXISTS irreversible_actions (
  id              TEXT PRIMARY KEY,
  ts              INTEGER NOT NULL,
  agent_role      TEXT NOT NULL,
  task_id         TEXT NOT NULL,
  capability_name TEXT NOT NULL,
  scope           TEXT NOT NULL,
  reason          TEXT NOT NULL,
  -- JSON-serialised payload + result. Kept as TEXT (SQLite) so the
  -- migration is portable to LibSQL / Turso without changes.
  action_payload_json TEXT NOT NULL,
  result_json     TEXT NOT NULL,
  -- Optional pointer to a compensating action (rollback url, revert sha,
  -- snapshot id, …). Null when the action is its own undo or has none.
  undo_token      TEXT
);

CREATE INDEX IF NOT EXISTS irreversible_actions_task_idx
  ON irreversible_actions (task_id, ts DESC);

CREATE INDEX IF NOT EXISTS irreversible_actions_capability_idx
  ON irreversible_actions (capability_name, ts DESC);

CREATE INDEX IF NOT EXISTS irreversible_actions_ts_idx
  ON irreversible_actions (ts DESC);
