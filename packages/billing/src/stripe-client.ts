/**
 * `stripe-client.ts` — thin factory wrapping the Stripe SDK.
 *
 * Why a factory and not a singleton?
 *   1. The secret key lives in Infisical, not env vars in apps/dashboard
 *      (operator policy). Callers fetch it via `@caia/secrets-adapter`
 *      and pass it in.
 *   2. Tests inject a `StripeLike` mock without monkey-patching globals.
 */

import Stripe from 'stripe';

import { BillingConfigError } from './types.js';

export const STRIPE_API_VERSION = '2024-11-20.acacia' as const;

/**
 * Minimal Stripe surface area this package consumes. Defined as an
 * interface so tests can mock it without `vi.mock('stripe', ...)`.
 *
 * Mirrors `Stripe` shape but only the methods we actually call.
 */
export interface StripeLike {
  checkout: {
    sessions: {
      create(
        params: Stripe.Checkout.SessionCreateParams,
      ): Promise<Stripe.Checkout.Session>;
    };
  };
  billingPortal: {
    sessions: {
      create(
        params: Stripe.BillingPortal.SessionCreateParams,
      ): Promise<Stripe.BillingPortal.Session>;
    };
  };
  subscriptions: {
    retrieve(id: string): Promise<Stripe.Subscription>;
    update(
      id: string,
      params: Stripe.SubscriptionUpdateParams,
    ): Promise<Stripe.Subscription>;
    cancel(id: string): Promise<Stripe.Subscription>;
  };
  prices: {
    list(params: Stripe.PriceListParams): Promise<Stripe.ApiList<Stripe.Price>>;
  };
  webhooks: {
    constructEvent(
      payload: string | Buffer,
      header: string,
      secret: string,
    ): Stripe.Event;
  };
}

export interface StripeClientConfig {
  /** Stripe live or test secret key. MUST be fetched from Infisical. */
  apiKey: string;
  /** Optional override — usually leave default. */
  apiVersion?: Stripe.LatestApiVersion;
  /** Optional `appInfo` so the operator can identify CAIA in Stripe dashboards. */
  appName?: string;
}

export function createStripeClient(config: StripeClientConfig): StripeLike {
  if (!config.apiKey || !config.apiKey.startsWith('sk_')) {
    throw new BillingConfigError(
      'createStripeClient: apiKey must be a Stripe secret key (sk_test_... or sk_live_...). ' +
        'Did you accidentally pass a publishable key (pk_...)?',
    );
  }

  const stripe = new Stripe(config.apiKey, {
    apiVersion: (config.apiVersion ?? STRIPE_API_VERSION) as Stripe.LatestApiVersion,
    appInfo: {
      name: config.appName ?? 'CAIA Billing',
      url: 'https://github.com/prakashgbid/caia',
    },
    // `typescript: true` is no-op at runtime; included for SDK typing.
    typescript: true,
  });

  // Cast through `unknown` — we narrowed the contract via StripeLike.
  return stripe as unknown as StripeLike;
}
