-- @caia/state-machine — Information Architect (Step 3.5) state enum extension.
--
-- ADR-024 (2026-05-25): the Information Architect agent sits between the
-- Interviewer (Step 3) and the Proposal Generator (Step 4). It emits three
-- canonical structural artifacts (pages-catalogue, design-system,
-- components-library). To track its lifecycle the project FSM gains three
-- new states. The CHECK constraint on caia_meta.tenant_projects.status
-- is rewritten via DROP+ADD because Postgres has no convenient
-- ALTER-CONSTRAINT-ADD-VALUE escape hatch for CHECK constraints (unlike
-- enums).
--
-- Idempotent: DROP IF EXISTS + ADD makes this safe to apply repeatedly.

ALTER TABLE caia_meta.tenant_projects
  DROP CONSTRAINT IF EXISTS tenant_projects_status_check;

ALTER TABLE caia_meta.tenant_projects
  ADD CONSTRAINT tenant_projects_status_check
  CHECK (status IN (
    'onboarding','idea-captured','interviewing','interview-complete',
    -- ADR-024: Information Architect (Step 3.5) ---------------------------
    'information-architecture-in-progress',
    'information-architecture-complete',
    -- ---------------------------------------------------------------------
    'proposal-generated','awaiting-external-design','design-uploaded',
    'ticket-tree-generated','atlas-ready','change-requested',
    'ea-dispatching','ea-complete','tests-authored','tests-reviewed',
    'scheduled','coding-in-progress','code-complete','per-story-tested',
    'e2e-tested','deploying','deployed','verified','done',
    'onboarding-failed','interviewing-failed',
    -- ADR-024: IA failure state -------------------------------------------
    'information-architecture-failed',
    -- ---------------------------------------------------------------------
    'proposal-failed',
    'design-ingest-failed','atlas-decompose-failed','ea-dispatching-failed',
    'ea-review-failed','tests-authoring-failed','tests-review-failed',
    'scheduling-failed','coding-failed','per-story-test-failed',
    'e2e-failed','deploy-failed','verify-failed',
    'paused','revision-pending','archived'
  ));

-- Partial index for the dashboard's "IA in flight" widget.
CREATE INDEX IF NOT EXISTS tenant_projects_ia_in_progress_idx
  ON caia_meta.tenant_projects(status)
  WHERE status = 'information-architecture-in-progress'
    AND archived_at IS NULL;
