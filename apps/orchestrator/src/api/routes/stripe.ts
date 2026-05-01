import type { Hono } from 'hono';
import { eq } from 'drizzle-orm';
import type { Db } from '../../db/connection';
import { subscriptions } from '../../db/schema';

// Plan → Stripe price ID mapping (set via env vars for each environment)
const PRICE_IDS: Record<string, string | undefined> = {
  pro: process.env['STRIPE_PRICE_PRO'],
  enterprise: process.env['STRIPE_PRICE_ENTERPRISE'],
};

const STRIPE_SECRET_KEY = process.env['STRIPE_SECRET_KEY'] ?? '';
const STRIPE_WEBHOOK_SECRET = process.env['STRIPE_WEBHOOK_SECRET'] ?? '';

function requireStripeKey(): void {
  if (!STRIPE_SECRET_KEY) throw new Error('STRIPE_SECRET_KEY is not set');
}

function subId(): string {
  return `sub_${Date.now()}_${Math.random().toString(36).slice(2, 9)}`;
}

// Lazy Stripe client initializer — avoids crashing the server at boot when the
// key is absent (e.g. dev machines without billing configured).
let _stripe: import('stripe').Stripe | null = null;
function getStripe(): import('stripe').Stripe {
  if (_stripe) return _stripe;
  requireStripeKey();
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const Stripe = require('stripe');
  _stripe = new Stripe(STRIPE_SECRET_KEY, { apiVersion: '2025-01-27.acacia' });
  return _stripe!;
}

export interface WebhookEvent {
  type: string;
  data: { object: Record<string, unknown> };
}

/**
 * Processes a verified Stripe webhook event and applies DB side-effects.
 * `getStripePriceId` is injected to allow unit testing without a live Stripe client.
 */
export async function handleWebhookEvent(
  event: WebhookEvent,
  db: Db,
  now: string,
  getStripePriceId: (subscriptionId: string) => Promise<string>,
): Promise<void> {
  switch (event.type) {
    case 'checkout.session.completed': {
      const session = event.data.object as {
        mode?: string;
        metadata?: Record<string, string | undefined>;
        customer?: string | { id: string };
        subscription?: string | { id: string };
      };
      if (session.mode !== 'subscription') break;

      const email = (session.metadata?.['email'] ?? '').toLowerCase();
      const plan = session.metadata?.['plan'] ?? 'pro';
      const stripeCustomerId =
        typeof session.customer === 'string' ? session.customer : (session.customer as { id: string })?.id ?? '';
      const stripeSubscriptionId =
        typeof session.subscription === 'string'
          ? session.subscription
          : (session.subscription as { id: string })?.id ?? '';

      const stripePriceId = await getStripePriceId(stripeSubscriptionId);

      const existing = db
        .select()
        .from(subscriptions)
        .where(eq(subscriptions.email, email))
        .all()
        .find((r) => r.plan === plan && r.status === 'active');

      if (existing) {
        db.update(subscriptions)
          .set({ stripeCustomerId, stripeSubscriptionId, stripePriceId, updatedAt: now })
          .where(eq(subscriptions.id, existing.id))
          .run();
      } else {
        db.insert(subscriptions).values({
          id: subId(),
          email,
          plan,
          status: 'active',
          stripeCustomerId,
          stripeSubscriptionId,
          stripePriceId,
          createdAt: now,
          updatedAt: now,
          cancelledAt: null,
        }).run();
      }
      break;
    }

    case 'customer.subscription.updated': {
      const stripeSub = event.data.object as { id: string; status: string };
      const localStatus =
        stripeSub.status === 'active' ? 'active'
        : stripeSub.status === 'canceled' ? 'cancelled'
        : 'expired';

      const row = db
        .select()
        .from(subscriptions)
        .where(eq(subscriptions.stripeSubscriptionId, stripeSub.id))
        .all()[0];

      if (row) {
        const patch: Partial<typeof row> = { status: localStatus, updatedAt: now };
        if (localStatus === 'cancelled') patch.cancelledAt = now;
        db.update(subscriptions).set(patch).where(eq(subscriptions.id, row.id)).run();
      }
      break;
    }

    case 'customer.subscription.deleted': {
      const stripeSub = event.data.object as { id: string };
      const row = db
        .select()
        .from(subscriptions)
        .where(eq(subscriptions.stripeSubscriptionId, stripeSub.id))
        .all()[0];

      if (row && row.status !== 'cancelled') {
        db.update(subscriptions)
          .set({ status: 'cancelled', cancelledAt: now, updatedAt: now })
          .where(eq(subscriptions.id, row.id))
          .run();
      }
      break;
    }

    case 'invoice.payment_failed': {
      const invoice = event.data.object as { subscription?: string | { id: string } };
      const stripeSubId =
        typeof invoice.subscription === 'string'
          ? invoice.subscription
          : (invoice.subscription as { id: string })?.id ?? '';

      if (stripeSubId) {
        const row = db
          .select()
          .from(subscriptions)
          .where(eq(subscriptions.stripeSubscriptionId, stripeSubId))
          .all()[0];

        if (row) {
          db.update(subscriptions)
            .set({ status: 'expired', updatedAt: now })
            .where(eq(subscriptions.id, row.id))
            .run();
        }
      }
      break;
    }

    default:
      break;
  }
}

export function registerStripeRoutes(app: Hono, db: Db): void {
  // POST /stripe/checkout-session
  // Creates a Stripe Checkout Session for upgrading to a paid plan.
  // Body: { email, plan, successUrl, cancelUrl }
  app.post('/stripe/checkout-session', async (c) => {
    const body = await c.req.json<{
      email?: string;
      plan?: string;
      successUrl?: string;
      cancelUrl?: string;
    }>();

    if (!body.email || typeof body.email !== 'string' || !body.email.includes('@')) {
      return c.json({ error: 'valid email is required' }, 400);
    }
    if (!body.plan || !['pro', 'enterprise'].includes(body.plan)) {
      return c.json({ error: 'plan must be "pro" or "enterprise"' }, 400);
    }
    if (!body.successUrl || !body.cancelUrl) {
      return c.json({ error: 'successUrl and cancelUrl are required' }, 400);
    }

    const priceId = PRICE_IDS[body.plan];
    if (!priceId) {
      return c.json({ error: `STRIPE_PRICE_${body.plan.toUpperCase()} env var is not configured` }, 500);
    }

    const stripe = getStripe();
    const email = body.email.trim().toLowerCase();

    // Find or create the Stripe customer tied to this email
    const customers = await stripe.customers.list({ email, limit: 1 });
    let customerId: string;
    if (customers.data.length > 0) {
      customerId = customers.data[0]!.id;
    } else {
      const customer = await stripe.customers.create({ email });
      customerId = customer.id;
    }

    const session = await stripe.checkout.sessions.create({
      customer: customerId,
      mode: 'subscription',
      line_items: [{ price: priceId, quantity: 1 }],
      success_url: body.successUrl,
      cancel_url: body.cancelUrl,
      metadata: { email, plan: body.plan },
    });

    return c.json({ sessionId: session.id, url: session.url });
  });

  // POST /stripe/webhook
  // Receives Stripe webhook events and keeps the local subscriptions table in sync.
  // Stripe-Signature header is verified against STRIPE_WEBHOOK_SECRET.
  app.post('/stripe/webhook', async (c) => {
    if (!STRIPE_WEBHOOK_SECRET) {
      return c.json({ error: 'STRIPE_WEBHOOK_SECRET is not configured' }, 500);
    }

    const rawBody = await c.req.text();
    const sig = c.req.header('stripe-signature') ?? '';

    let event: import('stripe').Stripe.Event;
    try {
      const stripe = getStripe();
      event = stripe.webhooks.constructEvent(rawBody, sig, STRIPE_WEBHOOK_SECRET);
    } catch {
      return c.json({ error: 'webhook signature verification failed' }, 400);
    }

    const now = new Date().toISOString();
    await handleWebhookEvent(
      event as WebhookEvent,
      db,
      now,
      async (subId) => {
        const stripe = getStripe();
        const stripeSub = await stripe.subscriptions.retrieve(subId);
        return stripeSub.items.data[0]?.price.id ?? '';
      },
    );

    return c.json({ received: true });
  });

  // GET /stripe/subscription/:email — look up the active Stripe-linked subscription for an email
  app.get('/stripe/subscription/:email', (c) => {
    const email = c.req.param('email').toLowerCase();
    const rows = db.select().from(subscriptions).where(eq(subscriptions.email, email)).all();
    const active = rows.filter((r) => r.status === 'active' && r.stripeSubscriptionId);
    if (active.length === 0) return c.json({ subscription: null });
    return c.json({ subscription: active[0] });
  });
}
