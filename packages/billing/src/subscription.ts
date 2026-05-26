/**
 * `subscription.ts` — Layer 1: CAIA SaaS subscription billing.
 *
 * Public surface:
 *   - `TIER_TABLE` / `TIERS`      — exposed for UI consumers
 *   - `SubscriptionService`       — `createCheckoutSession`,
 *                                   `createPortalSession`,
 *                                   `cancelSubscription`,
 *                                   `resolvePriceId`
 */

import type { StripeLike } from './stripe-client.js';
import type { SubscriptionStore } from './subscription-store.js';
import {
  MissingPriceIdError,
  TenantNotFoundError,
  TIER_TABLE,
  type Tier,
} from './types.js';

export interface SubscriptionServiceConfig {
  stripe: StripeLike;
  store: SubscriptionStore;
  priceIds: Readonly<Partial<Record<Tier, string>>>;
  appBaseUrl: string;
}

export interface CreateCheckoutSessionParams {
  tenantId: string;
  tier: Exclude<Tier, 'free'>;
  customerEmail: string;
  successUrl?: string;
  cancelUrl?: string;
}

export interface CreateCheckoutSessionResult {
  sessionId: string;
  url: string;
}

export interface CreatePortalSessionParams {
  tenantId: string;
  returnUrl?: string;
}

export interface CreatePortalSessionResult {
  url: string;
}

export class SubscriptionService {
  constructor(private readonly config: SubscriptionServiceConfig) {}

  resolvePriceId(tier: Exclude<Tier, 'free'>): string {
    const priceId = this.config.priceIds[tier];
    if (!priceId) throw new MissingPriceIdError(tier);
    return priceId;
  }

  async createCheckoutSession(
    params: CreateCheckoutSessionParams,
  ): Promise<CreateCheckoutSessionResult> {
    const priceId = this.resolvePriceId(params.tier);

    const existing = await this.config.store.get(params.tenantId);
    const customerArgs: { customer?: string; customer_email?: string } =
      existing?.stripeCustomerId
        ? { customer: existing.stripeCustomerId }
        : { customer_email: params.customerEmail };

    const successUrl =
      params.successUrl ??
      `${this.config.appBaseUrl}/settings/billing?status=success&session_id={CHECKOUT_SESSION_ID}`;
    const cancelUrl =
      params.cancelUrl ??
      `${this.config.appBaseUrl}/settings/billing?status=cancelled`;

    const session = await this.config.stripe.checkout.sessions.create({
      mode: 'subscription',
      line_items: [{ price: priceId, quantity: 1 }],
      ...customerArgs,
      client_reference_id: params.tenantId,
      metadata: { tenant_id: params.tenantId, tier: params.tier },
      subscription_data: {
        metadata: { tenant_id: params.tenantId, tier: params.tier },
      },
      success_url: successUrl,
      cancel_url: cancelUrl,
      allow_promotion_codes: true,
    });

    if (!session.url) {
      throw new Error(
        `Stripe checkout session ${session.id} returned no url. ` +
          `This should never happen for mode=subscription.`,
      );
    }

    return { sessionId: session.id, url: session.url };
  }

  async createPortalSession(
    params: CreatePortalSessionParams,
  ): Promise<CreatePortalSessionResult> {
    const sub = await this.config.store.get(params.tenantId);
    if (!sub) throw new TenantNotFoundError(params.tenantId);
    if (!sub.stripeCustomerId) {
      // Free tier never went through Checkout — the portal would 404.
      throw new TenantNotFoundError(params.tenantId);
    }

    const returnUrl =
      params.returnUrl ?? `${this.config.appBaseUrl}/settings/billing`;
    const portal = await this.config.stripe.billingPortal.sessions.create({
      customer: sub.stripeCustomerId,
      return_url: returnUrl,
    });
    return { url: portal.url };
  }

  /**
   * Cancel a tenant's subscription at period end (default) or
   * immediately. We DO NOT mutate the local store — the webhook
   * (`.updated` for grace cancel, `.deleted` for immediate) writes the
   * canonical state.
   */
  async cancelSubscription(
    tenantId: string,
    opts: { immediate?: boolean } = {},
  ): Promise<void> {
    const sub = await this.config.store.get(tenantId);
    if (!sub) throw new TenantNotFoundError(tenantId);
    if (!sub.stripeSubscriptionId) return; // free-tier, no-op

    if (opts.immediate) {
      await this.config.stripe.subscriptions.cancel(sub.stripeSubscriptionId);
    } else {
      await this.config.stripe.subscriptions.update(sub.stripeSubscriptionId, {
        cancel_at_period_end: true,
      });
    }
  }
}

export { TIER_TABLE, TIERS } from './types.js';
