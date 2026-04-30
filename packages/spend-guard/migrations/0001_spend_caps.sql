-- @chiefaia/spend-guard — caps + records (v2 §6.2).
--
-- spend_caps: one row per (scope, resource_id). The scope can be
--   'task'        — task budget (resets daily by default).
--   'project'     — project budget (resets weekly).
--   'global-day'  — daily global budget across the orchestrator.
--   'global-week' — weekly global budget.
--
-- spend_records: append-only, one row per Anthropic API call. The `via`
-- column records which billing path the request hit:
--   'subscription' — Max-account quota.
--   'api-key'      — sticker-rate API key.
--   'ollama'       — local fallback (free).

CREATE TABLE IF NOT EXISTS spend_caps (
  scope               TEXT NOT NULL,
  resource_id         TEXT NOT NULL,
  period_sec          INTEGER NOT NULL,
  limit_usd           REAL NOT NULL,
  current_usd         REAL NOT NULL DEFAULT 0,
  last_reset_ms_epoch INTEGER NOT NULL,
  locked_until_ms_epoch INTEGER,
  PRIMARY KEY (scope, resource_id)
);

CREATE INDEX IF NOT EXISTS spend_caps_scope_idx ON spend_caps (scope);

CREATE TABLE IF NOT EXISTS spend_records (
  id            TEXT PRIMARY KEY,
  task_id       TEXT NOT NULL,
  project_id    TEXT,
  agent_role    TEXT NOT NULL,
  model         TEXT NOT NULL,
  via           TEXT NOT NULL,
  account_id    TEXT,
  input_tokens  INTEGER NOT NULL,
  output_tokens INTEGER NOT NULL,
  cost_usd      REAL NOT NULL,
  ts_ms_epoch   INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS spend_records_task_idx
  ON spend_records (task_id, ts_ms_epoch DESC);
CREATE INDEX IF NOT EXISTS spend_records_project_idx
  ON spend_records (project_id, ts_ms_epoch DESC);
CREATE INDEX IF NOT EXISTS spend_records_via_idx
  ON spend_records (via, ts_ms_epoch DESC);
CREATE INDEX IF NOT EXISTS spend_records_account_idx
  ON spend_records (account_id, ts_ms_epoch DESC);
