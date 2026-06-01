-- ============================================================
-- @caia/billing — 0003_tenant_usage_meter.sql
--
-- Per-tenant Claude usage meter (Phase C3). Every successful
-- `@chiefaia/claude-spawner` spawn for a subscription-tier tenant
-- writes one row here, capturing input/output token counts so a
-- monthly cron can aggregate and post a Stripe usage record.
--
-- Schema-templated: `{{SCHEMA}}` is replaced by the operator-supplied
-- schema name at apply time. Default for CAIA prod is `caia_meta`
-- (lives alongside the subscription state tables); test fixtures use
-- whatever schema the test harness creates.
--
-- BYOK tenants NEVER hit this table — the spawner short-circuits via
-- `@caia/secrets-adapter.hasRuntimeKey(tenantId, provider)` before the
-- meter call. The check is documented here so future operators don't
-- accidentally seed BYOK rows.
--
-- Stub mode: when `STRIPE_SECRET_KEY` is unset (or the Stripe SDK
-- fails to initialise), rows still accumulate; only the final
-- `postStripeUsageRecord` step becomes a no-op + warning log. This
-- means once an operator drops a valid key into Infisical at
-- `caia_global.billing.stripe_secret_key`, the back-fill of the
-- previous month happens automatically on the next cron tick.
--
-- Run idempotently — every CREATE uses IF NOT EXISTS.
-- ============================================================

CREATE SCHEMA IF NOT EXISTS {{SCHEMA}};

-- ------------------------------------------------------------
-- {{SCHEMA}}.tenant_usage_meter — append-mostly per-spawn rows
-- ------------------------------------------------------------
-- One row per spawn. `aggregated_for_yyyymm` is NULL until the
-- monthly cron sweeps the row into a Stripe usage record; once set,
-- the row is immutable (the aggregator queries `IS NULL` so a
-- partial month re-run never double-counts).
CREATE TABLE IF NOT EXISTS {{SCHEMA}}.tenant_usage_meter (
  id                       BIGSERIAL    PRIMARY KEY,
  tenant_id                UUID         NOT NULL,
  tier                     TEXT         NOT NULL
                            CHECK (tier IN ('free','professional','team')),
  model                    TEXT         NOT NULL,
  input_tokens             BIGINT       NOT NULL DEFAULT 0
                            CHECK (input_tokens >= 0),
  output_tokens            BIGINT       NOT NULL DEFAULT 0
                            CHECK (output_tokens >= 0),
  cache_creation_tokens    BIGINT       NOT NULL DEFAULT 0
                            CHECK (cache_creation_tokens >= 0),
  cache_read_tokens        BIGINT       NOT NULL DEFAULT 0
                            CHECK (cache_read_tokens >= 0),
  ts                       TIMESTAMPTZ  NOT NULL DEFAULT now(),
  -- yyyymm bucket the row was aggregated under; NULL = not yet
  -- aggregated. Set by the monthly cron when it posts the Stripe
  -- usage record. Idempotency guard: cron only sweeps rows with NULL.
  aggregated_for_yyyymm    INTEGER,
  -- Returned Stripe usage record id, for receipts / debugging.
  stripe_usage_record_id   TEXT
);

-- ------------------------------------------------------------
-- Indexes — task spec calls out (tenantId, ts, model).
-- ------------------------------------------------------------

-- Primary hot path: monthly cron scans by (tenant_id, ts) WHERE
-- aggregated_for_yyyymm IS NULL, then aggregates per model.
CREATE INDEX IF NOT EXISTS idx_tenant_usage_meter_tenant_ts
  ON {{SCHEMA}}.tenant_usage_meter(tenant_id, ts DESC);

-- Tier filter: cron skips free-tier tenants entirely; this partial
-- index speeds the common "subscription-tier tenants with un-billed
-- rows" lookup.
CREATE INDEX IF NOT EXISTS idx_tenant_usage_meter_unaggregated
  ON {{SCHEMA}}.tenant_usage_meter(tenant_id, ts)
  WHERE aggregated_for_yyyymm IS NULL;

-- Per-model breakdown is exposed in dashboard analytics; an index on
-- model alone is cheap and lets the dashboard render the per-tenant
-- "tokens by model" widget without a full scan.
CREATE INDEX IF NOT EXISTS idx_tenant_usage_meter_model
  ON {{SCHEMA}}.tenant_usage_meter(model);

-- Aggregation-bucket index: lets `aggregateMonth(tenantId, yyyymm)`
-- find already-aggregated rows in O(log n) to enforce idempotency.
CREATE INDEX IF NOT EXISTS idx_tenant_usage_meter_aggregated
  ON {{SCHEMA}}.tenant_usage_meter(tenant_id, aggregated_for_yyyymm)
  WHERE aggregated_for_yyyymm IS NOT NULL;

COMMENT ON TABLE {{SCHEMA}}.tenant_usage_meter IS
  '@caia/billing Phase C3 — per-tenant Claude token meter. Writer: '
  '@chiefaia/claude-spawner post-spawn hook via recordUsage(). Reader: '
  'apps/dashboard/scripts/aggregate-usage.ts monthly cron. BYOK tenants '
  'are excluded at the writer via @caia/secrets-adapter.hasRuntimeKey().';

-- ------------------------------------------------------------
-- {{SCHEMA}}.tenant_usage_meter_aggregates — one row per (tenant, month)
-- ------------------------------------------------------------
-- Monthly aggregate the cron actually posts to Stripe. The row's
-- presence is the idempotency guard: re-running `aggregateMonth` for
-- a (tenant, yyyymm) that already has a row is a no-op.
CREATE TABLE IF NOT EXISTS {{SCHEMA}}.tenant_usage_meter_aggregates (
  tenant_id                UUID         NOT NULL,
  yyyymm                   INTEGER      NOT NULL CHECK (yyyymm BETWEEN 200001 AND 299912),
  total_input_tokens       BIGINT       NOT NULL DEFAULT 0,
  total_output_tokens      BIGINT       NOT NULL DEFAULT 0,
  total_cache_creation_tokens BIGINT    NOT NULL DEFAULT 0,
  total_cache_read_tokens  BIGINT       NOT NULL DEFAULT 0,
  row_count                BIGINT       NOT NULL DEFAULT 0,
  stripe_usage_record_id   TEXT,
  stripe_post_status       TEXT         NOT NULL DEFAULT 'pending'
                            CHECK (stripe_post_status IN ('pending','posted','stubbed','failed')),
  posted_at                TIMESTAMPTZ,
  created_at               TIMESTAMPTZ  NOT NULL DEFAULT now(),
  PRIMARY KEY (tenant_id, yyyymm)
);

CREATE INDEX IF NOT EXISTS idx_tenant_usage_aggregates_status
  ON {{SCHEMA}}.tenant_usage_meter_aggregates(stripe_post_status, yyyymm);

COMMENT ON TABLE {{SCHEMA}}.tenant_usage_meter_aggregates IS
  '@caia/billing Phase C3 — monthly aggregate per (tenant, yyyymm). '
  'Row presence is the idempotency guard for postStripeUsageRecord. '
  'stripe_post_status=stubbed when STRIPE_SECRET_KEY was absent at post time.';
