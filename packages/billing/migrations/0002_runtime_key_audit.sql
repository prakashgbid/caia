-- ============================================================
-- @caia/billing — 0002_runtime_key_audit.sql
--
-- Append-only audit log of every BYOK runtime-key READ. The READS
-- table is critical for GDPR/SOC2: a tenant can ask "who looked at
-- my Anthropic key and when?" and we must answer.
--
-- Writes (set/revoke) are NOT logged here — they go through the
-- secrets-broker's `caia_secrets.access_log` (created by
-- @caia/secrets-postgres/0002_audit_log.sql). This table is
-- READ-only ledger.
-- ============================================================

CREATE SCHEMA IF NOT EXISTS caia_meta;

-- ------------------------------------------------------------
-- caia_meta.audit_runtime_key_reads — append-only
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS caia_meta.audit_runtime_key_reads (
  id              BIGSERIAL    PRIMARY KEY,
  tenant_id       UUID         NOT NULL
                   REFERENCES caia_meta.tenants(id) ON DELETE CASCADE,
  provider        TEXT         NOT NULL
                   CHECK (provider IN (
                     'anthropic','openai','google','azure',
                     'aws-bedrock','mistral','cohere'
                   )),
  caller_type     TEXT         NOT NULL
                   CHECK (caller_type IN (
                     'agent','user','deploy-worker','cron','system'
                   )),
  caller_id       TEXT         NOT NULL,
  ticket_id       TEXT,
  reason          TEXT         NOT NULL,
  ok              BOOLEAN      NOT NULL,
  error_class     TEXT         CHECK (
                    error_class IS NULL OR error_class IN (
                      'not_found','policy_denied','rate_limited','provider_error'
                    )
                  ),
  read_at         TIMESTAMPTZ  NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_audit_runtime_reads_tenant_read_at
  ON caia_meta.audit_runtime_key_reads(tenant_id, read_at DESC);

CREATE INDEX IF NOT EXISTS idx_audit_runtime_reads_tenant_provider_read_at
  ON caia_meta.audit_runtime_key_reads(tenant_id, provider, read_at DESC);

CREATE INDEX IF NOT EXISTS idx_audit_runtime_reads_caller
  ON caia_meta.audit_runtime_key_reads(caller_type, caller_id, read_at DESC);

-- The audit ledger is append-only. UPDATE/DELETE are explicitly
-- blocked at the row level. Operator-side purge happens via a separate
-- service-role pathway documented in the README.
CREATE OR REPLACE FUNCTION caia_meta.audit_runtime_key_reads_no_mutate()
RETURNS TRIGGER AS $$
BEGIN
  RAISE EXCEPTION
    'audit_runtime_key_reads is append-only — % blocked. See README §"Audit retention".',
    TG_OP;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_audit_runtime_reads_no_update
  ON caia_meta.audit_runtime_key_reads;
DROP TRIGGER IF EXISTS trg_audit_runtime_reads_no_delete
  ON caia_meta.audit_runtime_key_reads;

CREATE TRIGGER trg_audit_runtime_reads_no_update
  BEFORE UPDATE ON caia_meta.audit_runtime_key_reads
  FOR EACH ROW EXECUTE FUNCTION caia_meta.audit_runtime_key_reads_no_mutate();

CREATE TRIGGER trg_audit_runtime_reads_no_delete
  BEFORE DELETE ON caia_meta.audit_runtime_key_reads
  FOR EACH ROW EXECUTE FUNCTION caia_meta.audit_runtime_key_reads_no_mutate();

COMMENT ON TABLE caia_meta.audit_runtime_key_reads IS
  '@caia/billing Layer 2 — append-only audit ledger of every BYOK runtime-key read. '
  'Required for SOC2/GDPR "who saw my key" reports.';
