-- @caia/state-machine — Postgres schema.
--
-- Idempotent: every CREATE uses IF NOT EXISTS, the CHECK constraint is
-- rewritten by ALTER on every run, and indices are guarded by IF NOT
-- EXISTS. Safe to apply repeatedly.
--
-- Sourced from research/state_machine_handoff_spec_2026.md §2.

CREATE SCHEMA IF NOT EXISTS caia_meta;

-- -- tenant_projects ---------------------------------------------------------

CREATE TABLE IF NOT EXISTS caia_meta.tenant_projects (
  id                        UUID         PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id                 TEXT         NOT NULL,
  slug                      TEXT         NOT NULL,
  display_name              TEXT         NOT NULL,
  status                    TEXT         NOT NULL DEFAULT 'onboarding',
  paused                    BOOLEAN      NOT NULL DEFAULT false,
  paused_at                 TIMESTAMPTZ,
  paused_by                 TEXT,
  current_payload           JSONB        NOT NULL DEFAULT '{}'::jsonb,
  last_transitioned_at      TIMESTAMPTZ  NOT NULL DEFAULT now(),
  last_transitioned_by      TEXT         NOT NULL DEFAULT 'system',
  parent_project_id         UUID         REFERENCES caia_meta.tenant_projects(id),
  fork_origin_history_id    BIGINT,
  archived_at               TIMESTAMPTZ,
  version                   INTEGER      NOT NULL DEFAULT 1,
  created_at                TIMESTAMPTZ  NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, slug)
);

-- Widen / re-assert status check.
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM pg_constraint
     WHERE conname = 'tenant_projects_status_check'
       AND conrelid = 'caia_meta.tenant_projects'::regclass
  ) THEN
    ALTER TABLE caia_meta.tenant_projects
      DROP CONSTRAINT tenant_projects_status_check;
  END IF;
END$$;

ALTER TABLE caia_meta.tenant_projects
  ADD CONSTRAINT tenant_projects_status_check
  CHECK (status IN (
    'onboarding','idea-captured','interviewing','interview-complete',
    'proposal-generated','awaiting-external-design','design-uploaded',
    'ticket-tree-generated','atlas-ready','change-requested',
    'ea-dispatching','ea-complete','tests-authored','tests-reviewed',
    'scheduled','coding-in-progress','code-complete','per-story-tested',
    'e2e-tested','deploying','deployed','verified','done',
    'onboarding-failed','interviewing-failed','proposal-failed',
    'design-ingest-failed','atlas-decompose-failed','ea-dispatching-failed',
    'ea-review-failed','tests-authoring-failed','tests-review-failed',
    'scheduling-failed','coding-failed','per-story-test-failed',
    'e2e-failed','deploy-failed','verify-failed',
    'paused','revision-pending','archived'
  ));

CREATE INDEX IF NOT EXISTS tenant_projects_paused_idx
  ON caia_meta.tenant_projects(paused) WHERE paused = true;

CREATE INDEX IF NOT EXISTS tenant_projects_state_active_idx
  ON caia_meta.tenant_projects(status)
  WHERE archived_at IS NULL;

-- -- state_history ----------------------------------------------------------

CREATE TABLE IF NOT EXISTS caia_meta.state_history (
  id                BIGSERIAL    PRIMARY KEY,
  project_id        UUID         NOT NULL REFERENCES caia_meta.tenant_projects(id),
  from_state        TEXT,
  to_state          TEXT         NOT NULL,
  reason            TEXT         NOT NULL,
  actor_kind        TEXT         NOT NULL CHECK (actor_kind IN ('system','operator','agent')),
  actor_id          TEXT         NOT NULL,
  agent_run_id      UUID,
  payload           JSONB        NOT NULL DEFAULT '{}'::jsonb,
  at                TIMESTAMPTZ  NOT NULL DEFAULT now(),
  payload_hash      TEXT         NOT NULL
);

CREATE INDEX IF NOT EXISTS state_history_project_at_idx
  ON caia_meta.state_history(project_id, at DESC);
CREATE INDEX IF NOT EXISTS state_history_to_state_idx
  ON caia_meta.state_history(to_state, at DESC);
CREATE UNIQUE INDEX IF NOT EXISTS state_history_idempotency_idx
  ON caia_meta.state_history(project_id, to_state, payload_hash);

-- -- ticket_claims (distributed worker assignment) --------------------------

CREATE TABLE IF NOT EXISTS caia_meta.ticket_claims (
  ticket_id        TEXT         PRIMARY KEY,
  project_id       UUID,
  claimed_by       TEXT,
  claimed_at       TIMESTAMPTZ,
  heartbeat_at     TIMESTAMPTZ,
  ttl_seconds      INTEGER      NOT NULL DEFAULT 90,
  final_status     TEXT,
  final_at         TIMESTAMPTZ,
  version          INTEGER      NOT NULL DEFAULT 0
);

CREATE INDEX IF NOT EXISTS ticket_claims_claimed_by_idx
  ON caia_meta.ticket_claims(claimed_by) WHERE claimed_by IS NOT NULL;
CREATE INDEX IF NOT EXISTS ticket_claims_heartbeat_idx
  ON caia_meta.ticket_claims(heartbeat_at) WHERE claimed_by IS NOT NULL;

-- -- LISTEN/NOTIFY trigger for state transitions ---------------------------

CREATE OR REPLACE FUNCTION caia_meta.state_history_notify()
RETURNS trigger AS $$
DECLARE
  channel TEXT := 'caia_project_' || NEW.project_id::text;
  payload TEXT;
BEGIN
  payload := json_build_object(
    'kind', 'state-transition',
    'history_id', NEW.id,
    'from_state', NEW.from_state,
    'to_state', NEW.to_state,
    'reason', NEW.reason,
    'actor_kind', NEW.actor_kind,
    'actor_id', NEW.actor_id,
    'at', NEW.at
  )::text;
  PERFORM pg_notify(channel, payload);
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS state_history_notify_trg ON caia_meta.state_history;
CREATE TRIGGER state_history_notify_trg
  AFTER INSERT ON caia_meta.state_history
  FOR EACH ROW EXECUTE FUNCTION caia_meta.state_history_notify();
