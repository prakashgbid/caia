-- @caia/outcome-steward — Postgres attestation history.
--
-- Per-(run × package × solutionId × sliMetric) row. Lets operators
-- query "show me every red SLI for solution S in the last N hours"
-- via SQL, and powers the dashboard's per-(solution, sli) trend view.
--
-- Idempotent: every CREATE uses IF NOT EXISTS; indices likewise.
-- Safe to apply repeatedly.

CREATE SCHEMA IF NOT EXISTS caia_meta;

CREATE TABLE IF NOT EXISTS caia_meta.outcome_attestations (
  id                  BIGSERIAL    PRIMARY KEY,
  run_id              TEXT         NOT NULL,
  package_name        TEXT         NOT NULL,
  solution_id         TEXT         NOT NULL,
  sli_metric          TEXT         NOT NULL,
  status              TEXT         NOT NULL,
  latest_value        DOUBLE PRECISION,
  threshold           DOUBLE PRECISION NOT NULL,
  direction           TEXT         NOT NULL,
  trend               TEXT         NOT NULL,
  trend_slope_per_hr  DOUBLE PRECISION,
  window_hours        INTEGER      NOT NULL,
  observed_at         TIMESTAMPTZ  NOT NULL,
  site                TEXT         NOT NULL DEFAULT 'caia-mac',
  backend             TEXT         NOT NULL DEFAULT 'present',
  created_at          TIMESTAMPTZ  NOT NULL DEFAULT now(),
  CONSTRAINT outcome_attestations_unique
    UNIQUE (run_id, package_name, solution_id, sli_metric)
);

-- Status check — keep aligned with src/types.ts AttestationStatus.
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM pg_constraint
     WHERE conname = 'outcome_attestations_status_check'
       AND conrelid = 'caia_meta.outcome_attestations'::regclass
  ) THEN
    ALTER TABLE caia_meta.outcome_attestations
      DROP CONSTRAINT outcome_attestations_status_check;
  END IF;
END$$;

ALTER TABLE caia_meta.outcome_attestations
  ADD CONSTRAINT outcome_attestations_status_check
  CHECK (status IN ('green', 'yellow', 'red', 'no-metric-declared', 'no-metric-store', 'unknown'));

DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM pg_constraint
     WHERE conname = 'outcome_attestations_backend_check'
       AND conrelid = 'caia_meta.outcome_attestations'::regclass
  ) THEN
    ALTER TABLE caia_meta.outcome_attestations
      DROP CONSTRAINT outcome_attestations_backend_check;
  END IF;
END$$;

ALTER TABLE caia_meta.outcome_attestations
  ADD CONSTRAINT outcome_attestations_backend_check
  CHECK (backend IN ('absent', 'degraded', 'present'));

DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM pg_constraint
     WHERE conname = 'outcome_attestations_direction_check'
       AND conrelid = 'caia_meta.outcome_attestations'::regclass
  ) THEN
    ALTER TABLE caia_meta.outcome_attestations
      DROP CONSTRAINT outcome_attestations_direction_check;
  END IF;
END$$;

ALTER TABLE caia_meta.outcome_attestations
  ADD CONSTRAINT outcome_attestations_direction_check
  CHECK (direction IN ('lt', 'lte', 'gt', 'gte', 'eq', 'neq'));

-- Lookup indices.
CREATE INDEX IF NOT EXISTS outcome_attestations_pkg_sol_sli_idx
  ON caia_meta.outcome_attestations (package_name, solution_id, sli_metric, observed_at DESC);

CREATE INDEX IF NOT EXISTS outcome_attestations_run_idx
  ON caia_meta.outcome_attestations (run_id);

CREATE INDEX IF NOT EXISTS outcome_attestations_status_idx
  ON caia_meta.outcome_attestations (status)
  WHERE status IN ('red', 'no-metric-store');

CREATE INDEX IF NOT EXISTS outcome_attestations_observed_at_idx
  ON caia_meta.outcome_attestations (observed_at DESC);

-- ─── Runs roll-up (one row per run; mirrors JSONL summary). ────────────────

CREATE TABLE IF NOT EXISTS caia_meta.outcome_steward_runs (
  run_id                     TEXT         PRIMARY KEY,
  site                       TEXT         NOT NULL,
  backend                    TEXT         NOT NULL,
  window_hours               INTEGER      NOT NULL,
  started_at                 TIMESTAMPTZ  NOT NULL,
  finished_at                TIMESTAMPTZ  NOT NULL,
  green_count                INTEGER      NOT NULL DEFAULT 0,
  yellow_count               INTEGER      NOT NULL DEFAULT 0,
  red_count                  INTEGER      NOT NULL DEFAULT 0,
  no_metric_declared_count   INTEGER      NOT NULL DEFAULT 0,
  no_metric_store_count      INTEGER      NOT NULL DEFAULT 0,
  unknown_count              INTEGER      NOT NULL DEFAULT 0,
  created_at                 TIMESTAMPTZ  NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS outcome_steward_runs_finished_at_idx
  ON caia_meta.outcome_steward_runs (finished_at DESC);

-- ─── Green-id attestations (input to SPS 5th-AND completion gate). ────────

CREATE TABLE IF NOT EXISTS caia_meta.outcome_green_attestations (
  attestation_id  TEXT         PRIMARY KEY,
  run_id          TEXT         NOT NULL,
  package_name    TEXT         NOT NULL,
  solution_id     TEXT         NOT NULL,
  sli_metric      TEXT         NOT NULL,
  value           DOUBLE PRECISION NOT NULL,
  threshold       DOUBLE PRECISION NOT NULL,
  direction       TEXT         NOT NULL,
  window_hours    INTEGER      NOT NULL,
  observed_at     TIMESTAMPTZ  NOT NULL,
  site            TEXT         NOT NULL,
  created_at      TIMESTAMPTZ  NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS outcome_green_attestations_sol_idx
  ON caia_meta.outcome_green_attestations (solution_id, observed_at DESC);

CREATE INDEX IF NOT EXISTS outcome_green_attestations_pkg_idx
  ON caia_meta.outcome_green_attestations (package_name, observed_at DESC);

-- Convenience view: latest attestation per (package, solution, sli).
CREATE OR REPLACE VIEW caia_meta.outcome_attestations_latest AS
SELECT DISTINCT ON (package_name, solution_id, sli_metric)
  package_name,
  solution_id,
  sli_metric,
  status,
  latest_value,
  threshold,
  direction,
  observed_at,
  run_id
FROM caia_meta.outcome_attestations
ORDER BY package_name, solution_id, sli_metric, observed_at DESC;
