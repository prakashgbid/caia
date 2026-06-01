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

---

## Phase C3 — per-tenant usage meter (2026-05-31)

The C3 work threads a per-tenant Claude usage meter through the
spawner → billing stack. Operators see two new artifacts:

1. **`migrations/0003_tenant_usage_meter.sql`** — adds
   `{{SCHEMA}}.tenant_usage_meter` (one row per spawn) and
   `{{SCHEMA}}.tenant_usage_meter_aggregates` (monthly aggregate
   posted to Stripe). Run alongside the other migrations.

2. **`apps/dashboard/scripts/aggregate-usage.ts`** — monthly cron.
   Schedule via:

   ```cron
   30 0 1 * *   node apps/dashboard/scripts/aggregate-usage.ts
   ```

### Stub mode vs live mode

The cron + meter are **stub-mode tolerant**: when `STRIPE_SECRET_KEY`
is unset (the default until operator drops a key in), the meter
still writes per-spawn rows and the cron still computes aggregates —
only the final `subscriptionItems.createUsageRecord` call to Stripe
becomes a no-op. The aggregate row's `stripe_post_status` column is
the boundary marker:

| `STRIPE_SECRET_KEY` | `SDK init` | `aggregate.stripe_post_status` |
| ------------------- | ---------- | ------------------------------ |
| unset               | n/a        | `stubbed`                      |
| set, invalid        | throws     | `stubbed` (init-failed)        |
| set, valid          | ok         | `posted` (or `failed` on API error) |

### Operator runbook — activating real Stripe

1. **Create a Stripe metered-billing product**
   - Stripe Dashboard → Products → Add product
   - Pricing model: **Recurring → Usage-based → Per unit**
   - Set the per-unit price to your "per 1000 tokens" rate (the
     meter posts raw token counts; the divide-by-1000 lives in
     Stripe's price config).
   - Note the resulting `price_xxx` id.

2. **Paste the secret into Infisical**
   - Project: `caia_global`
   - Path: `billing/stripe_secret_key`
   - Value: `sk_live_...` (or `sk_test_...` for staging)
   - The dashboard's boot path reads this on the next deploy via
     the existing `@caia/secrets-adapter` wiring.

3. **Wire each tenant's `subscription_item` id**
   - When a tenant upgrades to a metered tier, Stripe creates a
     `subscription_item` for the metered price.
   - Persist `(tenant_id, subscription_item_id)` to
     `{{SCHEMA}}.tenant_subscription_items` — the cron's resolver
     reads this table.
   - When the table doesn't exist OR a tenant has no row, the cron
     stubs that tenant's post (logs a warning, sets
     `stripe_post_status='stubbed'`).

4. **First live cron tick**
   - On the next 1st-of-the-month run, the cron will re-aggregate
     any `stripe_post_status='stubbed'` rows from earlier months
     and POST them now that the key is live. This automatic
     back-fill is why stub mode is safe to ship.

5. **Verify**
   ```sql
   SELECT yyyymm,
          stripe_post_status,
          stripe_usage_record_id,
          posted_at
     FROM caia_meta.tenant_usage_meter_aggregates
    ORDER BY yyyymm DESC, tenant_id
    LIMIT 20;
   ```
   You should see `posted` (with `mbur_*` ids) for tenants whose
   `subscription_item_id` you wired.

### BYOK tenants

Tenants who pasted their own Anthropic key into the BYOK runtime-
credits vault are detected automatically via
`@caia/secrets-adapter.list(tenantId, 'runtime_credits')` and the
spawner-side hook short-circuits them BEFORE the meter write. There
is no operator action required — when a tenant becomes BYOK their
rows simply stop being written. (Audited via the
`caia_meta.audit_runtime_key_reads` ledger.)

### Tests

```sh
pnpm --filter @caia/billing test            # 115 cases (+ 1 skipped real-key path)
pnpm --filter @chiefaia/claude-spawner test # 82 cases (+5 C3 hook cases)
```
