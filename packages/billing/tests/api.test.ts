/**
 * Tests for the Next-agnostic route factories in `@caia/billing/api`.
 */

import { describe, expect, it } from 'vitest';

import {
  BillingEvents,
  ByokService,
  InMemoryRuntimeKeyAuditStore,
  InMemorySubscriptionStore,
  ShapeOnlyKeyValidator,
  SubscriptionService,
  WebhookHandler,
  checkoutRouteFactory,
  runtimeKeysRouteFactory,
  webhookRouteFactory,
  type BillingApi,
  type BillingRequest,
} from '../src/index.js';
import {
  FakeSecretsAdapter,
  PROVIDER_KEYS,
  buildSubscriptionEvent,
  makeAccessContext,
  makeFakeStripe,
} from './_fixtures.js';
import { createEventBus } from '@chiefaia/events';

function makeReq(body: unknown, init: { method?: string; tenantId?: string } = {}): BillingRequest {
  const headers = new Map<string, string>();
  if (init.tenantId) headers.set('x-tenant-id', init.tenantId);
  return {
    method: init.method ?? 'POST',
    url: 'http://test/api/billing',
    headers: {
      get: (n: string) => headers.get(n.toLowerCase()) ?? null,
    },
    json: async () => body,
    text: async () => (typeof body === 'string' ? body : JSON.stringify(body)),
  };
}

function makeApi(): BillingApi {
  const store = new InMemorySubscriptionStore();
  const auditStore = new InMemoryRuntimeKeyAuditStore();
  const bus = createEventBus();
  const events = new BillingEvents(bus);
  const { stripe } = makeFakeStripe();
  const adapter = new FakeSecretsAdapter();

  return {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    subscription: new SubscriptionService({
      stripe: stripe as any,
      store,
      priceIds: { professional: 'price_p', team: 'price_t' },
      appBaseUrl: 'https://app.test',
    }),
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    webhooks: new WebhookHandler({
      stripe: stripe as any,
      store,
      events,
      webhookSecret: 'whsec',
    }),
    byok: new ByokService({
      secrets: adapter,
      auditStore,
      events,
      validator: new ShapeOnlyKeyValidator(),
    }),
    async resolveTenantId(req) {
      return req.headers.get('x-tenant-id');
    },
    async buildAccessContext() {
      return makeAccessContext();
    },
  };
}

describe('checkoutRouteFactory', () => {
  it('returns 401 without x-tenant-id', async () => {
    const route = checkoutRouteFactory(makeApi());
    const res = await route(makeReq({ tier: 'professional', customerEmail: 'a@b.c' }));
    expect(res.status).toBe(401);
  });

  it('returns 405 for non-POST methods', async () => {
    const route = checkoutRouteFactory(makeApi());
    const res = await route(makeReq({}, { method: 'GET', tenantId: 't1' }));
    expect(res.status).toBe(405);
  });

  it('returns 400 when body is missing tier', async () => {
    const route = checkoutRouteFactory(makeApi());
    const res = await route(makeReq({ customerEmail: 'a@b.c' }, { tenantId: 't1' }));
    expect(res.status).toBe(400);
    expect(JSON.parse(res.body).error).toBe('invalid_tier');
  });

  it('returns 400 when tier is free', async () => {
    const route = checkoutRouteFactory(makeApi());
    const res = await route(
      makeReq({ tier: 'free', customerEmail: 'a@b.c' }, { tenantId: 't1' }),
    );
    expect(res.status).toBe(400);
    expect(JSON.parse(res.body).error).toBe('cannot_checkout_free_tier');
  });

  it('returns 400 when email is missing @', async () => {
    const route = checkoutRouteFactory(makeApi());
    const res = await route(
      makeReq({ tier: 'professional', customerEmail: 'not-an-email' }, { tenantId: 't1' }),
    );
    expect(res.status).toBe(400);
  });

  it('returns 200 + session url on happy path', async () => {
    const route = checkoutRouteFactory(makeApi());
    const res = await route(
      makeReq({ tier: 'professional', customerEmail: 'a@b.c' }, { tenantId: 't1' }),
    );
    expect(res.status).toBe(200);
    const data = JSON.parse(res.body);
    expect(data.sessionId).toBeTruthy();
    expect(data.url).toMatch(/^https:\/\//);
  });
});

describe('webhookRouteFactory', () => {
  it('returns 400 when Stripe-Signature missing', async () => {
    const route = webhookRouteFactory(makeApi());
    const res = await route(makeReq({ type: 'noop' }));
    expect(res.status).toBe(400);
    expect(JSON.parse(res.body).error).toBe('invalid_signature');
  });

  it('returns 200 + handled:true for valid subscription.created', async () => {
    const api = makeApi();
    const evt = buildSubscriptionEvent('customer.subscription.created', {
      tenantId: 't-route',
    });
    const route = webhookRouteFactory(api);
    const headers = new Map([['stripe-signature', 'sig']]);
    const req: BillingRequest = {
      method: 'POST',
      url: 'x',
      headers: { get: (n) => headers.get(n.toLowerCase()) ?? null },
      json: async () => evt,
      text: async () => JSON.stringify(evt),
    };
    const res = await route(req);
    expect(res.status).toBe(200);
    expect(JSON.parse(res.body).handled).toBe(true);
  });
});

describe('runtimeKeysRouteFactory', () => {
  it('PUT returns 400 for invalid provider', async () => {
    const route = runtimeKeysRouteFactory(makeApi());
    const res = await route.PUT(
      makeReq({ key: PROVIDER_KEYS.anthropic }, { tenantId: 't1' }),
      { params: { provider: 'no-such' } },
    );
    expect(res.status).toBe(400);
  });

  it('PUT returns 401 without tenant', async () => {
    const route = runtimeKeysRouteFactory(makeApi());
    const res = await route.PUT(makeReq({ key: PROVIDER_KEYS.anthropic }), {
      params: { provider: 'anthropic' },
    });
    expect(res.status).toBe(401);
  });

  it('PUT returns 400 when key missing', async () => {
    const route = runtimeKeysRouteFactory(makeApi());
    const res = await route.PUT(makeReq({}, { tenantId: 't1' }), {
      params: { provider: 'anthropic' },
    });
    expect(res.status).toBe(400);
    expect(JSON.parse(res.body).error).toBe('missing_key');
  });

  it('PUT returns 400 with detail when key fails shape validation', async () => {
    const route = runtimeKeysRouteFactory(makeApi());
    const res = await route.PUT(makeReq({ key: 'sk-bad' }, { tenantId: 't1' }), {
      params: { provider: 'anthropic' },
    });
    expect(res.status).toBe(400);
    const body = JSON.parse(res.body);
    expect(body.error).toBe('invalid_key');
    expect(typeof body.detail).toBe('string');
  });

  it('PUT then GET reports configured:true', async () => {
    const api = makeApi();
    const route = runtimeKeysRouteFactory(api);
    await route.PUT(makeReq({ key: PROVIDER_KEYS.anthropic }, { tenantId: 't1' }), {
      params: { provider: 'anthropic' },
    });
    const getRes = await route.GET(makeReq({}, { tenantId: 't1', method: 'GET' }), {
      params: { provider: 'anthropic' },
    });
    expect(getRes.status).toBe(200);
    expect(JSON.parse(getRes.body)).toEqual({ configured: true });
  });

  it('GET before PUT reports configured:false', async () => {
    const route = runtimeKeysRouteFactory(makeApi());
    const res = await route.GET(makeReq({}, { tenantId: 't1', method: 'GET' }), {
      params: { provider: 'openai' },
    });
    expect(JSON.parse(res.body)).toEqual({ configured: false });
  });

  it('DELETE then GET reports configured:false', async () => {
    const api = makeApi();
    const route = runtimeKeysRouteFactory(api);
    await route.PUT(makeReq({ key: PROVIDER_KEYS.anthropic }, { tenantId: 't1' }), {
      params: { provider: 'anthropic' },
    });
    const delRes = await route.DELETE(
      makeReq({}, { tenantId: 't1', method: 'DELETE' }),
      { params: { provider: 'anthropic' } },
    );
    expect(delRes.status).toBe(200);
    const getRes = await route.GET(makeReq({}, { tenantId: 't1', method: 'GET' }), {
      params: { provider: 'anthropic' },
    });
    expect(JSON.parse(getRes.body)).toEqual({ configured: false });
  });

  it('GET endpoint NEVER returns the key value (security property)', async () => {
    const api = makeApi();
    const route = runtimeKeysRouteFactory(api);
    await route.PUT(makeReq({ key: PROVIDER_KEYS.anthropic }, { tenantId: 't1' }), {
      params: { provider: 'anthropic' },
    });
    const getRes = await route.GET(makeReq({}, { tenantId: 't1', method: 'GET' }), {
      params: { provider: 'anthropic' },
    });
    expect(getRes.body).not.toContain(PROVIDER_KEYS.anthropic);
    expect(getRes.body).not.toMatch(/sk-ant-/);
  });
});
