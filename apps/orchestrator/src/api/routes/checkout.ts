import type { Hono } from 'hono';
import { eq } from 'drizzle-orm';
import type { Db } from '../../db/connection';
import { subscriptions } from '../../db/schema';

export interface CheckoutInitRequest {
  email: string;
  plan: 'pro' | 'enterprise';
}

export interface CheckoutInitResponse {
  sessionId: string;
  url: string;
  plan: string;
  email: string;
}

export interface CheckoutStateResponse {
  email: string;
  currentPlan: 'free' | 'pro' | 'enterprise' | null;
  subscription: {
    id: string;
    plan: string;
    status: string;
    createdAt: string;
  } | null;
}

function validateEmail(email: string): boolean {
  return typeof email === 'string' && email.includes('@') && email.length > 0;
}

function validatePlan(plan: unknown): plan is 'pro' | 'enterprise' {
  return plan === 'pro' || plan === 'enterprise';
}

// Plan → Stripe price ID mapping (set via env vars for each environment)
const PRICE_IDS: Record<string, string | undefined> = {
  pro: process.env['STRIPE_PRICE_PRO'],
  enterprise: process.env['STRIPE_PRICE_ENTERPRISE'],
};

const STRIPE_SECRET_KEY = process.env['STRIPE_SECRET_KEY'] ?? '';

function requireStripeKey(): void {
  if (!STRIPE_SECRET_KEY) throw new Error('STRIPE_SECRET_KEY is not set');
}

let _stripe: import('stripe').Stripe | null = null;
function getStripe(): import('stripe').Stripe {
  if (_stripe) return _stripe;
  requireStripeKey();
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const Stripe = require('stripe');
  _stripe = new Stripe(STRIPE_SECRET_KEY, { apiVersion: '2025-01-27.acacia' });
  return _stripe!;
}

export function registerCheckoutRoutes(app: Hono, db: Db): void {
  // POST /checkout
  // Initiates a checkout session for the specified plan and email
  // Body: { email, plan }
  // Returns: { sessionId, url, plan, email }
  app.post('/checkout', async (c) => {
    const body = await c.req.json<CheckoutInitRequest>();

    if (!validateEmail(body.email)) {
      return c.json({ error: 'Valid email is required' }, 400);
    }

    if (!validatePlan(body.plan)) {
      return c.json({ error: 'Plan must be "pro" or "enterprise"' }, 400);
    }

    try {
      const origin = c.req.header('origin') || c.req.header('referer')?.split('/').slice(0, 3).join('/') || '';
      const successUrl = `${origin}/billing/success?plan=${body.plan}&email=${encodeURIComponent(body.email)}`;
      const cancelUrl = `${origin}/checkout?cancelled=1`;

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
        success_url: successUrl,
        cancel_url: cancelUrl,
        metadata: { email, plan: body.plan },
      });

      return c.json({
        sessionId: session.id,
        url: session.url,
        plan: body.plan,
        email: body.email,
      } as CheckoutInitResponse);
    } catch (err) {
      console.error('Checkout error:', err);
      return c.json({ error: 'Internal server error' }, 500);
    }
  });

  // GET /checkout/state/:email
  // Returns the current checkout state and subscription status for a given email
  app.get('/checkout/state/:email', (c) => {
    const email = c.req.param('email').toLowerCase();

    if (!validateEmail(email)) {
      return c.json({ error: 'Valid email is required' }, 400);
    }

    const rows = db.select().from(subscriptions).where(eq(subscriptions.email, email)).all();
    const active = rows.find((r) => r.status === 'active');

    const response: CheckoutStateResponse = {
      email,
      currentPlan: active ? (active.plan as 'pro' | 'enterprise') : 'free',
      subscription: active
        ? {
            id: active.id,
            plan: active.plan,
            status: active.status,
            createdAt: active.createdAt,
          }
        : null,
    };

    return c.json(response);
  });

  // GET /checkout/plans
  // Returns available checkout plans and their details
  app.get('/checkout/plans', (c) => {
    const plans = [
      {
        id: 'free',
        name: 'Free',
        price: 0,
        period: 'forever',
        description: 'For individuals exploring CAIA.',
        features: [
          { text: 'Up to 10 pipeline runs / month', included: true },
          { text: 'Community support', included: true },
          { text: '1 active project', included: true },
          { text: 'Priority queue', included: false },
          { text: 'Advanced analytics', included: false },
          { text: 'Custom agents', included: false },
          { text: 'SLA guarantee', included: false },
        ],
      },
      {
        id: 'pro',
        name: 'Pro',
        price: 2900,
        period: 'month',
        description: 'For teams shipping production AI pipelines.',
        features: [
          { text: 'Unlimited pipeline runs', included: true },
          { text: 'Priority email support', included: true },
          { text: 'Up to 10 active projects', included: true },
          { text: 'Priority queue', included: true },
          { text: 'Advanced analytics', included: true },
          { text: 'Custom agents', included: false },
          { text: 'SLA guarantee', included: false },
        ],
      },
      {
        id: 'enterprise',
        name: 'Enterprise',
        price: 9900,
        period: 'month',
        description: 'For organizations requiring full control.',
        features: [
          { text: 'Unlimited pipeline runs', included: true },
          { text: 'Dedicated support & SLA', included: true },
          { text: 'Unlimited active projects', included: true },
          { text: 'Priority queue', included: true },
          { text: 'Advanced analytics', included: true },
          { text: 'Custom agents', included: true },
          { text: 'SLA guarantee', included: true },
        ],
      },
    ];

    return c.json({ plans });
  });
}
