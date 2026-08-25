-- Vision Intake E1 — initial schema
-- Source spec: https://thivaan.atlassian.net/wiki/spaces/CAIA/pages/7372811
-- Design: 10 tables + RLS tenancy + outbox pattern for Kafka event publishing
-- Ratified ADRs: CAIA-006 (tenant isolation), CAIA-013 (per-app dedicated infra), CAIA-014 (auth)

BEGIN;

CREATE SCHEMA IF NOT EXISTS vision_intake;
SET search_path TO vision_intake, public;

-- ============================================================================
-- 1. tenants (mirror of control-plane tenant identity for RLS pinning)
-- ============================================================================
CREATE TABLE IF NOT EXISTS tenants (
  tenant_id UUID PRIMARY KEY,
  display_name TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ============================================================================
-- 2. intake_sessions — one per idea, one per founder
-- ============================================================================
CREATE TABLE IF NOT EXISTS intake_sessions (
  session_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES tenants(tenant_id),
  founder_user_id UUID NOT NULL,
  idea_title TEXT,
  state TEXT NOT NULL DEFAULT '"'"'DRAFT'"'"'
    CHECK (state IN ('"'"'DRAFT'"'"','"'"'CAPTURED'"'"','"'"'REFINING'"'"','"'"'CONVERGED'"'"','"'"'GENERATING'"'"','"'"'REVIEW'"'"','"'"'COMPLETE'"'"','"'"'ESCALATED'"'"','"'"'ABANDONED'"'"')),
  loop_count INT NOT NULL DEFAULT 0,
  revision_count INT NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  completed_at TIMESTAMPTZ
);
CREATE INDEX idx_intake_sessions_tenant ON intake_sessions(tenant_id, state);
CREATE INDEX idx_intake_sessions_founder ON intake_sessions(founder_user_id);

-- ============================================================================
-- 3. intake_answers — wizard step responses (autosave, resumable)
-- ============================================================================
CREATE TABLE IF NOT EXISTS intake_answers (
  answer_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  session_id UUID NOT NULL REFERENCES intake_sessions(session_id) ON DELETE CASCADE,
  tenant_id UUID NOT NULL REFERENCES tenants(tenant_id),
  step_key TEXT NOT NULL,
  answer_json JSONB NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (session_id, step_key)
);
CREATE INDEX idx_intake_answers_session ON intake_answers(session_id);

-- ============================================================================
-- 4. intake_uploads — deck, resume, market research etc.
-- ============================================================================
CREATE TABLE IF NOT EXISTS intake_uploads (
  upload_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  session_id UUID NOT NULL REFERENCES intake_sessions(session_id) ON DELETE CASCADE,
  tenant_id UUID NOT NULL REFERENCES tenants(tenant_id),
  filename TEXT NOT NULL,
  content_type TEXT NOT NULL,
  minio_object_key TEXT NOT NULL,
  size_bytes BIGINT NOT NULL,
  sha256 TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX idx_intake_uploads_session ON intake_uploads(session_id);

-- ============================================================================
-- 5. brief_drafts — LLM refinement loop artifacts
-- ============================================================================
CREATE TABLE IF NOT EXISTS brief_drafts (
  draft_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  session_id UUID NOT NULL REFERENCES intake_sessions(session_id) ON DELETE CASCADE,
  tenant_id UUID NOT NULL REFERENCES tenants(tenant_id),
  loop_iteration INT NOT NULL,
  brief_json JSONB NOT NULL,
  llm_model_used TEXT NOT NULL,
  llm_tokens_in INT NOT NULL DEFAULT 0,
  llm_tokens_out INT NOT NULL DEFAULT 0,
  converged BOOLEAN NOT NULL DEFAULT FALSE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX idx_brief_drafts_session ON brief_drafts(session_id, loop_iteration);

-- ============================================================================
-- 6. clarifying_questions — LLM -> founder feedback loop
-- ============================================================================
CREATE TABLE IF NOT EXISTS clarifying_questions (
  question_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  session_id UUID NOT NULL REFERENCES intake_sessions(session_id) ON DELETE CASCADE,
  tenant_id UUID NOT NULL REFERENCES tenants(tenant_id),
  loop_iteration INT NOT NULL,
  question_text TEXT NOT NULL,
  founder_answer_text TEXT,
  answered_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX idx_clarifying_questions_session ON clarifying_questions(session_id, loop_iteration);

-- ============================================================================
-- 7. dossier_epics — the 7-epic startup dossier output
-- ============================================================================
CREATE TABLE IF NOT EXISTS dossier_epics (
  epic_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  session_id UUID NOT NULL REFERENCES intake_sessions(session_id) ON DELETE CASCADE,
  tenant_id UUID NOT NULL REFERENCES tenants(tenant_id),
  epic_slug TEXT NOT NULL CHECK (epic_slug IN ('"'"'market'"'"','"'"'product_vision'"'"','"'"'business_model'"'"','"'"'financials'"'"','"'"'investor_materials'"'"','"'"'moat'"'"','"'"'team_and_traction'"'"')),
  state TEXT NOT NULL DEFAULT '"'"'PENDING'"'"'
    CHECK (state IN ('"'"'PENDING'"'"','"'"'GENERATING'"'"','"'"'READY'"'"','"'"'IN_REVIEW'"'"','"'"'CHANGES_REQUESTED'"'"','"'"'SIGNED_OFF'"'"','"'"'ESCALATED'"'"')),
  confluence_page_id TEXT,
  jira_epic_key TEXT,
  content_json JSONB,
  revision_count INT NOT NULL DEFAULT 0,
  signed_off_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (session_id, epic_slug)
);
CREATE INDEX idx_dossier_epics_session ON dossier_epics(session_id, state);

-- ============================================================================
-- 8. dossier_reviews — founder comment/revision thread per epic
-- ============================================================================
CREATE TABLE IF NOT EXISTS dossier_reviews (
  review_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  epic_id UUID NOT NULL REFERENCES dossier_epics(epic_id) ON DELETE CASCADE,
  tenant_id UUID NOT NULL REFERENCES tenants(tenant_id),
  section_ref TEXT,
  actor_kind TEXT NOT NULL CHECK (actor_kind IN ('"'"'founder'"'"','"'"'llm'"'"','"'"'orchestrator'"'"')),
  actor_id UUID,
  comment_text TEXT NOT NULL,
  action_taken TEXT CHECK (action_taken IN ('"'"'REVISED'"'"','"'"'SIGNED_OFF'"'"','"'"'ESCALATED'"'"',NULL)),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX idx_dossier_reviews_epic ON dossier_reviews(epic_id, created_at);

-- ============================================================================
-- 9. outbox — durable event bus writer (Kafka publisher polls this)
-- ============================================================================
CREATE TABLE IF NOT EXISTS outbox (
  event_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES tenants(tenant_id),
  aggregate_type TEXT NOT NULL,
  aggregate_id UUID NOT NULL,
  event_type TEXT NOT NULL,
  event_payload JSONB NOT NULL,
  topic TEXT NOT NULL CHECK (topic IN ('"'"'vision-intake.session.events'"'"','"'"'vision-intake.brief.events'"'"','"'"'vision-intake.dossier.events'"'"','"'"'vision-intake.review.events'"'"')),
  status TEXT NOT NULL DEFAULT '"'"'PENDING'"'"' CHECK (status IN ('"'"'PENDING'"'"','"'"'PUBLISHED'"'"','"'"'FAILED'"'"')),
  attempt_count INT NOT NULL DEFAULT 0,
  last_error TEXT,
  published_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX idx_outbox_pending ON outbox(status, created_at) WHERE status = '"'"'PENDING'"'"';
CREATE INDEX idx_outbox_tenant ON outbox(tenant_id, created_at);

-- ============================================================================
-- 10. session_audit — every state transition + actor for compliance
-- ============================================================================
CREATE TABLE IF NOT EXISTS session_audit (
  audit_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  session_id UUID NOT NULL REFERENCES intake_sessions(session_id) ON DELETE CASCADE,
  tenant_id UUID NOT NULL REFERENCES tenants(tenant_id),
  from_state TEXT,
  to_state TEXT NOT NULL,
  actor_kind TEXT NOT NULL CHECK (actor_kind IN ('"'"'founder'"'"','"'"'llm'"'"','"'"'orchestrator'"'"','"'"'system'"'"')),
  actor_id UUID,
  reason TEXT,
  metadata_json JSONB,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX idx_session_audit_session ON session_audit(session_id, created_at);

-- ============================================================================
-- Row-Level Security — enforce tenant isolation everywhere
-- ============================================================================
DO $$
DECLARE t TEXT;
BEGIN
  FOR t IN
    SELECT tablename FROM pg_tables
    WHERE schemaname = '"'"'vision_intake'"'"'
      AND tablename IN ('"'"'intake_sessions'"'"','"'"'intake_answers'"'"','"'"'intake_uploads'"'"',
                        '"'"'brief_drafts'"'"','"'"'clarifying_questions'"'"','"'"'dossier_epics'"'"',
                        '"'"'dossier_reviews'"'"','"'"'outbox'"'"','"'"'session_audit'"'"')
  LOOP
    EXECUTE format('"'"'ALTER TABLE vision_intake.%I ENABLE ROW LEVEL SECURITY'"'"', t);
    EXECUTE format('"'"'CREATE POLICY tenant_isolation_%I ON vision_intake.%I USING (tenant_id::text = current_setting('"'"'"'"'app.current_tenant'"'"'"'"', TRUE))'"'"', t, t);
  END LOOP;
END $$;

COMMIT;
