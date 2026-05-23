-- @caia/secrets-postgres — audit log (also written by @caia/secrets-infisical).
--
-- Every adapter `get` writes exactly one row here, success or failure.
-- Every adapter `put` writes one row too.
-- The Infisical adapter dual-writes here so the operator can query
-- a unified audit log across both stores.

CREATE SCHEMA IF NOT EXISTS caia_meta;

CREATE TABLE IF NOT EXISTS caia_meta.audit_log (
  id                  BIGSERIAL PRIMARY KEY,
  tenant_id           TEXT NOT NULL,
  category            TEXT NOT NULL,
  key                 TEXT NOT NULL,
  backend             TEXT NOT NULL,
  action              TEXT NOT NULL,
  caller_type         TEXT NOT NULL,
  caller_id           TEXT NOT NULL,
  ticket_id           TEXT,
  reason              TEXT NOT NULL,
  capability_token_id TEXT,
  requester_ip        TEXT,
  granted_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  ok                  BOOLEAN NOT NULL,
  error_class         TEXT,
  provider_trace      TEXT
);

CREATE INDEX IF NOT EXISTS audit_log_tenant_time_idx
  ON caia_meta.audit_log (tenant_id, granted_at DESC);

CREATE INDEX IF NOT EXISTS audit_log_action_time_idx
  ON caia_meta.audit_log (action, granted_at DESC);

CREATE INDEX IF NOT EXISTS audit_log_ok_time_idx
  ON caia_meta.audit_log (ok, granted_at DESC);
