-- 0010_wizard_state.sql — per-tenant wizard_state table.
--
-- Applied against EACH tenant's schema (the `{{SCHEMA}}` placeholder is
-- substituted at apply time by the migration runner, mirroring the pattern
-- used by @caia/grand-idea and @caia/info-architect). Idempotent.
--
-- Schema lives next to the existing per-tenant tables (business_plans,
-- pages_catalogue, etc.). It is a per-tenant materialised view of the
-- canonical FSM state — the FSM rows themselves stay in `tenant_projects`
-- (also per-tenant). `wizard_state` denormalises (last-step, last-touch,
-- per-step UI flags) for fast wizard renders without hitting the FSM log.
--
-- One row per project; the wizard renders the latest snapshot. History is
-- in `tenant_state_transitions` (managed by @caia/state-machine, not us).

CREATE TABLE IF NOT EXISTS "{{SCHEMA}}".wizard_state (
  project_id        UUID         PRIMARY KEY,
  current_slug      TEXT         NOT NULL,
  current_step_idx  INTEGER      NOT NULL CHECK (current_step_idx BETWEEN 1 AND 7),
  ui_flags          JSONB        NOT NULL DEFAULT '{}'::jsonb,
  created_at        TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
  updated_at        TIMESTAMPTZ  NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS wizard_state_updated_idx
  ON "{{SCHEMA}}".wizard_state (updated_at DESC);

-- Trigger: touch updated_at on any UPDATE. Per-tenant trigger names must
-- be unique inside the schema; `wizard_state` is unique already.
CREATE OR REPLACE FUNCTION "{{SCHEMA}}".wizard_state_touch_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS wizard_state_touch ON "{{SCHEMA}}".wizard_state;
CREATE TRIGGER wizard_state_touch
  BEFORE UPDATE ON "{{SCHEMA}}".wizard_state
  FOR EACH ROW
  EXECUTE FUNCTION "{{SCHEMA}}".wizard_state_touch_updated_at();
