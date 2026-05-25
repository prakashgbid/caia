-- @caia/business-proposal-generator — per-tenant Postgres schema.
--
-- This file is a TEMPLATE: callers substitute `{{SCHEMA}}` with the
-- target tenant schema (e.g., `caia_pt`) at apply time.
--
-- Per spec §1.3:
--   - business_proposals   3-doc revision header (immutable per revision)
--   - designapp_prompts    per-target rendered prompt + reviewer findings
--   - proposal_revisions   audit log of plan-hash → revision linkage

CREATE SCHEMA IF NOT EXISTS {{SCHEMA}};

-- -----------------------------------------------------------------------
-- business_proposals
-- -----------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS {{SCHEMA}}.business_proposals (
  id                   UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_project_id    UUID NOT NULL,
  revision_number      INTEGER NOT NULL,
  business_plan_hash   TEXT NOT NULL,
  exec_summary_md      TEXT NOT NULL,
  full_proposal_md     TEXT NOT NULL,
  one_pager_md         TEXT NOT NULL,
  formats_manifest     JSONB NOT NULL DEFAULT '{}'::jsonb,
  doc_host             TEXT
                        CHECK (doc_host IS NULL OR doc_host IN
                              ('notion','gitbook','confluence','gdrive','none')),
  doc_host_urls        JSONB,
  generated_at         TIMESTAMPTZ NOT NULL DEFAULT now(),
  generator_run_id     UUID,
  status               TEXT NOT NULL DEFAULT 'draft'
                        CHECK (status IN ('draft','reviewed','approved','archived'))
);

CREATE UNIQUE INDEX IF NOT EXISTS business_proposals_proj_rev_idx
  ON {{SCHEMA}}.business_proposals(tenant_project_id, revision_number);

CREATE INDEX IF NOT EXISTS business_proposals_hash_idx
  ON {{SCHEMA}}.business_proposals(business_plan_hash);

-- -----------------------------------------------------------------------
-- designapp_prompts
-- -----------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS {{SCHEMA}}.designapp_prompts (
  id                   UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  business_proposal_id UUID NOT NULL REFERENCES {{SCHEMA}}.business_proposals(id) ON DELETE CASCADE,
  target               TEXT NOT NULL
                        CHECK (target IN ('claude_design','figma','v0','lovable','bolt',
                                          'builderio','webflow')),
  prompt_text          TEXT NOT NULL,
  prompt_metadata      JSONB NOT NULL DEFAULT '{}'::jsonb,
  reviewer_score       NUMERIC(5,2),
  reviewer_findings    JSONB,
  reviewer_badge       TEXT
                        CHECK (reviewer_badge IS NULL OR reviewer_badge IN
                              ('ship','caution')),
  generated_at         TIMESTAMPTZ NOT NULL DEFAULT now(),
  generator_run_id     UUID,
  superseded_by        UUID
);

CREATE INDEX IF NOT EXISTS designapp_prompts_proposal_idx
  ON {{SCHEMA}}.designapp_prompts(business_proposal_id);

CREATE INDEX IF NOT EXISTS designapp_prompts_target_idx
  ON {{SCHEMA}}.designapp_prompts(target);

-- -----------------------------------------------------------------------
-- proposal_revisions
-- -----------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS {{SCHEMA}}.proposal_revisions (
  id                   UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_project_id    UUID NOT NULL,
  revision_number      INTEGER NOT NULL,
  business_proposal_id UUID NOT NULL REFERENCES {{SCHEMA}}.business_proposals(id) ON DELETE CASCADE,
  parent_revision_id   UUID,
  reason               TEXT,
  diff_summary         JSONB,
  created_at           TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS proposal_revisions_proj_rev_idx
  ON {{SCHEMA}}.proposal_revisions(tenant_project_id, revision_number);

CREATE INDEX IF NOT EXISTS proposal_revisions_parent_idx
  ON {{SCHEMA}}.proposal_revisions(parent_revision_id);

-- -----------------------------------------------------------------------
-- LISTEN/NOTIFY trigger — dashboard SSE wakeup
-- -----------------------------------------------------------------------
CREATE OR REPLACE FUNCTION {{SCHEMA}}.notify_business_proposal_ready()
RETURNS TRIGGER AS $$
BEGIN
  PERFORM pg_notify('business_proposal_ready',
    json_build_object(
      'tenant_project_id', NEW.tenant_project_id::text,
      'revision_number', NEW.revision_number,
      'proposal_id', NEW.id::text
    )::text
  );
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS business_proposal_ready_notify ON {{SCHEMA}}.business_proposals;
CREATE TRIGGER business_proposal_ready_notify
  AFTER INSERT ON {{SCHEMA}}.business_proposals
  FOR EACH ROW
  EXECUTE FUNCTION {{SCHEMA}}.notify_business_proposal_ready();
