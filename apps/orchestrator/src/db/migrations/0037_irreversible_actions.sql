-- HARDEN-009 — capability-broker irreversible-action ledger.
--
-- Mirrors packages/capability-broker/migrations/0001_irreversible_actions.sql.
-- Reference: caia/docs/capability-broker.md, third-party-paper §C.1.

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

CREATE INDEX IF NOT EXISTS irreversible_actions_task_idx
  ON irreversible_actions (task_id, ts);
CREATE INDEX IF NOT EXISTS irreversible_actions_capability_idx
  ON irreversible_actions (capability_name, ts);
CREATE INDEX IF NOT EXISTS irreversible_actions_ts_idx
  ON irreversible_actions (ts);
