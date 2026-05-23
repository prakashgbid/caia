-- ============================================================
-- @caia/onboarding — 0001_caia_meta_init.sql
--
-- Initial schema for the cross-tenant control plane that the
-- onboarding wizard writes to. All tables live in the
-- `caia_meta` schema. Reference: research/step1_onboarding_spec_2026.md §5.
--
-- Run idempotently — every CREATE uses IF NOT EXISTS.
-- ============================================================

CREATE SCHEMA IF NOT EXISTS caia_meta;

-- ------------------------------------------------------------
-- caia_meta.tenants — root row, cross-tenant
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS caia_meta.tenants (
  id                       UUID         PRIMARY KEY DEFAULT gen_random_uuid(),
  slug                     TEXT         NOT NULL UNIQUE,
  name                     TEXT         NOT NULL,
  owner_email              TEXT         NOT NULL,
  billing_email            TEXT         NOT NULL,
  timezone                 TEXT         NOT NULL DEFAULT 'UTC',
  locale                   TEXT         NOT NULL DEFAULT 'en-US',
  jurisdiction             TEXT,
  data_residency           TEXT         CHECK (data_residency IN ('us','eu','apac','multi')),
  status                   TEXT         NOT NULL DEFAULT 'created'
                            CHECK (status IN ('created','onboarding','onboarded','suspended','deleted')),
  onboarding_complete      BOOLEAN      NOT NULL DEFAULT false,
  onboarding_started_at    TIMESTAMPTZ,
  onboarding_completed_at  TIMESTAMPTZ,
  pricing_tier_id          TEXT,
  schema_name              TEXT,
  vault_namespace          TEXT,
  credit_balance_cents     BIGINT       NOT NULL DEFAULT 0,
  created_at               TIMESTAMPTZ  NOT NULL DEFAULT now(),
  updated_at               TIMESTAMPTZ  NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_tenants_status      ON caia_meta.tenants(status);
CREATE INDEX IF NOT EXISTS idx_tenants_owner_email ON caia_meta.tenants(owner_email);

-- ------------------------------------------------------------
-- caia_meta.onboarding_steps — one row per (tenant, category)
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS caia_meta.onboarding_steps (
  id                  UUID         PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id           UUID         NOT NULL REFERENCES caia_meta.tenants(id) ON DELETE CASCADE,
  category            TEXT         NOT NULL,
  status              TEXT         NOT NULL DEFAULT 'pending'
                       CHECK (status IN ('pending','probing','passed','failed','deferred')),
  required            BOOLEAN      NOT NULL,
  attempt_count       INT          NOT NULL DEFAULT 0,
  last_probe_at       TIMESTAMPTZ,
  last_validated_at   TIMESTAMPTZ,
  validation_payload  JSONB,
  failure_reason      TEXT,
  deferred_reason     TEXT,
  override_reason     TEXT,
  created_at          TIMESTAMPTZ  NOT NULL DEFAULT now(),
  updated_at          TIMESTAMPTZ  NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, category)
);
CREATE INDEX IF NOT EXISTS idx_steps_tenant_status
  ON caia_meta.onboarding_steps(tenant_id, status);

-- ------------------------------------------------------------
-- caia_meta.onboarding_drafts — autosave between submits
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS caia_meta.onboarding_drafts (
  tenant_id   UUID         NOT NULL REFERENCES caia_meta.tenants(id) ON DELETE CASCADE,
  category    TEXT         NOT NULL,
  form_state  JSONB        NOT NULL,
  updated_at  TIMESTAMPTZ  NOT NULL DEFAULT now(),
  PRIMARY KEY (tenant_id, category)
);

-- ------------------------------------------------------------
-- caia_meta.customer_choices — provider selections (non-secret)
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS caia_meta.customer_choices (
  tenant_id    UUID         NOT NULL REFERENCES caia_meta.tenants(id) ON DELETE CASCADE,
  category     TEXT         NOT NULL,
  choice_key   TEXT         NOT NULL,
  choice_value JSONB        NOT NULL,
  source       TEXT         NOT NULL DEFAULT 'wizard'
                CHECK (source IN ('wizard','cli','operator_override','default')),
  created_at   TIMESTAMPTZ  NOT NULL DEFAULT now(),
  PRIMARY KEY (tenant_id, category, choice_key)
);
CREATE INDEX IF NOT EXISTS idx_choices_tenant_category
  ON caia_meta.customer_choices(tenant_id, category);

-- ------------------------------------------------------------
-- caia_meta.credentials — Vault pointer + metadata
-- Never stores the raw secret value.
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS caia_meta.credentials (
  id              UUID         PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id       UUID         NOT NULL REFERENCES caia_meta.tenants(id) ON DELETE CASCADE,
  category        TEXT         NOT NULL,
  key_id          TEXT         NOT NULL,
  secret_ref      TEXT         NOT NULL,
  archetype       TEXT         NOT NULL
                   CHECK (archetype IN ('oauth','api_token','dns','webhook','endpoint')),
  provider        TEXT         NOT NULL,
  scopes_granted  TEXT[],
  scopes_required TEXT[],
  expires_at      TIMESTAMPTZ,
  last_used_at    TIMESTAMPTZ,
  last_rotated_at TIMESTAMPTZ,
  status          TEXT         NOT NULL DEFAULT 'active'
                   CHECK (status IN ('active','rotating','deprecated','revoked')),
  validated_at    TIMESTAMPTZ  NOT NULL,
  metadata        JSONB        NOT NULL DEFAULT '{}'::jsonb,
  created_at      TIMESTAMPTZ  NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, category, key_id, status)
);
CREATE INDEX IF NOT EXISTS idx_creds_tenant_category
  ON caia_meta.credentials(tenant_id, category);
CREATE INDEX IF NOT EXISTS idx_creds_expires_at
  ON caia_meta.credentials(expires_at) WHERE expires_at IS NOT NULL;

-- ------------------------------------------------------------
-- caia_meta.audit_log — append-only event log
-- Partitioned by month; root table created here, first partition below.
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS caia_meta.audit_log (
  id           UUID         NOT NULL DEFAULT gen_random_uuid(),
  tenant_id    UUID         NOT NULL,
  occurred_at  TIMESTAMPTZ  NOT NULL DEFAULT now(),
  actor_type   TEXT         NOT NULL,
  actor_id     TEXT,
  action       TEXT         NOT NULL,
  category     TEXT,
  key_id       TEXT,
  ticket_id    UUID,
  request_ip   INET,
  user_agent   TEXT,
  payload      JSONB        NOT NULL DEFAULT '{}'::jsonb,
  CHECK (action ~ '^[a-z_.]+$'),
  PRIMARY KEY (id, occurred_at)
) PARTITION BY RANGE (occurred_at);

CREATE INDEX IF NOT EXISTS idx_audit_tenant_time
  ON caia_meta.audit_log(tenant_id, occurred_at DESC);

-- Seed: a permissive default partition that covers all timestamps.
-- Production operators replace this with monthly partitions and a
-- nightly rotator job.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_class
    WHERE relname = 'audit_log_default'
      AND relnamespace = 'caia_meta'::regnamespace
  ) THEN
    EXECUTE 'CREATE TABLE caia_meta.audit_log_default
             PARTITION OF caia_meta.audit_log DEFAULT';
  END IF;
END
$$;

-- ------------------------------------------------------------
-- Trigger: bump updated_at on tenants + steps
-- ------------------------------------------------------------
CREATE OR REPLACE FUNCTION caia_meta._bump_updated_at() RETURNS trigger AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_tenants_updated_at      ON caia_meta.tenants;
CREATE TRIGGER trg_tenants_updated_at
  BEFORE UPDATE ON caia_meta.tenants
  FOR EACH ROW EXECUTE FUNCTION caia_meta._bump_updated_at();

DROP TRIGGER IF EXISTS trg_steps_updated_at        ON caia_meta.onboarding_steps;
CREATE TRIGGER trg_steps_updated_at
  BEFORE UPDATE ON caia_meta.onboarding_steps
  FOR EACH ROW EXECUTE FUNCTION caia_meta._bump_updated_at();
