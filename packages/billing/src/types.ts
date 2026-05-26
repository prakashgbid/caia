/**
 * @caia/billing — shared types for both layers.
 *
 * Layer 1 — subscription billing for the CAIA SaaS itself (tenant pays
 * CAIA monthly via Stripe).
 * Layer 2 — BYOK runtime credits (tenant pastes their own Anthropic /
 * OpenAI / etc. API keys to power their generated app's AI features).
 *
 * Gap analysis: A2 (P1) + W11 (P1).
 */

import { z } from 'zod';

// ---------- Tier definitions ----------

export const TIERS = ['free', 'professional', 'team'] as const;
export const TierSchema = z.enum(TIERS);
export type Tier = z.infer<typeof TierSchema>;

/**
 * Tier table. Prices are PLACEHOLDERS — operator must paste the real
 * Stripe price IDs into Infisical via the `setTierPriceId` admin
 * surface before the Checkout flow can resolve them. Until then, calls
 * to `createCheckoutSession({ tier: 'professional' | 'team' })` will
 * throw `MissingPriceIdError`.
 */
export interface TierDefinition {
  readonly tier: Tier;
  readonly displayName: string;
  readonly priceUsdMonthly: number; // placeholder pricing
  readonly stripeLookupKey: string; // matches Stripe price `lookup_key`
  readonly features: readonly string[];
}

export const TIER_TABLE: Readonly<Record<Tier, TierDefinition>> = {
  free: {
    tier: 'free',
    displayName: 'Free',
    priceUsdMonthly: 0,
    stripeLookupKey: 'caia_free_v1',
    features: [
      '1 project',
      'Community support',
      'Subscription-only AI during BUILD',
    ],
  },
  professional: {
    tier: 'professional',
    displayName: 'Professional',
    priceUsdMonthly: 49,
    stripeLookupKey: 'caia_professional_monthly_v1',
    features: [
      '10 projects',
      'Email support',
      'Higher build throughput',
      'BYOK runtime credits',
    ],
  },
  team: {
    tier: 'team',
    displayName: 'Team',
    priceUsdMonthly: 99,
    stripeLookupKey: 'caia_team_monthly_v1',
    features: [
      'Unlimited projects',
      'Priority support',
      'SSO',
      'BYOK runtime credits',
      'Audit log export',
    ],
  },
};

// ---------- Subscription state ----------

export const SUBSCRIPTION_STATUSES = [
  'incomplete',
  'incomplete_expired',
  'trialing',
  'active',
  'past_due',
  'canceled',
  'unpaid',
  'paused',
] as const;

export const SubscriptionStatusSchema = z.enum(SUBSCRIPTION_STATUSES);
export type SubscriptionStatus = z.infer<typeof SubscriptionStatusSchema>;

export interface TenantSubscription {
  tenantId: string;
  tier: Tier;
  status: SubscriptionStatus;
  stripeCustomerId: string | null;
  stripeSubscriptionId: string | null;
  currentPeriodEnd: Date | null;
  cancelAtPeriodEnd: boolean;
  updatedAt: Date;
}

// ---------- BYOK ----------

export const BYOK_PROVIDERS = [
  'anthropic',
  'openai',
  'google',
  'azure',
  'aws-bedrock',
  'mistral',
  'cohere',
] as const;

export const ByokProviderSchema = z.enum(BYOK_PROVIDERS);
export type ByokProvider = z.infer<typeof ByokProviderSchema>;

/**
 * Infisical category + key naming convention for BYOK runtime credits.
 * See migrations/0002_runtime_key_audit.sql.
 */
export const RUNTIME_KEY_CATEGORY = 'runtime_credits';

export function runtimeKeyName(provider: ByokProvider): string {
  return `${provider}_api_key`;
}

// ---------- Webhook events handled ----------

export const HANDLED_STRIPE_EVENTS = [
  'customer.subscription.created',
  'customer.subscription.updated',
  'customer.subscription.deleted',
  'invoice.payment_succeeded',
  'invoice.payment_failed',
] as const;

export type HandledStripeEvent = (typeof HANDLED_STRIPE_EVENTS)[number];

// ---------- Errors ----------

export class BillingConfigError extends Error {
  override readonly name = 'BillingConfigError';
}

export class MissingPriceIdError extends BillingConfigError {
  constructor(public readonly tier: Tier) {
    super(
      `No Stripe price id mapped for tier "${tier}". Operator must paste the price id into Infisical at ` +
        `caia_global.billing.stripe_price_ids.${tier}.`,
    );
  }
}

export class WebhookSignatureError extends Error {
  override readonly name = 'WebhookSignatureError';
}

export class TenantNotFoundError extends Error {
  override readonly name = 'TenantNotFoundError';
  constructor(public readonly tenantId: string) {
    super(`Tenant "${tenantId}" not found in tenant_subscriptions.`);
  }
}

export class InvalidKeyError extends Error {
  override readonly name = 'InvalidKeyError';
  constructor(
    public readonly provider: ByokProvider,
    public readonly reason: string,
  ) {
    super(`Invalid ${provider} key: ${reason}`);
  }
}

export class RuntimeKeyNotSetError extends Error {
  override readonly name = 'RuntimeKeyNotSetError';
  constructor(
    public readonly tenantId: string,
    public readonly provider: ByokProvider,
  ) {
    super(
      `Tenant "${tenantId}" has not set a runtime key for provider "${provider}".`,
    );
  }
}

// ---------- Audit log entry ----------

export interface RuntimeKeyReadAuditEntry {
  tenantId: string;
  provider: ByokProvider;
  callerType: 'agent' | 'user' | 'deploy-worker' | 'cron' | 'system';
  callerId: string;
  ticketId?: string;
  reason: string;
  ok: boolean;
  errorClass?:
    | 'not_found'
    | 'policy_denied'
    | 'rate_limited'
    | 'provider_error';
  readAt: Date;
}
