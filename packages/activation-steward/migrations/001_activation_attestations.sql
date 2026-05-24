-- @caia/activation-steward — Postgres attestation history.
--
-- Per-(run × package × tenant × callpath) row. Lets operators query
-- "show me every cold-path for tenant T in the last 7 days" via SQL,
-- and powers the dashboard's per-(package, tenant) trend view.
--
-- Idempotent: every CREATE uses IF NOT EXISTS; indices likewise.
-- Safe to apply repeatedly.

CREATE SCHEMA IF NOT EXISTS caia_meta;

CREATE TABLE IF NOT EXISTS caia_meta.activation_attestations (
  id               BIGSERIAL    PRIMARY KEY,
  run_id           TEXT         NOT NULL,
  package_name     TEXT         NOT NULL,
  tenant_id        TEXT         NOT NULL,
  callpath         TEXT         NOT NULL,
  service_name     TEXT         NOT NULL,
  span_name        TEXT         NOT NULL,
  status           TEXT         NOT NULL,
  hit              BOOLEAN      NOT NULL DEFAULT false,
  span_count       INTEGER      NOT NULL DEFAULT 0,
  trace_count      INTEGER      NOT NULL DEFAULT 0,
  most_recent_at   TIMESTAMPTZ,
  observed_at      TIMESTAMPTZ  NOT NULL,
  window_hours     INTEGER      NOT NULL,
  site             TEXT         NOT NULL DEFAULT 'caia-mac',
  telemetry        TEXT         NOT NULL DEFAULT 'present',
  created_at       TIMESTAMPTZ  NOT NULL DEFAULT now(),
  -- Composite uniqueness: one row per (run, pkg, tenant, callpath).
  CONSTRAINT activation_attestations_unique
    UNIQUE (run_id, package_name, tenant_id, callpath)
);

-- Status check — keep aligned with src/types.ts AttestationStatus.
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM pg_constraint
     WHERE conname = 'activation_attestations_status_check'
       AND conrelid = 'caia_meta.activation_attestations'::regclass
  ) THEN
    ALTER TABLE caia_meta.activation_attestations
      DROP CONSTRAINT activation_attestations_status_check;
  END IF;
END$$;

ALTER TABLE caia_meta.activation_attestations
  ADD CONSTRAINT activation_attestations_status_check
  CHECK (status IN ('green', 'yellow', 'red', 'no-telemetry', 'unknown'));

DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM pg_constraint
     WHERE conname = 'activation_attestations_telemetry_check'
       AND conrelid = 'caia_meta.activation_attestations'::regclass
  ) THEN
    ALTER TABLE caia_meta.activation_attestations
      DROP CONSTRAINT activation_attestations_telemetry_check;
  END IF;
END$$;

ALTER TABLE caia_meta.activation_attestations
  ADD CONSTRAINT activation_attestations_telemetry_check
  CHECK (telemetry IN ('absent', 'degraded', 'present'));

-- Lookup indices.
CREATE INDEX IF NOT EXISTS activation_attestations_pkg_tenant_idx
  ON caia_meta.activation_attestations (package_name, tenant_id, observed_at DESC);

CREATE INDEX IF NOT EXISTS activation_attestations_run_idx
  ON caia_meta.activation_attestations (run_id);

CREATE INDEX IF NOT EXISTS activation_attestations_status_idx
  ON caia_meta.activation_attestations (status)
  WHERE status IN ('red', 'no-telemetry');

CREATE INDEX IF NOT EXISTS activation_attestations_observed_at_idx
  ON caia_meta.activation_attestations (observed_at DESC);

-- ─── Runs roll-up (one row per run; mirrors JSONL summary). ────────────────

CREATE TABLE IF NOT EXISTS caia_meta.activation_steward_runs (
  run_id           TEXT         PRIMARY KEY,
  site             TEXT         NOT NULL,
  telemetry        TEXT         NOT NULL,
  window_hours     INTEGER      NOT NULL,
  started_at       TIMESTAMPTZ  NOT NULL,
  finished_at      TIMESTAMPTZ  NOT NULL,
  green_count      INTEGER      NOT NULL DEFAULT 0,
  yellow_count     INTEGER      NOT NULL DEFAULT 0,
  red_count        INTEGER      NOT NULL DEFAULT 0,
  no_telemetry_count INTEGER    NOT NULL DEFAULT 0,
  unknown_count    INTEGER      NOT NULL DEFAULT 0,
  created_at       TIMESTAMPTZ  NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS activation_steward_runs_finished_at_idx
  ON caia_meta.activation_steward_runs (finished_at DESC);

-- Convenience view: latest attestation per (package, tenant).
CREATE OR REPLACE VIEW caia_meta.activation_attestations_latest AS
SELECT DISTINCT ON (package_name, tenant_id)
  package_name,
  tenant_id,
  callpath,
  status,
  hit,
  span_count,
  observed_at,
  run_id
FROM caia_meta.activation_attestations
ORDER BY package_name, tenant_id, observed_at DESC;
