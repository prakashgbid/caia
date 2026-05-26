-- ============================================================
-- @caia/billing — 0001_subscription_state.sql
--
-- Per-tenant Stripe subscription state. Lives in the global
-- `caia_meta` schema next to `caia_meta.tenants` (created by
-- @caia/onboarding/0001_caia_meta_init.sql) — tenants must exist
-- before they get a subscription row.
--
-- Run idempotently — every CREATE uses IF NOT EXISTS.
-- ============================================================

CREATE SCHEMA IF NOT EXISTS caia_meta;

-- ------------------------------------------------------------
-- caia_meta.tenant_subscriptions — one row per tenant
-- ------------------------------------------------------------
-- Tier is the operator-facing CAIA plan (free / professional / team).
-- Stripe ids are nullable because:
--   1. Free-tier tenants never hit Checkout.
--   2. We may seed a `free` row at tenant-creation time before any
--      Stripe interaction.
-- A `canceled` subscription has its stripe_subscription_id NULLED on
-- the `customer.subscription.deleted` webhook so a fresh checkout
-- doesn't try to reuse a dead Stripe object.
CREATE TABLE IF NOT EXISTS caia_meta.tenant_subscriptions (
  tenant_id                UUID         PRIMARY KEY
                            REFERENCES caia_meta.tenants(id) ON DELETE CASCADE,
  tier                     TEXT         NOT NULL DEFAULT 'free'
                            CHECK (tier IN ('free','professional','team')),
  status                   TEXT         NOT NULL DEFAULT 'active'
                            CHECK (status IN (
                              'incomplete','incomplete_expired','trialing',
                              'active','past_due','canceled','unpaid','paused'
                            )),
  stripe_customer_id       TEXT         UNIQUE,
  stripe_subscription_id   TEXT         UNIQUE,
  current_period_end       TIMESTAMPTZ,
  cancel_at_period_end     BOOLEAN      NOT NULL DEFAULT false,
  created_at               TIMESTAMPTZ  NOT NULL DEFAULT now(),
  updated_at               TIMESTAMPTZ  NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_tenant_subs_status
  ON caia_meta.tenant_subscriptions(status);

CREATE INDEX IF NOT EXISTS idx_tenant_subs_tier
  ON caia_meta.tenant_subscriptions(tier);

CREATE INDEX IF NOT EXISTS idx_tenant_subs_stripe_customer
  ON caia_meta.tenant_subscriptions(stripe_customer_id)
  WHERE stripe_customer_id IS NOT NULL;

-- Auto-bump `updated_at` on any UPDATE so the webhook handler doesn't
-- have to remember it.
CREATE OR REPLACE FUNCTION caia_meta.tenant_subscriptions_touch_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_tenant_subscriptions_touch_updated_at
  ON caia_meta.tenant_subscriptions;

CREATE TRIGGER trg_tenant_subscriptions_touch_updated_at
  BEFORE UPDATE ON caia_meta.tenant_subscriptions
  FOR EACH ROW EXECUTE FUNCTION caia_meta.tenant_subscriptions_touch_updated_at();

COMMENT ON TABLE caia_meta.tenant_subscriptions IS
  '@caia/billing Layer 1 — Stripe subscription state for the CAIA SaaS itself. '
  'Webhook handler (packages/billing/src/webhooks.ts) is the canonical writer.';
