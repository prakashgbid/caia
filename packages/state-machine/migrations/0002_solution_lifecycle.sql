-- @caia/state-machine — Solution lifecycle (Real Definition-of-Done).
--
-- Adds two tables next to the project FSM tables (state_history /
-- tenant_projects) for the Solution entity. Separate from
-- caia_meta.state_history to avoid wedging an extra solution_id column
-- onto every existing project row and to give the lifecycle clear
-- namespace separation (per ADR-035 + the operator's prompt rec).
--
-- Idempotent: every CREATE uses IF NOT EXISTS, the CHECK constraint is
-- rewritten via DROP+ADD on every run, and indices are guarded by IF
-- NOT EXISTS. Safe to apply repeatedly.

CREATE SCHEMA IF NOT EXISTS caia_meta;

-- ----------------------------------------------------------------------
-- solution_lifecycle (per-solution row, mutated atomically with an
-- optimistic-version check; see PgSolutionStore.advanceAtomic)
-- ----------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS caia_meta.solution_lifecycle (
  id                       UUID         PRIMARY KEY DEFAULT gen_random_uuid(),
  -- Stable join key across deploy-steward / usage-steward / activation-steward /
  -- outcome-steward / EA AKG / ADR registry. Format: caia-YYYY-MM-DD-short-slug.
  solution_id              TEXT         NOT NULL UNIQUE,
  title                    TEXT         NOT NULL,
  plan_path                TEXT,
  approved_by_adr          TEXT,
  approved_at              TIMESTAMPTZ  NOT NULL DEFAULT now(),
  status                   TEXT         NOT NULL DEFAULT 'approved',
  status_since             TIMESTAMPTZ  NOT NULL DEFAULT now(),
  paused                   BOOLEAN      NOT NULL DEFAULT false,
  paused_at                TIMESTAMPTZ,
  paused_by                TEXT,
  prior_state              TEXT,                              -- saved on pause for resume
  current_payload          JSONB        NOT NULL DEFAULT '{}'::jsonb,
  last_attestation         JSONB        NOT NULL DEFAULT '{}'::jsonb,
  manifest_pointer         TEXT,                              -- agent-memory yaml pointer
  abandoned_at             TIMESTAMPTZ,
  done_at                  TIMESTAMPTZ,
  version                  INTEGER      NOT NULL DEFAULT 1,
  created_at               TIMESTAMPTZ  NOT NULL DEFAULT now()
);

-- Re-assert the status check (23 states: 9 forward + 7 failed + 5 rolled-back + 2 control).
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM pg_constraint
     WHERE conname = 'solution_lifecycle_status_check'
       AND conrelid = 'caia_meta.solution_lifecycle'::regclass
  ) THEN
    ALTER TABLE caia_meta.solution_lifecycle
      DROP CONSTRAINT solution_lifecycle_status_check;
  END IF;
END$$;

ALTER TABLE caia_meta.solution_lifecycle
  ADD CONSTRAINT solution_lifecycle_status_check
  CHECK (status IN (
    -- Forward (9)
    'approved','implemented','merged','deployed','imported',
    'called-in-test','called-in-prod','producing-metrics','done',
    -- Failed (7)
    'implemented-failed','merged-failed','deployed-failed','imported-failed',
    'called-in-test-failed','called-in-prod-failed','producing-metrics-failed',
    -- Rolled-back (5)
    'deployed-rolled-back','imported-rolled-back','called-in-test-rolled-back',
    'called-in-prod-rolled-back','producing-metrics-rolled-back',
    -- Control (2)
    'paused','abandoned'
  ));

-- Same check on prior_state (only the non-control, non-terminal states
-- are valid resume targets, but we allow any solution-state here for
-- forward compat).
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM pg_constraint
     WHERE conname = 'solution_lifecycle_prior_state_check'
       AND conrelid = 'caia_meta.solution_lifecycle'::regclass
  ) THEN
    ALTER TABLE caia_meta.solution_lifecycle
      DROP CONSTRAINT solution_lifecycle_prior_state_check;
  END IF;
END$$;

ALTER TABLE caia_meta.solution_lifecycle
  ADD CONSTRAINT solution_lifecycle_prior_state_check
  CHECK (prior_state IS NULL OR prior_state IN (
    'approved','implemented','merged','deployed','imported',
    'called-in-test','called-in-prod','producing-metrics','done',
    'implemented-failed','merged-failed','deployed-failed','imported-failed',
    'called-in-test-failed','called-in-prod-failed','producing-metrics-failed',
    'deployed-rolled-back','imported-rolled-back','called-in-test-rolled-back',
    'called-in-prod-rolled-back','producing-metrics-rolled-back',
    'paused','abandoned'
  ));

-- Index for getStuckSolutions — the conductor enumerates active,
-- non-paused, non-terminal solutions every 10 min and joins on status +
-- status_since.
CREATE INDEX IF NOT EXISTS solution_lifecycle_stuck_idx
  ON caia_meta.solution_lifecycle(status, status_since)
  WHERE paused = false AND abandoned_at IS NULL AND done_at IS NULL;

CREATE INDEX IF NOT EXISTS solution_lifecycle_active_idx
  ON caia_meta.solution_lifecycle(status)
  WHERE abandoned_at IS NULL AND done_at IS NULL;

-- ----------------------------------------------------------------------
-- solution_history (append-only audit + idempotency anchor)
-- ----------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS caia_meta.solution_history (
  id                BIGSERIAL    PRIMARY KEY,
  solution_id       TEXT         NOT NULL REFERENCES caia_meta.solution_lifecycle(solution_id),
  from_state        TEXT,
  to_state          TEXT         NOT NULL,
  reason            TEXT         NOT NULL,
  actor_kind        TEXT         NOT NULL CHECK (actor_kind IN ('system','operator','agent','steward')),
  actor_id          TEXT         NOT NULL,
  attestation       JSONB        NOT NULL DEFAULT '{}'::jsonb,
  evidence          JSONB        NOT NULL DEFAULT '{}'::jsonb,
  payload           JSONB        NOT NULL DEFAULT '{}'::jsonb,
  payload_hash      TEXT         NOT NULL,
  at                TIMESTAMPTZ  NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS solution_history_solution_at_idx
  ON caia_meta.solution_history(solution_id, at DESC);
CREATE INDEX IF NOT EXISTS solution_history_to_state_idx
  ON caia_meta.solution_history(to_state, at DESC);
CREATE UNIQUE INDEX IF NOT EXISTS solution_history_idempotency_idx
  ON caia_meta.solution_history(solution_id, to_state, payload_hash);

-- ----------------------------------------------------------------------
-- LISTEN/NOTIFY trigger so subscribers (pipeline-conductor + dashboard)
-- get realtime advancement events.
-- ----------------------------------------------------------------------

CREATE OR REPLACE FUNCTION caia_meta.solution_history_notify()
RETURNS trigger AS $$
DECLARE
  channel TEXT := 'caia_solution_' || NEW.solution_id;
  payload TEXT;
BEGIN
  payload := json_build_object(
    'kind',        'solution-advanced',
    'history_id',  NEW.id,
    'from_state',  NEW.from_state,
    'to_state',    NEW.to_state,
    'reason',      NEW.reason,
    'actor_kind',  NEW.actor_kind,
    'actor_id',    NEW.actor_id,
    'at',          NEW.at
  )::text;
  PERFORM pg_notify(channel, payload);
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS solution_history_notify_trg ON caia_meta.solution_history;
CREATE TRIGGER solution_history_notify_trg
  AFTER INSERT ON caia_meta.solution_history
  FOR EACH ROW EXECUTE FUNCTION caia_meta.solution_history_notify();
