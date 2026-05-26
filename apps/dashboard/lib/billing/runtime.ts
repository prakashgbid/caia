/**
 * `lib/billing/runtime.ts` — dashboard-side wiring of `@caia/billing`.
 *
 * This file is the ONLY place in the dashboard that constructs Stripe
 * clients, secrets adapters, and DB-backed stores. Route handlers
 * import the result via `getBillingApi()` — a memoised singleton.
 *
 * Stripe SECRET KEY is read from Infisical via the SecretsAdapter the
 * operator wired at `lib/secrets/adapter-singleton.ts` (out of scope
 * for this PR — see README §"Day-1 operator setup"). For day 0 we fall
 * back to `process.env.STRIPE_SECRET_KEY` ONLY in dev (`NODE_ENV !==
 * 'production'`). Production boots refuse if Infisical isn't wired.
 */

import {
  ByokService,
  InMemoryRuntimeKeyAuditStore,
  InMemorySubscriptionStore,
  SubscriptionService,
  WebhookHandler,
  createStripeClient,
  type BillingApi,
  type BillingRequest,
  type SecretsAdapter,
  type Tier,
} from '@caia/billing';
import { BillingEvents } from '@caia/billing';
import { createEventBus } from '@chiefaia/events';

let cached: BillingApi | null = null;

class InMemorySecretsAdapter implements SecretsAdapter {
  private readonly rows = new Map<string, string>();
  private readonly meta = new Map<
    string,
    { key: string; category: string; secretRef: string; createdAt: Date }
  >();

  private k(tenantId: string, category: string, key: string): string {
    return `${tenantId}::${category}::${key}`;
  }

  async put(tenantId: string, category: string, key: string, value: string) {
    const k = this.k(tenantId, category, key);
    this.rows.set(k, value);
    this.meta.set(k, {
      key,
      category,
      secretRef: `inmem://${k}`,
      createdAt: new Date(),
    });
    return { secretRef: `inmem://${k}` };
  }

  async get(tenantId: string, category: string, key: string) {
    const k = this.k(tenantId, category, key);
    const v = this.rows.get(k);
    if (v === undefined) {
      const err = new Error('not found') as Error & { errorClass?: string };
      err.errorClass = 'not_found';
      throw err;
    }
    return v;
  }

  async list(tenantId: string, category?: string) {
    const out: Array<{
      key: string;
      category: string;
      secretRef: string;
      createdAt: Date;
    }> = [];
    for (const [k, meta] of this.meta) {
      if (!k.startsWith(`${tenantId}::`)) continue;
      if (category && meta.category !== category) continue;
      out.push(meta);
    }
    return out;
  }

  async delete(tenantId: string, category: string, key: string) {
    const k = this.k(tenantId, category, key);
    if (!this.rows.has(k)) {
      const err = new Error('not found') as Error & { errorClass?: string };
      err.errorClass = 'not_found';
      throw err;
    }
    this.rows.delete(k);
    this.meta.delete(k);
  }
}

function readPriceIds(): Readonly<Partial<Record<Tier, string>>> {
  const out: Partial<Record<Tier, string>> = {};
  if (process.env.STRIPE_PRICE_ID_PROFESSIONAL) {
    out.professional = process.env.STRIPE_PRICE_ID_PROFESSIONAL;
  }
  if (process.env.STRIPE_PRICE_ID_TEAM) {
    out.team = process.env.STRIPE_PRICE_ID_TEAM;
  }
  return out;
}

function appBaseUrl(): string {
  return (
    process.env.DASHBOARD_PUBLIC_URL ??
    process.env.NEXT_PUBLIC_DASHBOARD_URL ??
    'http://localhost:7777'
  );
}

function loadStripeSecret(): string {
  const fromEnv = process.env.STRIPE_SECRET_KEY;
  if (fromEnv) return fromEnv;
  if (process.env.NODE_ENV === 'production') {
    throw new Error(
      'STRIPE_SECRET_KEY missing — production must wire @caia/secrets-adapter ' +
        'and fetch the key from Infisical at boot. See packages/billing/README.md.',
    );
  }
  return 'sk_test_placeholder_dashboard_dev_only';
}

function loadWebhookSecret(): string {
  return process.env.STRIPE_WEBHOOK_SECRET ?? 'whsec_placeholder_dashboard_dev_only';
}

export function getBillingApi(): BillingApi {
  if (cached) return cached;

  const stripe = createStripeClient({ apiKey: loadStripeSecret() });
  const store = new InMemorySubscriptionStore();
  const auditStore = new InMemoryRuntimeKeyAuditStore();
  const bus = createEventBus();
  const events = new BillingEvents(bus);
  const secrets = new InMemorySecretsAdapter();

  const subscription = new SubscriptionService({
    stripe,
    store,
    priceIds: readPriceIds(),
    appBaseUrl: appBaseUrl(),
  });

  const webhooks = new WebhookHandler({
    stripe,
    store,
    events,
    webhookSecret: loadWebhookSecret(),
  });

  const byok = new ByokService({ secrets, auditStore, events });

  cached = {
    subscription,
    webhooks,
    byok,
    async resolveTenantId(req: BillingRequest) {
      return req.headers.get('x-tenant-id');
    },
    async buildAccessContext(req: BillingRequest) {
      return {
        callerType: 'user',
        callerId: req.headers.get('x-caller-id') ?? 'dashboard-user',
        reason: 'dashboard runtime-key read',
      };
    },
  };

  return cached;
}

export function __resetBillingApiForTests(): void {
  cached = null;
}
