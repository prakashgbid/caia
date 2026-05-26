/**
 * `api.ts` — Next.js route handler factories.
 *
 * The dashboard's `app/api/billing/*` route files are thin — each
 * just calls into one of these factories with the boot-time
 * `BillingApi` instance. This keeps Next-specific code out of the
 * core package, and Stripe/secrets imports out of the dashboard.
 */

import type { ByokService } from './byok.js';
import type { SubscriptionService } from './subscription.js';
import type { WebhookHandler } from './webhooks.js';
import type { AccessContext } from './secrets-adapter.js';
import {
  ByokProviderSchema,
  InvalidKeyError,
  RuntimeKeyNotSetError,
  TenantNotFoundError,
  TierSchema,
  WebhookSignatureError,
  type ByokProvider,
} from './types.js';

export interface BillingRequest {
  method: string;
  url: string;
  headers: { get(name: string): string | null };
  json(): Promise<unknown>;
  text(): Promise<string>;
}

export interface BillingResponseInit {
  status: number;
  headers?: Record<string, string>;
  body: string;
}

export interface BillingApi {
  subscription: SubscriptionService;
  webhooks: WebhookHandler;
  byok: ByokService;
  resolveTenantId(req: BillingRequest): Promise<string | null>;
  buildAccessContext(req: BillingRequest): Promise<AccessContext>;
}

function json(body: unknown, status = 200): BillingResponseInit {
  return {
    status,
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  };
}

// ---------- Route factories ----------

/**
 * POST /api/billing/checkout — start a Stripe Checkout flow for the
 * authenticated tenant. Body: { tier, customerEmail, successUrl?, cancelUrl? }.
 */
export function checkoutRouteFactory(api: BillingApi) {
  return async function POST(req: BillingRequest): Promise<BillingResponseInit> {
    if (req.method !== 'POST') return json({ error: 'method_not_allowed' }, 405);

    const tenantId = await api.resolveTenantId(req);
    if (!tenantId) return json({ error: 'unauthenticated' }, 401);

    let body: unknown;
    try {
      body = await req.json();
    } catch {
      return json({ error: 'invalid_json' }, 400);
    }

    const parsed = parseCheckoutBody(body);
    if (!parsed.ok) return json({ error: parsed.error }, 400);

    try {
      const result = await api.subscription.createCheckoutSession({
        tenantId,
        tier: parsed.tier,
        customerEmail: parsed.customerEmail,
        ...(parsed.successUrl !== undefined ? { successUrl: parsed.successUrl } : {}),
        ...(parsed.cancelUrl !== undefined ? { cancelUrl: parsed.cancelUrl } : {}),
      });
      return json({ sessionId: result.sessionId, url: result.url }, 200);
    } catch (err) {
      if (err instanceof TenantNotFoundError) return json({ error: 'tenant_not_found' }, 404);
      return json({ error: 'checkout_failed', detail: (err as Error).message }, 500);
    }
  };
}

interface CheckoutBodyOk {
  ok: true;
  tier: Exclude<import('./types.js').Tier, 'free'>;
  customerEmail: string;
  successUrl?: string;
  cancelUrl?: string;
}
interface CheckoutBodyErr { ok: false; error: string }

function parseCheckoutBody(body: unknown): CheckoutBodyOk | CheckoutBodyErr {
  if (!body || typeof body !== 'object') return { ok: false, error: 'body_must_be_object' };
  const b = body as Record<string, unknown>;
  const tierParse = TierSchema.safeParse(b.tier);
  if (!tierParse.success) return { ok: false, error: 'invalid_tier' };
  if (tierParse.data === 'free') return { ok: false, error: 'cannot_checkout_free_tier' };
  const email = b.customerEmail;
  if (typeof email !== 'string' || !email.includes('@')) {
    return { ok: false, error: 'invalid_customer_email' };
  }
  const result: CheckoutBodyOk = { ok: true, tier: tierParse.data, customerEmail: email };
  if (typeof b.successUrl === 'string') result.successUrl = b.successUrl;
  if (typeof b.cancelUrl === 'string') result.cancelUrl = b.cancelUrl;
  return result;
}

/**
 * POST /api/billing/webhook — Stripe webhook receiver. Signature
 * verified inside the handler; raw body MUST be passed as text (not
 * JSON-parsed) so the HMAC matches.
 */
export function webhookRouteFactory(api: BillingApi) {
  return async function POST(req: BillingRequest): Promise<BillingResponseInit> {
    if (req.method !== 'POST') return json({ error: 'method_not_allowed' }, 405);
    const signature = req.headers.get('stripe-signature');
    let rawBody: string;
    try {
      rawBody = await req.text();
    } catch {
      return json({ error: 'invalid_body' }, 400);
    }
    try {
      const result = await api.webhooks.handle({ rawBody, signature });
      return json(result, 200);
    } catch (err) {
      if (err instanceof WebhookSignatureError) {
        return json({ error: 'invalid_signature', detail: err.message }, 400);
      }
      return json({ error: 'webhook_handler_failed', detail: (err as Error).message }, 500);
    }
  };
}

/**
 * Runtime-keys CRUD — one factory; the dashboard's
 * `/api/billing/runtime-keys/[provider]/route.ts` exports the
 * dispatched handlers (PUT/GET/DELETE).
 */
export function runtimeKeysRouteFactory(api: BillingApi) {
  function parseProvider(raw: string): ByokProvider | null {
    const parsed = ByokProviderSchema.safeParse(raw);
    return parsed.success ? parsed.data : null;
  }

  return {
    PUT: async (
      req: BillingRequest,
      ctx: { params: { provider: string } | Promise<{ provider: string }> },
    ): Promise<BillingResponseInit> => {
      const { provider: rawProvider } = await ctx.params;
      const provider = parseProvider(rawProvider);
      if (!provider) return json({ error: 'invalid_provider' }, 400);

      const tenantId = await api.resolveTenantId(req);
      if (!tenantId) return json({ error: 'unauthenticated' }, 401);

      let body: unknown;
      try {
        body = await req.json();
      } catch {
        return json({ error: 'invalid_json' }, 400);
      }
      const key = (body as { key?: unknown } | null)?.key;
      if (typeof key !== 'string') return json({ error: 'missing_key' }, 400);

      try {
        await api.byok.setRuntimeKey(tenantId, provider, key);
        return json({ ok: true }, 200);
      } catch (err) {
        if (err instanceof InvalidKeyError) {
          return json({ error: 'invalid_key', detail: err.reason }, 400);
        }
        return json(
          { error: 'set_runtime_key_failed', detail: (err as Error).message },
          500,
        );
      }
    },

    GET: async (
      req: BillingRequest,
      ctx: { params: { provider: string } | Promise<{ provider: string }> },
    ): Promise<BillingResponseInit> => {
      const { provider: rawProvider } = await ctx.params;
      const provider = parseProvider(rawProvider);
      if (!provider) return json({ error: 'invalid_provider' }, 400);

      const tenantId = await api.resolveTenantId(req);
      if (!tenantId) return json({ error: 'unauthenticated' }, 401);

      // The GET endpoint NEVER returns the key value. It returns only
      // whether the key is set, so the dashboard can render the "set"
      // checkmark without ever loading the secret into the browser.
      try {
        const configured = await api.byok.listConfiguredProviders(tenantId);
        return json({ configured: configured.includes(provider) }, 200);
      } catch (err) {
        return json(
          { error: 'list_failed', detail: (err as Error).message },
          500,
        );
      }
    },

    DELETE: async (
      req: BillingRequest,
      ctx: { params: { provider: string } | Promise<{ provider: string }> },
    ): Promise<BillingResponseInit> => {
      const { provider: rawProvider } = await ctx.params;
      const provider = parseProvider(rawProvider);
      if (!provider) return json({ error: 'invalid_provider' }, 400);

      const tenantId = await api.resolveTenantId(req);
      if (!tenantId) return json({ error: 'unauthenticated' }, 401);

      try {
        await api.byok.revokeRuntimeKey(tenantId, provider);
        return json({ ok: true }, 200);
      } catch (err) {
        return json(
          { error: 'revoke_failed', detail: (err as Error).message },
          500,
        );
      }
    },
  };
}

/**
 * Runtime-key READ — separate factory used by the orchestrator /
 * deploy-worker, not the dashboard. The dashboard's set/get/delete
 * endpoints never return the secret; THIS endpoint does, and is
 * guarded by capability tokens at the operator layer.
 */
export function runtimeKeyReadFactory(api: BillingApi) {
  return async function readKey(
    req: BillingRequest,
    ctx: { params: { provider: string } | Promise<{ provider: string }> },
  ): Promise<BillingResponseInit> {
    const { provider: rawProvider } = await ctx.params;
    const parsedProvider = ByokProviderSchema.safeParse(rawProvider);
    if (!parsedProvider.success) return json({ error: 'invalid_provider' }, 400);

    const tenantId = await api.resolveTenantId(req);
    if (!tenantId) return json({ error: 'unauthenticated' }, 401);

    const accessCtx = await api.buildAccessContext(req);

    try {
      const key = await api.byok.getRuntimeKey(tenantId, parsedProvider.data, accessCtx);
      return json({ key }, 200);
    } catch (err) {
      if (err instanceof RuntimeKeyNotSetError) {
        return json({ error: 'runtime_key_not_set' }, 404);
      }
      return json({ error: 'read_failed', detail: (err as Error).message }, 500);
    }
  };
}
