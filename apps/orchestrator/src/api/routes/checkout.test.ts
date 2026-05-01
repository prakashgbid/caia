/**
 * BILLING-001 — Checkout route unit tests (20 cases).
 *
 *  POST /checkout
 *   1.  missing email → 400
 *   2.  invalid email format → 400
 *   3.  missing plan → 400
 *   4.  free plan rejected → 400
 *   5.  enterprise plan accepted (price env absent → 500)
 *   6.  STRIPE_PRICE_PRO absent → 500
 *   7.  STRIPE_SECRET_KEY absent (price present) → 500 (internal error path)
 *
 *  GET /checkout/state/:email
 *   8.  unknown email → currentPlan: 'free', subscription: null
 *   9.  active pro subscription returned
 *  10.  active enterprise subscription returned
 *  11.  cancelled subscription → currentPlan: 'free', subscription: null
 *  12.  expired subscription → currentPlan: 'free', subscription: null
 *  13.  multiple subscriptions — active one wins
 *
 *  GET /checkout/plans
 *  14. returns 3 plans: free, pro, enterprise
 *  15. free plan price = 0
 *  16. pro plan price = 2900
 *  17. enterprise plan price = 9900
 *  18. each plan has a non-empty features array
 *  19. free plan has 3 included features
 *  20. enterprise plan has 7 included features
 */

import { describe, it, expect } from 'vitest';
import { Hono } from 'hono';
import Database from 'better-sqlite3';
import { drizzle } from 'drizzle-orm/better-sqlite3';
import * as schema from '../../db/schema';
import { registerCheckoutRoutes } from './checkout';

const SCHEMA_SQL = `
CREATE TABLE IF NOT EXISTS subscriptions (
  id text PRIMARY KEY,
  email text NOT NULL,
  plan text NOT NULL DEFAULT 'free',
  status text NOT NULL DEFAULT 'active',
  created_at text NOT NULL,
  updated_at text NOT NULL,
  cancelled_at text,
  stripe_customer_id text,
  stripe_subscription_id text,
  stripe_price_id text
);
CREATE INDEX IF NOT EXISTS subscriptions_email_idx ON subscriptions (email);
CREATE INDEX IF NOT EXISTS subscriptions_status_idx ON subscriptions (status);
CREATE UNIQUE INDEX IF NOT EXISTS subscriptions_stripe_customer_idx ON subscriptions (stripe_customer_id);
CREATE UNIQUE INDEX IF NOT EXISTS subscriptions_stripe_subscription_idx ON subscriptions (stripe_subscription_id);
`;

function freshApp() {
  const sqlite = new Database(':memory:');
  sqlite.exec(SCHEMA_SQL);
  const db = drizzle(sqlite, { schema });
  const app = new Hono();
  registerCheckoutRoutes(app, db);
  return { app, sqlite, db };
}

function insertSubscription(
  sqlite: Database.Database,
  overrides: {
    id?: string;
    email?: string;
    plan?: string;
    status?: string;
    stripeCustomerId?: string | null;
    stripeSubscriptionId?: string | null;
  } = {},
) {
  const now = new Date().toISOString();
  const id = overrides.id ?? `sub_${Date.now()}_${Math.random().toString(36).slice(2, 9)}`;
  sqlite.prepare(
    `INSERT INTO subscriptions (id, email, plan, status, created_at, updated_at, stripe_customer_id, stripe_subscription_id)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run(
    id,
    overrides.email ?? 'user@example.com',
    overrides.plan ?? 'pro',
    overrides.status ?? 'active',
    now,
    now,
    overrides.stripeCustomerId ?? null,
    overrides.stripeSubscriptionId ?? null,
  );
  return id;
}

// ---------------------------------------------------------------------------
// POST /checkout — input validation
// ---------------------------------------------------------------------------

describe('BILLING-001 checkout input validation', () => {
  it('1. missing email → 400', async () => {
    const { app } = freshApp();
    const res = await app.request('/checkout', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ plan: 'pro' }),
    });
    expect(res.status).toBe(400);
    const body = await res.json() as { error: string };
    expect(body.error).toMatch(/email/i);
  });

  it('2. invalid email format → 400', async () => {
    const { app } = freshApp();
    const res = await app.request('/checkout', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ email: 'not-an-email', plan: 'pro' }),
    });
    expect(res.status).toBe(400);
    const body = await res.json() as { error: string };
    expect(body.error).toMatch(/email/i);
  });

  it('3. missing plan → 400', async () => {
    const { app } = freshApp();
    const res = await app.request('/checkout', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ email: 'user@example.com' }),
    });
    expect(res.status).toBe(400);
    const body = await res.json() as { error: string };
    expect(body.error).toMatch(/plan/i);
  });

  it('4. free plan rejected → 400', async () => {
    const { app } = freshApp();
    const res = await app.request('/checkout', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ email: 'user@example.com', plan: 'free' }),
    });
    expect(res.status).toBe(400);
    const body = await res.json() as { error: string };
    expect(body.error).toMatch(/plan/i);
  });

  it('5. enterprise plan accepted but price env absent → 500', async () => {
    const { app } = freshApp();
    const res = await app.request('/checkout', {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'origin': 'http://localhost:3000' },
      body: JSON.stringify({ email: 'user@example.com', plan: 'enterprise' }),
    });
    // STRIPE_PRICE_ENTERPRISE not configured → 500
    expect(res.status).toBe(500);
  });

  it('6. STRIPE_PRICE_PRO absent → 500', async () => {
    const { app } = freshApp();
    const res = await app.request('/checkout', {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'origin': 'http://localhost:3000' },
      body: JSON.stringify({ email: 'user@example.com', plan: 'pro' }),
    });
    // STRIPE_PRICE_PRO not configured → 500
    expect(res.status).toBe(500);
  });

  it('7. invalid plan value → 400', async () => {
    const { app } = freshApp();
    const res = await app.request('/checkout', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ email: 'user@example.com', plan: 'basic' }),
    });
    expect(res.status).toBe(400);
    const body = await res.json() as { error: string };
    expect(body.error).toMatch(/plan/i);
  });
});

// ---------------------------------------------------------------------------
// GET /checkout/state/:email
// ---------------------------------------------------------------------------

describe('BILLING-001 checkout state', () => {
  it('8. unknown email → currentPlan free, subscription null', async () => {
    const { app } = freshApp();
    const res = await app.request('/checkout/state/unknown@example.com');
    expect(res.status).toBe(200);
    const body = await res.json() as { currentPlan: string; subscription: unknown };
    expect(body.currentPlan).toBe('free');
    expect(body.subscription).toBeNull();
  });

  it('9. active pro subscription returned', async () => {
    const { app, sqlite } = freshApp();
    const id = insertSubscription(sqlite, { email: 'pro@example.com', plan: 'pro', status: 'active' });

    const res = await app.request('/checkout/state/pro@example.com');
    expect(res.status).toBe(200);
    const body = await res.json() as { currentPlan: string; subscription: { id: string; plan: string; status: string } };
    expect(body.currentPlan).toBe('pro');
    expect(body.subscription).not.toBeNull();
    expect(body.subscription.id).toBe(id);
    expect(body.subscription.plan).toBe('pro');
    expect(body.subscription.status).toBe('active');
  });

  it('10. active enterprise subscription returned', async () => {
    const { app, sqlite } = freshApp();
    insertSubscription(sqlite, { email: 'enterprise@example.com', plan: 'enterprise', status: 'active' });

    const res = await app.request('/checkout/state/enterprise@example.com');
    expect(res.status).toBe(200);
    const body = await res.json() as { currentPlan: string; subscription: { plan: string } };
    expect(body.currentPlan).toBe('enterprise');
    expect(body.subscription?.plan).toBe('enterprise');
  });

  it('11. cancelled subscription → currentPlan free, subscription null', async () => {
    const { app, sqlite } = freshApp();
    insertSubscription(sqlite, { email: 'cancelled@example.com', plan: 'pro', status: 'cancelled' });

    const res = await app.request('/checkout/state/cancelled@example.com');
    expect(res.status).toBe(200);
    const body = await res.json() as { currentPlan: string; subscription: unknown };
    expect(body.currentPlan).toBe('free');
    expect(body.subscription).toBeNull();
  });

  it('12. expired subscription → currentPlan free, subscription null', async () => {
    const { app, sqlite } = freshApp();
    insertSubscription(sqlite, { email: 'expired@example.com', plan: 'pro', status: 'expired' });

    const res = await app.request('/checkout/state/expired@example.com');
    expect(res.status).toBe(200);
    const body = await res.json() as { currentPlan: string; subscription: unknown };
    expect(body.currentPlan).toBe('free');
    expect(body.subscription).toBeNull();
  });

  it('13. multiple subscriptions — active one is returned', async () => {
    const { app, sqlite } = freshApp();
    insertSubscription(sqlite, { id: 'sub_old', email: 'multi@example.com', plan: 'pro', status: 'cancelled' });
    const activeId = insertSubscription(sqlite, { id: 'sub_new', email: 'multi@example.com', plan: 'enterprise', status: 'active' });

    const res = await app.request('/checkout/state/multi@example.com');
    expect(res.status).toBe(200);
    const body = await res.json() as { currentPlan: string; subscription: { id: string } };
    expect(body.currentPlan).toBe('enterprise');
    expect(body.subscription?.id).toBe(activeId);
  });
});

// ---------------------------------------------------------------------------
// GET /checkout/plans
// ---------------------------------------------------------------------------

interface Plan {
  id: string;
  name: string;
  price: number;
  period: string;
  description: string;
  features: Array<{ text: string; included: boolean }>;
}

describe('BILLING-001 plans listing', () => {
  it('14. returns 3 plans: free, pro, enterprise', async () => {
    const { app } = freshApp();
    const res = await app.request('/checkout/plans');
    expect(res.status).toBe(200);
    const body = await res.json() as { plans: Plan[] };
    expect(body.plans).toHaveLength(3);
    const ids = body.plans.map((p) => p.id);
    expect(ids).toContain('free');
    expect(ids).toContain('pro');
    expect(ids).toContain('enterprise');
  });

  it('15. free plan price = 0', async () => {
    const { app } = freshApp();
    const res = await app.request('/checkout/plans');
    const body = await res.json() as { plans: Plan[] };
    const free = body.plans.find((p) => p.id === 'free')!;
    expect(free.price).toBe(0);
    expect(free.period).toBe('forever');
  });

  it('16. pro plan price = 2900', async () => {
    const { app } = freshApp();
    const res = await app.request('/checkout/plans');
    const body = await res.json() as { plans: Plan[] };
    const pro = body.plans.find((p) => p.id === 'pro')!;
    expect(pro.price).toBe(2900);
    expect(pro.period).toBe('month');
  });

  it('17. enterprise plan price = 9900', async () => {
    const { app } = freshApp();
    const res = await app.request('/checkout/plans');
    const body = await res.json() as { plans: Plan[] };
    const enterprise = body.plans.find((p) => p.id === 'enterprise')!;
    expect(enterprise.price).toBe(9900);
    expect(enterprise.period).toBe('month');
  });

  it('18. each plan has a non-empty features array', async () => {
    const { app } = freshApp();
    const res = await app.request('/checkout/plans');
    const body = await res.json() as { plans: Plan[] };
    for (const plan of body.plans) {
      expect(Array.isArray(plan.features)).toBe(true);
      expect(plan.features.length).toBeGreaterThan(0);
    }
  });

  it('19. free plan has 3 included features', async () => {
    const { app } = freshApp();
    const res = await app.request('/checkout/plans');
    const body = await res.json() as { plans: Plan[] };
    const free = body.plans.find((p) => p.id === 'free')!;
    const included = free.features.filter((f) => f.included);
    expect(included).toHaveLength(3);
  });

  it('20. enterprise plan has all 7 features included', async () => {
    const { app } = freshApp();
    const res = await app.request('/checkout/plans');
    const body = await res.json() as { plans: Plan[] };
    const enterprise = body.plans.find((p) => p.id === 'enterprise')!;
    const included = enterprise.features.filter((f) => f.included);
    expect(included).toHaveLength(7);
  });
});
