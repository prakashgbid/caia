-- @caia/usage-steward — Postgres attestation history.
--
-- Per-(run × package) row. Lets operators query "show every
-- declared-shipped-but-unused package in the last 7 days" via SQL,
-- and powers the dashboard's per-package trend view.
--
-- Idempotent: every CREATE uses IF NOT EXISTS; constraint rebuilds
-- are guarded by DO $$ … $$ blocks. Safe to apply repeatedly.

CREATE SCHEMA IF NOT EXISTS caia_meta;

CREATE TABLE IF NOT EXISTS caia_meta.usage_attestations (
  id                         BIGSERIAL    PRIMARY KEY,
  run_id                     TEXT         NOT NULL,
  package_name               TEXT         NOT NULL,
  solution_id                TEXT,
  status                     TEXT         NOT NULL,
  site                       TEXT         NOT NULL DEFAULT 'caia-mac',
  observed_at                TIMESTAMPTZ  NOT NULL,
  expected_import_count      INTEGER      NOT NULL DEFAULT 0,
  satisfied_import_count     INTEGER      NOT NULL DEFAULT 0,
  expected_export_count      INTEGER      NOT NULL DEFAULT 0,
  reachable_export_count     INTEGER      NOT NULL DEFAULT 0,
  orphan_count               INTEGER      NOT NULL DEFAULT 0,
  unused_dep_count           INTEGER      NOT NULL DEFAULT 0,
  missing_dep_count          INTEGER      NOT NULL DEFAULT 0,
  circular_dep_count         INTEGER      NOT NULL DEFAULT 0,
  note                       TEXT,
  created_at                 TIMESTAMPTZ  NOT NULL DEFAULT now(),
  CONSTRAINT usage_attestations_unique
    UNIQUE (run_id, package_name, site)
);

-- Status check — keep aligned with src/types.ts AttestationStatus.
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM pg_constraint
     WHERE conname = 'usage_attestations_status_check'
       AND conrelid = 'caia_meta.usage_attestations'::regclass
  ) THEN
    ALTER TABLE caia_meta.usage_attestations
      DROP CONSTRAINT usage_attestations_status_check;
  END IF;
END$$;

ALTER TABLE caia_meta.usage_attestations
  ADD CONSTRAINT usage_attestations_status_check
  CHECK (status IN ('green', 'yellow', 'red', 'no-tooling', 'unknown'));

-- Lookup indices.
CREATE INDEX IF NOT EXISTS usage_attestations_pkg_idx
  ON caia_meta.usage_attestations (package_name, observed_at DESC);

CREATE INDEX IF NOT EXISTS usage_attestations_run_idx
  ON caia_meta.usage_attestations (run_id);

CREATE INDEX IF NOT EXISTS usage_attestations_status_idx
  ON caia_meta.usage_attestations (status)
  WHERE status IN ('red', 'no-tooling');

CREATE INDEX IF NOT EXISTS usage_attestations_observed_at_idx
  ON caia_meta.usage_attestations (observed_at DESC);

CREATE INDEX IF NOT EXISTS usage_attestations_solution_idx
  ON caia_meta.usage_attestations (solution_id)
  WHERE solution_id IS NOT NULL;

-- ─── Runs roll-up (one row per run; mirrors JSONL summary). ────────────────

CREATE TABLE IF NOT EXISTS caia_meta.usage_steward_runs (
  run_id              TEXT         PRIMARY KEY,
  site                TEXT         NOT NULL,
  packages_root       TEXT         NOT NULL,
  scanner_states      JSONB        NOT NULL DEFAULT '{}'::jsonb,
  started_at          TIMESTAMPTZ  NOT NULL,
  finished_at         TIMESTAMPTZ  NOT NULL,
  green_count         INTEGER      NOT NULL DEFAULT 0,
  yellow_count        INTEGER      NOT NULL DEFAULT 0,
  red_count           INTEGER      NOT NULL DEFAULT 0,
  no_tooling_count    INTEGER      NOT NULL DEFAULT 0,
  unknown_count       INTEGER      NOT NULL DEFAULT 0,
  created_at          TIMESTAMPTZ  NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS usage_steward_runs_finished_at_idx
  ON caia_meta.usage_steward_runs (finished_at DESC);

-- ─── Green-id attestations (feeds SPS 5th-AND gate). ──────────────────────

CREATE TABLE IF NOT EXISTS caia_meta.usage_green_attestations (
  id                  BIGSERIAL    PRIMARY KEY,
  package_name        TEXT         NOT NULL,
  solution_id         TEXT,
  run_id              TEXT         NOT NULL,
  site                TEXT         NOT NULL DEFAULT 'caia-mac',
  attested_at         TIMESTAMPTZ  NOT NULL,
  created_at          TIMESTAMPTZ  NOT NULL DEFAULT now(),
  CONSTRAINT usage_green_attestations_unique
    UNIQUE (package_name, site, run_id)
);

CREATE INDEX IF NOT EXISTS usage_green_attestations_pkg_site_idx
  ON caia_meta.usage_green_attestations (package_name, site, attested_at DESC);

-- Convenience view: latest attestation per package + site.
CREATE OR REPLACE VIEW caia_meta.usage_attestations_latest AS
SELECT DISTINCT ON (package_name, site)
  package_name,
  site,
  status,
  orphan_count,
  unused_dep_count,
  missing_dep_count,
  circular_dep_count,
  observed_at,
  run_id
FROM caia_meta.usage_attestations
ORDER BY package_name, site, observed_at DESC;
