/**
 * Shared test fixtures — fake Stripe + fake secrets adapter + fake
 * webhook signing. Kept zero-dep so vitest doesn't have to pull in
 * the real Stripe SDK to run unit tests.
 */

import type {
  AccessContext,
  ByokProvider,
  SecretsAdapter,
  Tier,
} from '../src/index.js';
import {
  BillingEvents,
  ByokService,
  InMemoryRuntimeKeyAuditStore,
  InMemorySubscriptionStore,
  ShapeOnlyKeyValidator,
  SubscriptionService,
  WebhookHandler,
} from '../src/index.js';
import { createEventBus } from '@chiefaia/events';

// ---------- in-memory secrets adapter (mirrors dashboard runtime) ----------

export class FakeSecretsAdapter implements SecretsAdapter {
  private readonly rows = new Map<string, string>();
  private readonly meta = new Map<
    string,
    { key: string; category: string; secretRef: string; createdAt: Date }
  >();
  /** Records `get` calls so tests can assert the audit envelope was passed. */
  readonly getCalls: Array<{
    tenantId: string;
    category: string;
    key: string;
    callerContext: AccessContext;
  }> = [];

  private k(t: string, c: string, k: string) {
    return `${t}::${c}::${k}`;
  }

  async put(t: string, c: string, k: string, v: string) {
    const key = this.k(t, c, k);
    this.rows.set(key, v);
    this.meta.set(key, {
      key: k,
      category: c,
      secretRef: `fake://${key}`,
      createdAt: new Date(),
    });
    return { secretRef: `fake://${key}` };
  }

  async get(t: string, c: string, k: string, ctx: AccessContext) {
    this.getCalls.push({ tenantId: t, category: c, key: k, callerContext: ctx });
    const key = this.k(t, c, k);
    const v = this.rows.get(key);
    if (v === undefined) {
      const err = new Error('not found') as Error & { errorClass?: string };
      err.errorClass = 'not_found';
      throw err;
    }
    return v;
  }

  async list(t: string, c?: string) {
    const out: Array<{
      key: string;
      category: string;
      secretRef: string;
      createdAt: Date;
    }> = [];
    for (const [k, meta] of this.meta) {
      if (!k.startsWith(`${t}::`)) continue;
      if (c && meta.category !== c) continue;
      out.push(meta);
    }
    return out;
  }

  async delete(t: string, c: string, k: string) {
    const key = this.k(t, c, k);
    if (!this.rows.has(key)) {
      const err = new Error('not found') as Error & { errorClass?: string };
      err.errorClass = 'not_found';
      throw err;
    }
    this.rows.delete(key);
    this.meta.delete(key);
  }
}

export function makeAccessContext(
  overrides: Partial<AccessContext> = {},
): AccessContext {
  return {
    callerType: 'user',
    callerId: 'tester',
    reason: 'unit test',
    ...overrides,
  };
}

export function makeByok(adapter = new FakeSecretsAdapter()) {
  const bus = createEventBus();
  const events = new BillingEvents(bus);
  const auditStore = new InMemoryRuntimeKeyAuditStore();
  const byok = new ByokService({
    secrets: adapter,
    auditStore,
    events,
    validator: new ShapeOnlyKeyValidator(),
  });
  return { byok, adapter, auditStore, events, bus };
}

// ---------- fake Stripe ----------

export interface FakeStripeOptions {
  /** Throw on `webhooks.constructEvent` to simulate signature failure. */
  rejectSignature?: boolean;
}

export function makeFakeStripe(opts: FakeStripeOptions = {}) {
  const calls: {
    checkoutSessions: Array<unknown>;
    portalSessions: Array<unknown>;
    subscriptionsUpdate: Array<{ id: string; params: unknown }>;
    subscriptionsCancel: Array<string>;
    constructEvent: Array<{ payload: string | Buffer; header: string; secret: string }>;
  } = {
    checkoutSessions: [],
    portalSessions: [],
    subscriptionsUpdate: [],
    subscriptionsCancel: [],
    constructEvent: [],
  };

  const stripe = {
    checkout: {
      sessions: {
        async create(params: unknown) {
          calls.checkoutSessions.push(params);
          return {
            id: 'cs_test_fake_123',
            url: 'https://checkout.stripe.com/c/pay/cs_test_fake_123',
          };
        },
      },
    },
    billingPortal: {
      sessions: {
        async create(params: unknown) {
          calls.portalSessions.push(params);
          return { url: 'https://billing.stripe.com/p/session_test' };
        },
      },
    },
    subscriptions: {
      async retrieve(id: string) {
        return { id, status: 'active' };
      },
      async update(id: string, params: unknown) {
        calls.subscriptionsUpdate.push({ id, params });
        return { id, status: 'active', cancel_at_period_end: true };
      },
      async cancel(id: string) {
        calls.subscriptionsCancel.push(id);
        return { id, status: 'canceled' };
      },
    },
    prices: {
      async list() {
        return { data: [], has_more: false, object: 'list', url: '/v1/prices' };
      },
    },
    webhooks: {
      constructEvent(payload: string | Buffer, header: string, secret: string) {
        calls.constructEvent.push({ payload, header, secret });
        if (opts.rejectSignature) {
          throw new Error('No signatures found matching the expected signature');
        }
        return JSON.parse(typeof payload === 'string' ? payload : payload.toString());
      },
    },
  };

  return { stripe, calls };
}

// ---------- subscription harness ----------

export function makeSubscription(opts: {
  priceIds?: Partial<Record<Tier, string>>;
} = {}) {
  const store = new InMemorySubscriptionStore();
  const { stripe, calls } = makeFakeStripe();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const service = new SubscriptionService({
    stripe: stripe as any,
    store,
    priceIds: opts.priceIds ?? {
      professional: 'price_test_prof',
      team: 'price_test_team',
    },
    appBaseUrl: 'https://app.test.caia',
  });
  return { service, store, stripe, calls };
}

// ---------- webhook harness ----------

export function makeWebhookHandler() {
  const store = new InMemorySubscriptionStore();
  const bus = createEventBus();
  const events = new BillingEvents(bus);
  const { stripe, calls } = makeFakeStripe();
  const handler = new WebhookHandler({
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    stripe: stripe as any,
    store,
    events,
    webhookSecret: 'whsec_test_secret',
  });
  return { handler, store, bus, events, stripe, calls };
}

// ---------- stripe event builders ----------

export function buildSubscriptionEvent(
  type:
    | 'customer.subscription.created'
    | 'customer.subscription.updated'
    | 'customer.subscription.deleted',
  overrides: {
    tenantId?: string;
    subscriptionId?: string;
    customerId?: string;
    status?: string;
    lookupKey?: string;
    cancelAtPeriodEnd?: boolean;
    currentPeriodEnd?: number;
  } = {},
) {
  return {
    id: `evt_${Math.random().toString(36).slice(2)}`,
    type,
    data: {
      object: {
        id: overrides.subscriptionId ?? 'sub_test_1',
        status: overrides.status ?? 'active',
        customer: overrides.customerId ?? 'cus_test_1',
        cancel_at_period_end: overrides.cancelAtPeriodEnd ?? false,
        current_period_end:
          overrides.currentPeriodEnd ?? Math.floor(Date.now() / 1000) + 3600,
        metadata: { tenant_id: overrides.tenantId ?? 'tenant-1' },
        items: {
          data: [
            {
              price: {
                lookup_key: overrides.lookupKey ?? 'caia_professional_monthly_v1',
              },
            },
          ],
        },
      },
    },
  };
}

export function buildInvoiceEvent(
  type: 'invoice.payment_succeeded' | 'invoice.payment_failed',
  overrides: { subscriptionId?: string } = {},
) {
  return {
    id: `evt_inv_${Math.random().toString(36).slice(2)}`,
    type,
    data: {
      object: {
        id: `in_test_${Math.random().toString(36).slice(2)}`,
        subscription: overrides.subscriptionId ?? 'sub_test_1',
      },
    },
  };
}

export const PROVIDER_KEYS: Record<ByokProvider, string> = {
  anthropic: 'sk-ant-test-1234567890abcdefghij',
  openai: 'sk-test-1234567890abcdefghij',
  google: 'AIzaSyTEST_1234567890_abcdefghij',
  azure: 'azure-test-key-1234567890abcdefghij',
  'aws-bedrock': 'AKIAIOSFODNN7EXAMPLE_test_1234567890',
  mistral: 'mistral-test-key-1234567890abcdef',
  cohere: 'cohere-test-key-1234567890abcdef',
};
