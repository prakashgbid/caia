/**
 * Webhook handler tests — signature verification + all 5 handlers.
 */

import { describe, expect, it, vi } from 'vitest';

import {
  EVENT_TENANT_SUBSCRIPTION_CHANGED,
  WebhookHandler,
  WebhookSignatureError,
} from '../src/index.js';
import {
  buildInvoiceEvent,
  buildSubscriptionEvent,
  makeFakeStripe,
  makeWebhookHandler,
} from './_fixtures.js';
import {
  BillingEvents,
  InMemorySubscriptionStore,
} from '../src/index.js';
import { createEventBus } from '@chiefaia/events';

describe('WebhookHandler signature verification', () => {
  it('rejects when Stripe-Signature header is absent', async () => {
    const { handler } = makeWebhookHandler();
    await expect(
      handler.handle({ rawBody: '{}', signature: null }),
    ).rejects.toBeInstanceOf(WebhookSignatureError);
  });

  it('rejects when signature does not verify', async () => {
    const store = new InMemorySubscriptionStore();
    const { stripe } = makeFakeStripe({ rejectSignature: true });
    const events = new BillingEvents(createEventBus());
    const handler = new WebhookHandler({
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      stripe: stripe as any,
      store,
      events,
      webhookSecret: 'whsec_test',
    });
    await expect(
      handler.handle({ rawBody: '{}', signature: 'sig' }),
    ).rejects.toBeInstanceOf(WebhookSignatureError);
  });

  it('passes the configured secret to constructEvent', async () => {
    const { handler, calls } = makeWebhookHandler();
    const evt = buildSubscriptionEvent('customer.subscription.created');
    await handler.handle({ rawBody: JSON.stringify(evt), signature: 'sig' });
    expect(calls.constructEvent[0]?.secret).toBe('whsec_test_secret');
  });

  it('returns handled:false for unrecognised event types', async () => {
    const { handler } = makeWebhookHandler();
    const res = await handler.handle({
      rawBody: JSON.stringify({ id: 'evt_x', type: 'charge.captured', data: {} }),
      signature: 'sig',
    });
    expect(res).toEqual({
      eventId: 'evt_x',
      eventType: 'charge.captured',
      handled: false,
    });
  });
});

describe('customer.subscription.created handler', () => {
  it('upserts a new row and emits tenant.subscription.changed', async () => {
    const { handler, store, bus } = makeWebhookHandler();
    const seen: unknown[] = [];
    bus.on(EVENT_TENANT_SUBSCRIPTION_CHANGED, (p) => seen.push(p));

    const evt = buildSubscriptionEvent('customer.subscription.created', {
      tenantId: 't-new',
      subscriptionId: 'sub_new',
      customerId: 'cus_new',
      lookupKey: 'caia_team_monthly_v1',
    });
    const res = await handler.handle({
      rawBody: JSON.stringify(evt),
      signature: 'sig',
    });
    expect(res.handled).toBe(true);
    expect(res.tenantId).toBe('t-new');

    const written = await store.get('t-new');
    expect(written?.tier).toBe('team');
    expect(written?.stripeCustomerId).toBe('cus_new');
    expect(written?.stripeSubscriptionId).toBe('sub_new');
    expect(seen).toHaveLength(1);
    expect((seen[0] as { previous: unknown }).previous).toBeNull();
  });

  it('handler is idempotent on redelivery', async () => {
    const { handler, store } = makeWebhookHandler();
    const evt = buildSubscriptionEvent('customer.subscription.created', {
      tenantId: 't-idem',
      lookupKey: 'caia_professional_monthly_v1',
    });
    const body = JSON.stringify(evt);
    await handler.handle({ rawBody: body, signature: 'sig' });
    await handler.handle({ rawBody: body, signature: 'sig' });
    expect(store.size()).toBe(1);
    expect((await store.get('t-idem'))?.tier).toBe('professional');
  });

  it('skips when tenant_id metadata is absent', async () => {
    const { handler, store } = makeWebhookHandler();
    const evt = buildSubscriptionEvent('customer.subscription.created');
    (evt.data.object as { metadata: Record<string, string> }).metadata = {};
    const res = await handler.handle({
      rawBody: JSON.stringify(evt),
      signature: 'sig',
    });
    expect(res.handled).toBe(false);
    expect(store.size()).toBe(0);
  });

  it('falls back to professional when lookup_key unknown and no metadata.tier', async () => {
    const { handler, store } = makeWebhookHandler();
    const evt = buildSubscriptionEvent('customer.subscription.created', {
      tenantId: 't-fallback',
      lookupKey: 'mystery_key',
    });
    await handler.handle({ rawBody: JSON.stringify(evt), signature: 'sig' });
    expect((await store.get('t-fallback'))?.tier).toBe('professional');
  });

  it('honours metadata.tier override when lookup_key unknown', async () => {
    const { handler, store } = makeWebhookHandler();
    const evt = buildSubscriptionEvent('customer.subscription.created', {
      tenantId: 't-meta',
      lookupKey: 'experiment_x',
    });
    (evt.data.object as { metadata: Record<string, string> }).metadata.tier = 'team';
    await handler.handle({ rawBody: JSON.stringify(evt), signature: 'sig' });
    expect((await store.get('t-meta'))?.tier).toBe('team');
  });
});

describe('customer.subscription.updated handler', () => {
  it('writes status changes and emits previous→current', async () => {
    const { handler, store, bus } = makeWebhookHandler();
    await store.seed('t-upd', {
      tier: 'professional',
      status: 'active',
      stripeSubscriptionId: 'sub_u',
    });
    const seen: Array<{ previousStatus: string | null; currentStatus: string }> = [];
    bus.on(EVENT_TENANT_SUBSCRIPTION_CHANGED, (p) =>
      seen.push(p as { previousStatus: string | null; currentStatus: string }),
    );

    const evt = buildSubscriptionEvent('customer.subscription.updated', {
      tenantId: 't-upd',
      subscriptionId: 'sub_u',
      status: 'past_due',
      lookupKey: 'caia_professional_monthly_v1',
    });
    await handler.handle({ rawBody: JSON.stringify(evt), signature: 'sig' });

    expect((await store.get('t-upd'))?.status).toBe('past_due');
    expect(seen).toHaveLength(1);
    expect(seen[0]).toMatchObject({
      previousStatus: 'active',
      currentStatus: 'past_due',
    });
  });
});

describe('customer.subscription.deleted handler', () => {
  it('drops tier to free, sets status canceled, nulls subscription id', async () => {
    const { handler, store, bus } = makeWebhookHandler();
    await store.seed('t-del', {
      tier: 'team',
      status: 'active',
      stripeSubscriptionId: 'sub_d',
    });
    const seen: unknown[] = [];
    bus.on(EVENT_TENANT_SUBSCRIPTION_CHANGED, (p) => seen.push(p));

    const evt = buildSubscriptionEvent('customer.subscription.deleted', {
      tenantId: 't-del',
      subscriptionId: 'sub_d',
      status: 'canceled',
    });
    const res = await handler.handle({
      rawBody: JSON.stringify(evt),
      signature: 'sig',
    });
    expect(res.handled).toBe(true);
    const after = await store.get('t-del');
    expect(after?.tier).toBe('free');
    expect(after?.status).toBe('canceled');
    expect(after?.stripeSubscriptionId).toBeNull();
    expect(seen).toHaveLength(1);
  });

  it('returns handled:false when the subscription id is unknown', async () => {
    const { handler } = makeWebhookHandler();
    const evt = buildSubscriptionEvent('customer.subscription.deleted', {
      subscriptionId: 'sub_unknown',
    });
    const res = await handler.handle({
      rawBody: JSON.stringify(evt),
      signature: 'sig',
    });
    expect(res.handled).toBe(false);
  });
});

describe('invoice.payment_succeeded handler', () => {
  it('promotes past_due → active', async () => {
    const { handler, store, bus } = makeWebhookHandler();
    await store.seed('t-pay', {
      status: 'past_due',
      stripeSubscriptionId: 'sub_pay',
    });
    const seen: Array<{ currentStatus: string }> = [];
    bus.on(EVENT_TENANT_SUBSCRIPTION_CHANGED, (p) =>
      seen.push(p as { currentStatus: string }),
    );

    const evt = buildInvoiceEvent('invoice.payment_succeeded', {
      subscriptionId: 'sub_pay',
    });
    await handler.handle({ rawBody: JSON.stringify(evt), signature: 'sig' });
    expect((await store.get('t-pay'))?.status).toBe('active');
    expect(seen[0]?.currentStatus).toBe('active');
  });

  it('no-ops when subscription already active', async () => {
    const { handler, store, bus } = makeWebhookHandler();
    await store.seed('t-ok', {
      status: 'active',
      stripeSubscriptionId: 'sub_ok',
    });
    const seen: unknown[] = [];
    bus.on(EVENT_TENANT_SUBSCRIPTION_CHANGED, (p) => seen.push(p));
    const evt = buildInvoiceEvent('invoice.payment_succeeded', {
      subscriptionId: 'sub_ok',
    });
    await handler.handle({ rawBody: JSON.stringify(evt), signature: 'sig' });
    expect(seen).toHaveLength(0);
  });

  it('returns handled:false for invoices without a subscription id', async () => {
    const { handler } = makeWebhookHandler();
    const evt = buildInvoiceEvent('invoice.payment_succeeded');
    (evt.data.object as { subscription: unknown }).subscription = null;
    const res = await handler.handle({
      rawBody: JSON.stringify(evt),
      signature: 'sig',
    });
    expect(res.handled).toBe(false);
  });
});

describe('invoice.payment_failed handler', () => {
  it('flips active → past_due', async () => {
    const { handler, store } = makeWebhookHandler();
    await store.seed('t-fail', {
      status: 'active',
      stripeSubscriptionId: 'sub_fail',
    });
    const evt = buildInvoiceEvent('invoice.payment_failed', {
      subscriptionId: 'sub_fail',
    });
    await handler.handle({ rawBody: JSON.stringify(evt), signature: 'sig' });
    expect((await store.get('t-fail'))?.status).toBe('past_due');
  });

  it('does not re-flip an already-past_due subscription', async () => {
    const { handler, store, bus } = makeWebhookHandler();
    await store.seed('t-pd', {
      status: 'past_due',
      stripeSubscriptionId: 'sub_pd',
    });
    const seen: unknown[] = [];
    bus.on(EVENT_TENANT_SUBSCRIPTION_CHANGED, (p) => seen.push(p));
    const evt = buildInvoiceEvent('invoice.payment_failed', {
      subscriptionId: 'sub_pd',
    });
    await handler.handle({ rawBody: JSON.stringify(evt), signature: 'sig' });
    expect(seen).toHaveLength(0);
  });
});

describe('handler is robust to malformed payloads', () => {
  it('handles missing items.data by falling back to professional tier', async () => {
    const { handler, store } = makeWebhookHandler();
    const evt = buildSubscriptionEvent('customer.subscription.created', {
      tenantId: 't-mal',
    });
    (evt.data.object as { items: unknown }).items = { data: [] };
    const res = await handler.handle({
      rawBody: JSON.stringify(evt),
      signature: 'sig',
    });
    expect(res.handled).toBe(true);
    expect((await store.get('t-mal'))?.tier).toBe('professional');
  });
});

vi.useRealTimers();
