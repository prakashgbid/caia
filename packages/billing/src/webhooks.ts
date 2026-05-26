/**
 * `webhooks.ts` — Stripe webhook signature verification + handlers for
 * the 5 events we care about:
 *   customer.subscription.created
 *   customer.subscription.updated
 *   customer.subscription.deleted
 *   invoice.payment_succeeded
 *   invoice.payment_failed
 *
 * Design:
 *   - Handlers are idempotent (Stripe redelivers).
 *   - Unknown event types are accepted with a `handled: false` result
 *     so the operator can register additional webhook event types in
 *     Stripe without code changes (we just won't react to them).
 */

import type Stripe from 'stripe';

import type { BillingEvents } from './events.js';
import type { StripeLike } from './stripe-client.js';
import type { SubscriptionStore } from './subscription-store.js';
import { lookupKeyToTier, mapStripeStatus } from './subscription-store.js';
import {
  HANDLED_STRIPE_EVENTS,
  WebhookSignatureError,
  type Tier,
  type TenantSubscription,
} from './types.js';

export interface WebhookHandlerConfig {
  stripe: StripeLike;
  store: SubscriptionStore;
  events: BillingEvents;
  /** Stripe webhook signing secret. Fetched from Infisical. */
  webhookSecret: string;
}

export interface HandleWebhookInput {
  /** Raw request body — must NOT be JSON.parsed before this call. */
  rawBody: string | Buffer;
  /** Value of the `Stripe-Signature` header. */
  signature: string | null | undefined;
}

export interface HandleWebhookResult {
  eventId: string;
  eventType: string;
  handled: boolean;
  /** Set if this event triggered a tenant subscription mutation. */
  tenantId?: string;
}

export class WebhookHandler {
  constructor(private readonly config: WebhookHandlerConfig) {}

  /**
   * Top-level handler called by the route. Verifies the signature, then
   * dispatches to the per-event method. Returns a result for the route
   * to JSON-serialise (Stripe just needs a 2xx).
   */
  async handle(input: HandleWebhookInput): Promise<HandleWebhookResult> {
    if (!input.signature) {
      throw new WebhookSignatureError(
        'Missing Stripe-Signature header on webhook delivery.',
      );
    }

    let event: Stripe.Event;
    try {
      event = this.config.stripe.webhooks.constructEvent(
        input.rawBody,
        input.signature,
        this.config.webhookSecret,
      );
    } catch (err) {
      throw new WebhookSignatureError(
        `Webhook signature verification failed: ${(err as Error).message}`,
      );
    }

    if (!(HANDLED_STRIPE_EVENTS as readonly string[]).includes(event.type)) {
      return { eventId: event.id, eventType: event.type, handled: false };
    }

    switch (event.type) {
      case 'customer.subscription.created':
      case 'customer.subscription.updated':
        return this.handleSubscriptionUpsert(event);
      case 'customer.subscription.deleted':
        return this.handleSubscriptionDeleted(event);
      case 'invoice.payment_succeeded':
        return this.handleInvoicePaymentSucceeded(event);
      case 'invoice.payment_failed':
        return this.handleInvoicePaymentFailed(event);
      default:
        // exhaustiveness guard — `HANDLED_STRIPE_EVENTS` was extended
        // without a matching case. Fall back to a no-op rather than
        // 500ing the webhook.
        return { eventId: event.id, eventType: event.type, handled: false };
    }
  }

  private async handleSubscriptionUpsert(
    event: Stripe.Event,
  ): Promise<HandleWebhookResult> {
    const sub = event.data.object as Stripe.Subscription;
    const tenantId = extractTenantId(sub);
    if (!tenantId) {
      // Stripe-created subscription without metadata — operator-side
      // experiment or migration artefact. Skip rather than corrupt
      // the store.
      return { eventId: event.id, eventType: event.type, handled: false };
    }

    const tier = deriveTierFromSubscription(sub);
    const previous = await this.config.store.get(tenantId);

    const current: TenantSubscription = {
      tenantId,
      tier,
      status: mapStripeStatus(sub.status),
      stripeCustomerId:
        typeof sub.customer === 'string' ? sub.customer : sub.customer.id,
      stripeSubscriptionId: sub.id,
      currentPeriodEnd: secondsToDate(sub.current_period_end),
      cancelAtPeriodEnd: sub.cancel_at_period_end,
      updatedAt: new Date(),
    };

    await this.config.store.upsert(current);
    await this.config.events.subscriptionChanged({
      tenantId,
      previous,
      current,
      previousTier: previous?.tier ?? null,
      currentTier: current.tier,
      previousStatus: previous?.status ?? null,
      currentStatus: current.status,
    });

    return {
      eventId: event.id,
      eventType: event.type,
      handled: true,
      tenantId,
    };
  }

  private async handleSubscriptionDeleted(
    event: Stripe.Event,
  ): Promise<HandleWebhookResult> {
    const sub = event.data.object as Stripe.Subscription;
    const existing = await this.config.store.getByStripeSubscriptionId(sub.id);
    if (!existing) {
      return { eventId: event.id, eventType: event.type, handled: false };
    }

    const previous = existing;
    const current: TenantSubscription = {
      ...existing,
      tier: 'free',
      status: 'canceled',
      stripeSubscriptionId: null,
      currentPeriodEnd: secondsToDate(sub.current_period_end),
      cancelAtPeriodEnd: false,
      updatedAt: new Date(),
    };

    await this.config.store.upsert(current);
    await this.config.events.subscriptionChanged({
      tenantId: existing.tenantId,
      previous,
      current,
      previousTier: previous.tier,
      currentTier: 'free',
      previousStatus: previous.status,
      currentStatus: 'canceled',
    });

    return {
      eventId: event.id,
      eventType: event.type,
      handled: true,
      tenantId: existing.tenantId,
    };
  }

  private async handleInvoicePaymentSucceeded(
    event: Stripe.Event,
  ): Promise<HandleWebhookResult> {
    const invoice = event.data.object as Stripe.Invoice;
    const subId = extractInvoiceSubscriptionId(invoice);
    if (!subId) {
      return { eventId: event.id, eventType: event.type, handled: false };
    }
    const existing = await this.config.store.getByStripeSubscriptionId(subId);
    if (!existing) {
      return { eventId: event.id, eventType: event.type, handled: false };
    }
    if (existing.status === 'past_due' || existing.status === 'unpaid') {
      const recovered: TenantSubscription = {
        ...existing,
        status: 'active',
        updatedAt: new Date(),
      };
      await this.config.store.upsert(recovered);
      await this.config.events.subscriptionChanged({
        tenantId: existing.tenantId,
        previous: existing,
        current: recovered,
        previousTier: existing.tier,
        currentTier: recovered.tier,
        previousStatus: existing.status,
        currentStatus: 'active',
      });
    }
    return {
      eventId: event.id,
      eventType: event.type,
      handled: true,
      tenantId: existing.tenantId,
    };
  }

  private async handleInvoicePaymentFailed(
    event: Stripe.Event,
  ): Promise<HandleWebhookResult> {
    const invoice = event.data.object as Stripe.Invoice;
    const subId = extractInvoiceSubscriptionId(invoice);
    if (!subId) {
      return { eventId: event.id, eventType: event.type, handled: false };
    }
    const existing = await this.config.store.getByStripeSubscriptionId(subId);
    if (!existing) {
      return { eventId: event.id, eventType: event.type, handled: false };
    }
    if (existing.status !== 'past_due') {
      const failed: TenantSubscription = {
        ...existing,
        status: 'past_due',
        updatedAt: new Date(),
      };
      await this.config.store.upsert(failed);
      await this.config.events.subscriptionChanged({
        tenantId: existing.tenantId,
        previous: existing,
        current: failed,
        previousTier: existing.tier,
        currentTier: failed.tier,
        previousStatus: existing.status,
        currentStatus: 'past_due',
      });
    }
    return {
      eventId: event.id,
      eventType: event.type,
      handled: true,
      tenantId: existing.tenantId,
    };
  }
}

// ---------- helpers ----------

function extractTenantId(sub: Stripe.Subscription): string | null {
  const fromSub = sub.metadata?.tenant_id;
  if (fromSub && typeof fromSub === 'string') return fromSub;
  // Created via Checkout — sometimes the metadata lands only on the
  // Checkout session, but Stripe copies it onto subscription_data
  // when we pass it via `subscription_data.metadata`. As a fallback
  // (and for older imports), we don't have a tenant id; the caller
  // treats `null` as "skip".
  return null;
}

function deriveTierFromSubscription(sub: Stripe.Subscription): Tier {
  const items = sub.items?.data ?? [];
  for (const item of items) {
    const lk = item.price?.lookup_key ?? null;
    const tier = lookupKeyToTier(lk);
    if (tier) return tier;
  }
  // No lookup_key match → operator probably created a one-off price
  // for a friends-and-family deal. Treat as `professional` (mid-tier)
  // by default; the operator can override via Stripe metadata.
  const metaTier = sub.metadata?.tier;
  if (
    metaTier === 'free' ||
    metaTier === 'professional' ||
    metaTier === 'team'
  ) {
    return metaTier;
  }
  return 'professional';
}

function extractInvoiceSubscriptionId(invoice: Stripe.Invoice): string | null {
  // Stripe SDK typings have widened `Invoice.subscription` over the
  // years; we accept any shape that yields a string id.
  const raw = (invoice as unknown as { subscription?: unknown }).subscription;
  if (!raw) return null;
  if (typeof raw === 'string') return raw;
  if (
    typeof raw === 'object' &&
    raw !== null &&
    'id' in raw &&
    typeof (raw as { id?: unknown }).id === 'string'
  ) {
    return (raw as { id: string }).id;
  }
  return null;
}

function secondsToDate(secs: number | null | undefined): Date | null {
  if (typeof secs !== 'number' || !Number.isFinite(secs)) return null;
  return new Date(secs * 1000);
}
