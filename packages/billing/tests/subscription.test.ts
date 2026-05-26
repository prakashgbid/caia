/**
 * Tests for Layer 1: SubscriptionService.
 *
 * Coverage:
 *   - tier definitions / table
 *   - price-id resolution + MissingPriceIdError
 *   - createCheckoutSession (new customer + existing customer)
 *   - createPortalSession + TenantNotFoundError
 *   - cancelSubscription (grace + immediate + free-tier no-op)
 *   - InMemorySubscriptionStore semantics
 *   - mapStripeStatus / lookupKeyToTier
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  InMemorySubscriptionStore,
  MissingPriceIdError,
  TIERS,
  TIER_TABLE,
  TenantNotFoundError,
  lookupKeyToTier,
  mapStripeStatus,
} from '../src/index.js';
import { makeSubscription } from './_fixtures.js';

describe('TIER_TABLE', () => {
  it('exposes free / professional / team', () => {
    expect(TIERS).toEqual(['free', 'professional', 'team']);
    for (const t of TIERS) {
      expect(TIER_TABLE[t].tier).toBe(t);
      expect(typeof TIER_TABLE[t].displayName).toBe('string');
      expect(TIER_TABLE[t].features.length).toBeGreaterThan(0);
    }
  });

  it('free tier is $0; paid tiers are positive', () => {
    expect(TIER_TABLE.free.priceUsdMonthly).toBe(0);
    expect(TIER_TABLE.professional.priceUsdMonthly).toBeGreaterThan(0);
    expect(TIER_TABLE.team.priceUsdMonthly).toBeGreaterThan(
      TIER_TABLE.professional.priceUsdMonthly,
    );
  });

  it('each tier has a unique stripeLookupKey', () => {
    const keys = TIERS.map((t) => TIER_TABLE[t].stripeLookupKey);
    expect(new Set(keys).size).toBe(keys.length);
  });
});

describe('SubscriptionService.resolvePriceId', () => {
  it('returns the configured price id', () => {
    const { service } = makeSubscription();
    expect(service.resolvePriceId('professional')).toBe('price_test_prof');
    expect(service.resolvePriceId('team')).toBe('price_test_team');
  });

  it('throws MissingPriceIdError when not configured', () => {
    const { service } = makeSubscription({ priceIds: {} });
    expect(() => service.resolvePriceId('professional')).toThrow(
      MissingPriceIdError,
    );
    expect(() => service.resolvePriceId('team')).toThrow(MissingPriceIdError);
  });
});

describe('SubscriptionService.createCheckoutSession', () => {
  it('returns sessionId + url and records the Stripe call', async () => {
    const { service, calls } = makeSubscription();
    const res = await service.createCheckoutSession({
      tenantId: 'tenant-1',
      tier: 'professional',
      customerEmail: 'a@b.com',
    });
    expect(res.sessionId).toBe('cs_test_fake_123');
    expect(res.url).toMatch(/^https:\/\/checkout\.stripe\.com/);
    expect(calls.checkoutSessions).toHaveLength(1);
  });

  it('passes customer_email when no existing Stripe customer', async () => {
    const { service, calls } = makeSubscription();
    await service.createCheckoutSession({
      tenantId: 'tenant-new',
      tier: 'team',
      customerEmail: 'new@test.com',
    });
    const params = calls.checkoutSessions[0] as Record<string, unknown>;
    expect(params.customer_email).toBe('new@test.com');
    expect(params.customer).toBeUndefined();
  });

  it('passes customer when tenant already has a Stripe customer id', async () => {
    const { service, store, calls } = makeSubscription();
    await store.seed('tenant-existing', { stripeCustomerId: 'cus_existing' });
    await service.createCheckoutSession({
      tenantId: 'tenant-existing',
      tier: 'professional',
      customerEmail: 'ignored@test.com',
    });
    const params = calls.checkoutSessions[0] as Record<string, unknown>;
    expect(params.customer).toBe('cus_existing');
    expect(params.customer_email).toBeUndefined();
  });

  it('writes tenant_id into both top-level metadata and subscription_data.metadata', async () => {
    const { service, calls } = makeSubscription();
    await service.createCheckoutSession({
      tenantId: 'tenant-meta',
      tier: 'professional',
      customerEmail: 'm@test.com',
    });
    const params = calls.checkoutSessions[0] as Record<string, unknown>;
    expect(params.metadata).toMatchObject({
      tenant_id: 'tenant-meta',
      tier: 'professional',
    });
    expect(
      (params.subscription_data as { metadata: Record<string, string> }).metadata,
    ).toMatchObject({ tenant_id: 'tenant-meta', tier: 'professional' });
  });

  it('honours explicit successUrl / cancelUrl overrides', async () => {
    const { service, calls } = makeSubscription();
    await service.createCheckoutSession({
      tenantId: 't',
      tier: 'professional',
      customerEmail: 'x@y.z',
      successUrl: 'https://x.com/ok',
      cancelUrl: 'https://x.com/no',
    });
    const params = calls.checkoutSessions[0] as Record<string, unknown>;
    expect(params.success_url).toBe('https://x.com/ok');
    expect(params.cancel_url).toBe('https://x.com/no');
  });
});

describe('SubscriptionService.createPortalSession', () => {
  it('throws TenantNotFoundError if the tenant row is missing', async () => {
    const { service } = makeSubscription();
    await expect(service.createPortalSession({ tenantId: 'nope' })).rejects.toBeInstanceOf(
      TenantNotFoundError,
    );
  });

  it('throws TenantNotFoundError if the tenant has no stripeCustomerId yet', async () => {
    const { service, store } = makeSubscription();
    await store.seed('tenant-free');
    await expect(service.createPortalSession({ tenantId: 'tenant-free' })).rejects.toBeInstanceOf(
      TenantNotFoundError,
    );
  });

  it('returns a portal url for a known customer', async () => {
    const { service, store } = makeSubscription();
    await store.seed('tenant-paid', { stripeCustomerId: 'cus_paid' });
    const res = await service.createPortalSession({ tenantId: 'tenant-paid' });
    expect(res.url).toMatch(/^https:\/\/billing\.stripe\.com/);
  });
});

describe('SubscriptionService.cancelSubscription', () => {
  it('no-ops for tenants without a stripeSubscriptionId', async () => {
    const { service, store, calls } = makeSubscription();
    await store.seed('tenant-free');
    await service.cancelSubscription('tenant-free');
    expect(calls.subscriptionsUpdate).toHaveLength(0);
    expect(calls.subscriptionsCancel).toHaveLength(0);
  });

  it('calls subscriptions.update(cancel_at_period_end:true) by default', async () => {
    const { service, store, calls } = makeSubscription();
    await store.seed('tenant-grace', { stripeSubscriptionId: 'sub_g' });
    await service.cancelSubscription('tenant-grace');
    expect(calls.subscriptionsUpdate).toHaveLength(1);
    expect(calls.subscriptionsUpdate[0]).toEqual({
      id: 'sub_g',
      params: { cancel_at_period_end: true },
    });
    expect(calls.subscriptionsCancel).toHaveLength(0);
  });

  it('calls subscriptions.cancel for immediate=true', async () => {
    const { service, store, calls } = makeSubscription();
    await store.seed('tenant-now', { stripeSubscriptionId: 'sub_n' });
    await service.cancelSubscription('tenant-now', { immediate: true });
    expect(calls.subscriptionsCancel).toEqual(['sub_n']);
    expect(calls.subscriptionsUpdate).toHaveLength(0);
  });

  it('throws TenantNotFoundError when tenant row is missing', async () => {
    const { service } = makeSubscription();
    await expect(service.cancelSubscription('absent')).rejects.toBeInstanceOf(
      TenantNotFoundError,
    );
  });
});

describe('InMemorySubscriptionStore', () => {
  it('seeds and reads back', async () => {
    const store = new InMemorySubscriptionStore();
    const sub = await store.seed('t1', { tier: 'team' });
    expect(sub.tier).toBe('team');
    const fetched = await store.get('t1');
    expect(fetched?.tier).toBe('team');
  });

  it('clones on upsert so external mutation does not leak', async () => {
    const store = new InMemorySubscriptionStore();
    const sub = await store.seed('t', { tier: 'professional' });
    sub.tier = 'free'; // mutate the local copy
    const fetched = await store.get('t');
    expect(fetched?.tier).toBe('professional');
  });

  it('looks up by stripe ids', async () => {
    const store = new InMemorySubscriptionStore();
    await store.seed('t1', {
      stripeCustomerId: 'cus_1',
      stripeSubscriptionId: 'sub_1',
    });
    expect((await store.getByStripeCustomerId('cus_1'))?.tenantId).toBe('t1');
    expect((await store.getByStripeSubscriptionId('sub_1'))?.tenantId).toBe('t1');
    expect(await store.getByStripeSubscriptionId('sub_missing')).toBeNull();
  });

  it('lists by status', async () => {
    const store = new InMemorySubscriptionStore();
    await store.seed('a', { status: 'active' });
    await store.seed('b', { status: 'past_due' });
    await store.seed('c', { status: 'active' });
    const active = await store.listByStatus('active');
    expect(active.map((s) => s.tenantId).sort()).toEqual(['a', 'c']);
  });
});

describe('mapStripeStatus / lookupKeyToTier', () => {
  it.each([
    ['active', 'active'],
    ['past_due', 'past_due'],
    ['canceled', 'canceled'],
    ['paused', 'paused'],
    ['unknown_label', 'incomplete'], // safe default
  ])('maps %s -> %s', (raw, expected) => {
    expect(mapStripeStatus(raw)).toBe(expected);
  });

  it('maps Stripe lookup keys to CAIA tiers', () => {
    expect(lookupKeyToTier('caia_free_v1')).toBe('free');
    expect(lookupKeyToTier('caia_professional_monthly_v1')).toBe('professional');
    expect(lookupKeyToTier('caia_team_monthly_v1')).toBe('team');
    expect(lookupKeyToTier('legacy_key')).toBeNull();
    expect(lookupKeyToTier(null)).toBeNull();
    expect(lookupKeyToTier(undefined)).toBeNull();
  });
});

beforeEach(() => {
  vi.useRealTimers();
});

afterEach(() => {
  vi.useRealTimers();
});
