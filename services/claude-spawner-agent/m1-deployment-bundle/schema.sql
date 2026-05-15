-- Slot Manager SQLite Schema (Phase 0 + 1 + 2 + 4)
-- WAL mode for durability and concurrency.
-- Phase 1/2/4 deltas are also applied idempotently in
-- slot_manager._ensure_phase{1,2,4}_schema() so a hot rollout against an
-- existing DB is non-destructive.

PRAGMA journal_mode = WAL;
PRAGMA synchronous = NORMAL;
PRAGMA temp_store = MEMORY;

CREATE TABLE IF NOT EXISTS slots (
  slot_id TEXT PRIMARY KEY,
  bucket TEXT NOT NULL,
  index_in_bucket INTEGER NOT NULL,
  status TEXT NOT NULL,
  current_task_id TEXT,
  current_assignment_id TEXT,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  last_updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  UNIQUE (bucket, index_in_bucket),
  CHECK (status IN ('free', 'claimed', 'occupied', 'draining', 'disabled'))
);

CREATE TABLE IF NOT EXISTS assignments (
  assignment_id TEXT PRIMARY KEY,
  slot_id TEXT NOT NULL REFERENCES slots(slot_id),
  task_id TEXT NOT NULL,
  node_id TEXT NOT NULL,
  bucket TEXT NOT NULL,
  started_at TIMESTAMP NOT NULL,
  last_heartbeat_at TIMESTAMP,
  completed_at TIMESTAMP,
  exit_status INTEGER,
  error_message TEXT,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  UNIQUE (slot_id, assignment_id)
);

CREATE TABLE IF NOT EXISTS events (
  event_id TEXT PRIMARY KEY,
  event_type TEXT NOT NULL,
  slot_id TEXT,
  task_id TEXT,
  assignment_id TEXT,
  bucket TEXT,
  payload TEXT,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS spawn_log (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  slot_id TEXT NOT NULL,
  bucket TEXT NOT NULL,
  task_id TEXT,
  node_id TEXT,
  dispatch_time TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  dispatch_status TEXT NOT NULL,
  latency_ms INTEGER,
  sps_latency_ms INTEGER,
  error_message TEXT,
  CHECK (dispatch_status IN ('success','error_dispatch','error_sps','timeout','quota_exceeded'))
);

CREATE TABLE IF NOT EXISTS bucket_health (
  bucket TEXT PRIMARY KEY,
  state TEXT NOT NULL,
  failure_count INTEGER DEFAULT 0,
  last_failure_at TIMESTAMP,
  last_recovery_at TIMESTAMP,
  cool_down_until TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  CHECK (state IN ('closed', 'open', 'half-open'))
);

CREATE TABLE IF NOT EXISTS capacity_changes (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  bucket TEXT NOT NULL,
  old_capacity INTEGER NOT NULL,
  new_capacity INTEGER NOT NULL,
  actor TEXT NOT NULL DEFAULT 'unknown',
  reason TEXT,
  changed_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS hosts (
  name TEXT PRIMARY KEY,
  spawner_url TEXT NOT NULL,
  hostname TEXT,
  version TEXT,
  state TEXT NOT NULL DEFAULT 'active',
  registered_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  last_heartbeat_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  last_state_change_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  notes TEXT,
  CHECK (state IN ('active', 'drain', 'offline', 'disabled'))
);

CREATE TABLE IF NOT EXISTS spawn_budget (
  bucket TEXT PRIMARY KEY,
  max_per_minute INTEGER NOT NULL DEFAULT 4,
  tokens_remaining REAL NOT NULL DEFAULT 4.0,
  last_refill_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS spawn_budget_changes (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  bucket TEXT NOT NULL,
  old_max_per_minute INTEGER,
  new_max_per_minute INTEGER NOT NULL,
  actor TEXT NOT NULL DEFAULT 'unknown',
  reason TEXT,
  changed_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS spawn_telemetry (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  spawn_id TEXT NOT NULL UNIQUE,
  started_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  completed_at TIMESTAMP,
  duration_ms INTEGER,
  bucket TEXT,
  host TEXT,
  slot_id TEXT,
  task_id TEXT,
  spawner_url TEXT,
  exit_code INTEGER,
  outcome TEXT NOT NULL DEFAULT 'pending',
  api_key_guard_passed INTEGER NOT NULL DEFAULT 0,
  binary_sha256 TEXT,
  binary_path TEXT,
  session_id TEXT,
  model TEXT,
  error TEXT,
  CHECK (outcome IN ('pending','ok','dispatch_error','spawner_error','rejected_guard','rejected_budget','rejected_no_host','rejected_drained','timeout','parse_error','interrupted','cap_throttled'))
);

-- Phase 4: lineage between spawns (parent -> child, retry-of, etc.)
CREATE TABLE IF NOT EXISTS spawn_lineage (
  child_spawn_id  TEXT PRIMARY KEY,
  parent_spawn_id TEXT,
  parent_task_id  TEXT,
  child_task_id   TEXT,
  relation        TEXT NOT NULL,
  created_at      TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  payload         TEXT,
  CHECK (relation IN ('decomposed-into','retry-of','replay-of','continuation','autonomous-claim'))
);

-- Phase 4: per-bucket+host retry budget for autonomous-loop retries on
-- transient outcomes (spawner_error|dispatch_error|timeout).
CREATE TABLE IF NOT EXISTS spawn_retry_budget (
  bucket       TEXT NOT NULL,
  host         TEXT NOT NULL,
  max_retries  INTEGER NOT NULL DEFAULT 3,
  backoff_s_csv TEXT NOT NULL DEFAULT '1,2,4',
  updated_at   TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (bucket, host)
);

-- Phase 4: dead-letter for spawns that exhausted retry budget.
CREATE TABLE IF NOT EXISTS spawn_dead_letter (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  original_spawn_id TEXT NOT NULL,
  bucket    TEXT,
  host      TEXT,
  task_id   TEXT,
  attempts  INTEGER NOT NULL DEFAULT 1,
  last_outcome TEXT NOT NULL,
  last_error TEXT,
  payload   TEXT,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  replayed_at TIMESTAMP,
  replay_spawn_id TEXT
);

-- Phase 4: autonomy state. Per-bucket on/off + global kill-switch.
CREATE TABLE IF NOT EXISTS autonomy_state (
  scope        TEXT PRIMARY KEY,
  state        TEXT NOT NULL,
  reason       TEXT,
  last_tick_at TIMESTAMP,
  last_claim_at TIMESTAMP,
  last_changed_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  actor        TEXT,
  CHECK (state IN ('on','off','circuit-broken','cap-throttled'))
);

CREATE TABLE IF NOT EXISTS loop_changes (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  scope     TEXT NOT NULL,
  old_state TEXT,
  new_state TEXT NOT NULL,
  actor     TEXT NOT NULL DEFAULT 'unknown',
  reason    TEXT,
  changed_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS host_throttle_state (
  host          TEXT PRIMARY KEY,
  cap_event_count INTEGER NOT NULL DEFAULT 0,
  first_event_at TIMESTAMP,
  last_event_at  TIMESTAMP,
  throttled_until TIMESTAMP,
  updated_at    TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS loop_tick (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  ts TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  iterations INTEGER NOT NULL DEFAULT 1,
  claims INTEGER NOT NULL DEFAULT 0,
  skips_no_work INTEGER NOT NULL DEFAULT 0,
  skips_no_slot INTEGER NOT NULL DEFAULT 0,
  skips_budget INTEGER NOT NULL DEFAULT 0,
  skips_throttled INTEGER NOT NULL DEFAULT 0,
  duration_ms INTEGER NOT NULL DEFAULT 0
);

CREATE INDEX IF NOT EXISTS idx_assignments_slot ON assignments(slot_id);
CREATE INDEX IF NOT EXISTS idx_assignments_task ON assignments(task_id);
CREATE INDEX IF NOT EXISTS idx_assignments_bucket ON assignments(bucket);
CREATE INDEX IF NOT EXISTS idx_assignments_heartbeat ON assignments(last_heartbeat_at)
  WHERE completed_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_events_slot ON events(slot_id);
CREATE INDEX IF NOT EXISTS idx_events_bucket ON events(bucket);
CREATE INDEX IF NOT EXISTS idx_events_type ON events(event_type);
CREATE INDEX IF NOT EXISTS idx_events_created ON events(created_at);
CREATE INDEX IF NOT EXISTS idx_spawn_log_bucket ON spawn_log(bucket);
CREATE INDEX IF NOT EXISTS idx_spawn_log_task ON spawn_log(task_id);
CREATE INDEX IF NOT EXISTS idx_spawn_log_dispatch_time ON spawn_log(dispatch_time);
CREATE INDEX IF NOT EXISTS idx_capacity_changes_bucket ON capacity_changes(bucket);
CREATE INDEX IF NOT EXISTS idx_capacity_changes_at ON capacity_changes(changed_at);
CREATE INDEX IF NOT EXISTS idx_hosts_state ON hosts(state);
CREATE INDEX IF NOT EXISTS idx_spawn_budget_changes_bucket ON spawn_budget_changes(bucket);
CREATE INDEX IF NOT EXISTS idx_spawn_telemetry_started ON spawn_telemetry(started_at);
CREATE INDEX IF NOT EXISTS idx_spawn_telemetry_bucket  ON spawn_telemetry(bucket);
CREATE INDEX IF NOT EXISTS idx_spawn_telemetry_host    ON spawn_telemetry(host);
CREATE INDEX IF NOT EXISTS idx_spawn_telemetry_outcome ON spawn_telemetry(outcome);
CREATE INDEX IF NOT EXISTS idx_lineage_parent ON spawn_lineage(parent_spawn_id);
CREATE INDEX IF NOT EXISTS idx_lineage_relation ON spawn_lineage(relation);
CREATE INDEX IF NOT EXISTS idx_dead_letter_bucket ON spawn_dead_letter(bucket);
CREATE INDEX IF NOT EXISTS idx_dead_letter_host ON spawn_dead_letter(host);
CREATE INDEX IF NOT EXISTS idx_loop_tick_ts ON loop_tick(ts);
CREATE INDEX IF NOT EXISTS idx_loop_changes_at ON loop_changes(changed_at);

-- ===================================================================
-- Phase 5: real-edit mode + path allow-list + risk-tier approval gate.
-- These tables are created idempotently by _ensure_phase5_schema() so
-- a hot rollout against an existing DB picks them up automatically.
-- ===================================================================

-- Per-bucket default permission_mode that the autonomous loop passes to
-- the spawner. Override per-task via task_spec.permission_mode.
CREATE TABLE IF NOT EXISTS bucket_permissions (
  bucket           TEXT PRIMARY KEY,
  permission_mode  TEXT NOT NULL DEFAULT 'plan',
  updated_at       TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  actor            TEXT,
  reason           TEXT,
  CHECK (permission_mode IN ('plan','acceptEdits','bypassPermissions'))
);

-- Per-bucket allow-list of filesystem paths the spawner may attach as
-- --add-dir flags. Paths must be under ALLOWED_ROOT
-- (~/Documents/projects by default). Spawner re-validates server-side
-- as a defence in depth.
CREATE TABLE IF NOT EXISTS bucket_path_allowlists (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  bucket      TEXT NOT NULL,
  path        TEXT NOT NULL,
  active      INTEGER NOT NULL DEFAULT 1,
  created_at  TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  actor       TEXT,
  reason      TEXT,
  UNIQUE (bucket, path)
);

-- High-risk task approval ledger. Each row authorises a single
-- task_id for a single 1h window. The autonomous loop refuses to
-- dispatch high-risk task specs without an unexpired, unused approval.
CREATE TABLE IF NOT EXISTS task_approvals (
  task_id     TEXT PRIMARY KEY,
  approved_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  expires_at  TIMESTAMP NOT NULL,
  actor       TEXT NOT NULL DEFAULT 'unknown',
  reason      TEXT,
  used_at     TIMESTAMP,
  used_spawn_id TEXT
);

-- Risk-tier audit log: every dispatch records its (task_id, risk_tier,
-- classifier_source, approval_id_used) so post-hoc review can answer
-- "did anything high-risk slip through unapproved".
CREATE TABLE IF NOT EXISTS dispatch_risk_log (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  spawn_id        TEXT NOT NULL,
  task_id         TEXT,
  bucket          TEXT,
  risk_tier       TEXT NOT NULL,
  permission_mode TEXT NOT NULL,
  classifier      TEXT NOT NULL,
  approval_used   TEXT,
  allow_list_json TEXT,
  created_at      TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CHECK (risk_tier IN ('low','medium','high'))
);

CREATE INDEX IF NOT EXISTS idx_bucket_path_allowlists_bucket ON bucket_path_allowlists(bucket);
CREATE INDEX IF NOT EXISTS idx_task_approvals_expires_at ON task_approvals(expires_at);
CREATE INDEX IF NOT EXISTS idx_dispatch_risk_log_spawn ON dispatch_risk_log(spawn_id);
CREATE INDEX IF NOT EXISTS idx_dispatch_risk_log_task ON dispatch_risk_log(task_id);
CREATE INDEX IF NOT EXISTS idx_dispatch_risk_log_tier ON dispatch_risk_log(risk_tier);
