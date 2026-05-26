-- 0011_tenants_global.sql — GLOBAL tenants lookup table.
--
-- Lives in the GLOBAL schema (NOT per-tenant), because the middleware
-- needs to resolve `email → tenant_id` BEFORE it knows which tenant the
-- request belongs to. Same pattern as the auth_users / sessions table
-- in classic multi-tenant SaaS shapes.
--
-- This migration runs against the `public` schema (or whatever the
-- global runner targets — by convention, the unprefixed connection).
-- Idempotent; safe to re-run.

CREATE TABLE IF NOT EXISTS tenants (
  tenant_id              UUID         PRIMARY KEY,
  email                  CITEXT       NOT NULL UNIQUE,
  display_name           TEXT         NOT NULL,
  schema_name            TEXT         NOT NULL UNIQUE
                           CHECK (schema_name ~ '^tenant_[a-z0-9_]+$'),
  infisical_project_id   TEXT         NOT NULL UNIQUE,
  created_at             TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
  -- Soft-delete bookmark — true row deletes are forbidden so the
  -- per-tenant schema can be quarantined for reconciliation.
  deactivated_at         TIMESTAMPTZ
);

-- Ensure CITEXT is available before the column references it. Idempotent.
CREATE EXTENSION IF NOT EXISTS citext;

-- Helpful indexes for the middleware's hot-path lookup (already covered
-- by UNIQUE constraints, but spelled out for clarity / future planners).
CREATE INDEX IF NOT EXISTS tenants_email_idx ON tenants (email);
CREATE INDEX IF NOT EXISTS tenants_created_idx ON tenants (created_at DESC);

-- Schema-creation audit table. One row per provisioning attempt, including
-- successes + failures. Driven by @caia/devops-runtime's nightly
-- reconciliation cron + by `provisionTenant()` itself.
CREATE TABLE IF NOT EXISTS tenant_provision_attempts (
  attempt_id          UUID         PRIMARY KEY DEFAULT gen_random_uuid(),
  email               CITEXT       NOT NULL,
  outcome             TEXT         NOT NULL CHECK (outcome IN ('created','reused','failed')),
  failure_reason      TEXT,
  schema_name         TEXT,
  infisical_project_id TEXT,
  attempted_at        TIMESTAMPTZ  NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS tenant_provision_attempts_email_idx
  ON tenant_provision_attempts (email, attempted_at DESC);

-- pgcrypto for `gen_random_uuid()`. Idempotent.
CREATE EXTENSION IF NOT EXISTS pgcrypto;
