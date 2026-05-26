# @caia/billing

Two-layer billing for CAIA:

* **Layer 1 — CAIA SaaS subscriptions.** The tenant (operator's
  customer) pays CAIA monthly via Stripe. Tiers: `free` / `professional`
  (\$49/mo placeholder) / `team` (\$99/mo placeholder).
* **Layer 2 — BYOK runtime credits.** The tenant pastes their own
  Anthropic / OpenAI / etc. API keys, which CAIA stores in Infisical
  scoped to that tenant. The generated app fetches the key on demand at
  runtime. Every read is audit-logged in
  `caia_meta.audit_runtime_key_reads`.

Subscription-only constraint applies to the **CAIA BUILD phase** (when
CAIA's own agents call Anthropic to generate the customer's app —
those go through the operator's Max-account subscription via
`spend-guard`). Runtime — when the tenant's deployed app calls AI —
is BYOK.

## Architecture

```
┌──────────────────────────────────────────────────────────────┐
│ apps/dashboard                                              │
│ ├── /settings/billing       — tier picker (@caia/ui)         │
│ ├── /settings/runtime-keys  — BYOK paste UI (@caia/ui)       │
│ └── /api/billing/...        — thin route handlers            │
└──────────────────────────────────────────────────────────────┘
                │
                ▼
┌──────────────────────────────────────────────────────────────┐
│ @caia/billing                                                │
│ ├── SubscriptionService    — createCheckoutSession,          │
│ │                             createPortalSession,           │
│ │                             cancelSubscription             │
│ ├── WebhookHandler         — Stripe webhook → store + bus    │
│ ├── ByokService            — set/get/revoke runtime keys     │
│ └── BillingEvents          — emits to @chiefaia/events       │
└──────────────────────────────────────────────────────────────┘
       │                              │
       ▼                              ▼
┌────────────┐              ┌────────────────────────────┐
│ Stripe SDK │              │ @caia/secrets-adapter      │
└────────────┘              │ (Infisical at runtime,     │
                            │  in-memory in tests)       │
                            └────────────────────────────┘
```

## Public surface

```ts
import {
  // Layer 1
  SubscriptionService,
  WebhookHandler,
  TIER_TABLE,
  // Layer 2
  ByokService,
  RUNTIME_KEY_CATEGORY,
  runtimeKeyName,
  // Bus
  BillingEvents,
  EVENT_TENANT_SUBSCRIPTION_CHANGED,
  EVENT_TENANT_RUNTIME_KEY_SET,
  EVENT_TENANT_RUNTIME_KEY_READ,
  // Stores (swap in PG-backed impls)
  type SubscriptionStore,
  type RuntimeKeyAuditStore,
} from '@caia/billing';

// Next route handler factories — used by apps/dashboard/app/api/billing/*
import {
  checkoutRouteFactory,
  webhookRouteFactory,
  runtimeKeysRouteFactory,
} from '@caia/billing/api';
```

## Migrations

```sh
psql $DATABASE_URL -f packages/billing/migrations/0001_subscription_state.sql
psql $DATABASE_URL -f packages/billing/migrations/0002_runtime_key_audit.sql
```

Both migrations are idempotent (`IF NOT EXISTS`). They write to the
global `caia_meta` schema established by
`@caia/onboarding/0001_caia_meta_init.sql`.

## Day-1 operator setup (the part the agent CAN'T do)

The agent does **not** have Stripe API keys. On day 1, you (the
operator) must:

### 1. Create Stripe products + prices

In the Stripe dashboard (test mode first):

```
Product: CAIA Professional (monthly)
  Price: $49 USD recurring → lookup_key: caia_professional_monthly_v1
Product: CAIA Team (monthly)
  Price: $99 USD recurring → lookup_key: caia_team_monthly_v1
```

The handler keys subscriptions back to tiers via `lookup_key`, so the
strings above must match exactly. Override the placeholders in
`packages/billing/src/types.ts:TIER_TABLE` if your final pricing
differs.

### 2. Stash secrets in Infisical

In Infisical, under the global `caia_global` workspace:

| Path                                                              | Value                                |
| ----------------------------------------------------------------- | ------------------------------------ |
| `caia_global.billing.stripe_secret_key`                           | `sk_live_…` (live mode)              |
| `caia_global.billing.stripe_webhook_secret`                       | `whsec_…` (from Stripe → Webhooks)   |
| `caia_global.billing.stripe_price_ids.professional`               | `price_…` from step 1                |
| `caia_global.billing.stripe_price_ids.team`                       | `price_…` from step 1                |

**Never** put the secret key in `apps/dashboard`'s env vars in
production. The dashboard reads from Infisical at boot via
`@caia/secrets-adapter`.

### 3. Wire the Stripe webhook endpoint

In Stripe → Webhooks → Add endpoint:

```
URL:     https://<your-dashboard-host>/api/billing/webhook
Events:
  customer.subscription.created
  customer.subscription.updated
  customer.subscription.deleted
  invoice.payment_succeeded
  invoice.payment_failed
```

Copy the signing secret into Infisical as `stripe_webhook_secret`.

### 4. Run the migrations

```sh
psql $CAIA_META_DATABASE_URL \
  -f packages/billing/migrations/0001_subscription_state.sql \
  -f packages/billing/migrations/0002_runtime_key_audit.sql
```

### 5. Smoke test

```sh
# In dev (with STRIPE_SECRET_KEY=sk_test_… and STRIPE_PRICE_ID_PROFESSIONAL=price_…)
pnpm --filter @caia-app/dashboard dev
# Open http://localhost:7777/settings/billing
# Pick Professional → Stripe Checkout opens
# Use test card 4242 4242 4242 4242 → returns to dashboard
# Verify caia_meta.tenant_subscriptions has a row for your tenant
```

### 6. Production cutover

1. Disable the dev `STRIPE_SECRET_KEY` env var in the production env.
2. Confirm `lib/billing/runtime.ts:loadStripeSecret` is calling
   Infisical (the TODO in that file).
3. Flip Stripe to live mode and update the Infisical secret.

## Audit retention

`caia_meta.audit_runtime_key_reads` is **append-only**. Triggers on
the table block `UPDATE` and `DELETE`. To purge rows for GDPR
deletion, the operator runs:

```sql
-- ONLY as a service role; bypasses the no-mutate triggers via
-- ALTER TABLE ... DISABLE TRIGGER. Log the purge in
-- caia_meta.tenants.audit_purge_log first.
```

(Documented separately in `docs/audit-retention.md` — out of scope
for this PR.)

## Tests

```sh
pnpm --filter @caia/billing test
```

82 vitest cases covering subscription state machine, webhook
signature verification + all 5 event handlers, BYOK isolation per
tenant, audit logging, and the route factories.

## ADRs / references

- Gap analysis: A2 (P1) + W11 (P1)
- ADR-061 / ADR-065 — `@caia/ui` lock
- `research/multi_tenant_secrets_architecture_2026.md` §6
