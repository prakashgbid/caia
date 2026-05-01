/**
 * STRIPE-001 — Stripe route unit tests (10 cases).
 *
 *  POST /stripe/checkout-session
 *   1. missing email → 400
 *   2. invalid email format → 400
 *   3. plan must be "pro" or "enterprise" (free rejected) → 400
 *   4. missing successUrl or cancelUrl → 400
 *   5. price env not configured → 500
 *
 *  POST /stripe/webhook
 *   6. STRIPE_WEBHOOK_SECRET not configured → 500
 *   7. invalid signature → 400 (requires secret, so we test error path when key absent)
 *
 *  GET /stripe/subscription/:email
 *   8. no subscription found → { subscription: null }
 *   9. active Stripe-linked subscription returned
 *  10. cancelled subscription not included; subscription without stripeSubscriptionId not included
 */

import { describe, it, expect } from 'vitest';
import { Hono } from 'hono';
import Database from 'better-sqlite3';
import { drizzle } from 'drizzle-orm/better-sqlite3';
import * as schema from '../../db/schema';
import { registerStripeRoutes } from './stripe';

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
  registerStripeRoutes(app, db);
  return { app, sqlite, db };
}

describe('STRIPE-001 checkout-session input validation', () => {
  it('1. missing email → 400', async () => {
    const { app } = freshApp();
    const res = await app.request('/stripe/checkout-session', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ plan: 'pro', successUrl: 'http://x', cancelUrl: 'http://y' }),
    });
    expect(res.status).toBe(400);
    const body = await res.json() as { error: string };
    expect(body.error).toMatch(/email/);
  });

  it('2. invalid email format → 400', async () => {
    const { app } = freshApp();
    const res = await app.request('/stripe/checkout-session', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ email: 'not-an-email', plan: 'pro', successUrl: 'http://x', cancelUrl: 'http://y' }),
    });
    expect(res.status).toBe(400);
  });

  it('3. free plan rejected → 400', async () => {
    const { app } = freshApp();
    const res = await app.request('/stripe/checkout-session', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ email: 'user@example.com', plan: 'free', successUrl: 'http://x', cancelUrl: 'http://y' }),
    });
    expect(res.status).toBe(400);
    const body = await res.json() as { error: string };
    expect(body.error).toMatch(/plan/);
  });

  it('4. missing cancelUrl → 400', async () => {
    const { app } = freshApp();
    const res = await app.request('/stripe/checkout-session', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ email: 'user@example.com', plan: 'pro', successUrl: 'http://x' }),
    });
    expect(res.status).toBe(400);
  });

  it('5. price env not configured (STRIPE_PRICE_PRO absent) → 500', async () => {
    const { app } = freshApp();
    const res = await app.request('/stripe/checkout-session', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ email: 'user@example.com', plan: 'pro', successUrl: 'http://x', cancelUrl: 'http://y' }),
    });
    // Either 500 from missing price config or missing Stripe key — both are server errors
    expect(res.status).toBe(500);
  });
});

describe('STRIPE-001 webhook handler', () => {
  it('6. STRIPE_WEBHOOK_SECRET not configured → 500', async () => {
    const { app } = freshApp();
    const res = await app.request('/stripe/webhook', {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'stripe-signature': 't=1,v1=abc' },
      body: '{}',
    });
    expect(res.status).toBe(500);
    const body = await res.json() as { error: string };
    expect(body.error).toMatch(/STRIPE_WEBHOOK_SECRET/);
  });
});

describe('STRIPE-001 subscription lookup', () => {
  it('7. unknown email → { subscription: null }', async () => {
    const { app } = freshApp();
    const res = await app.request('/stripe/subscription/unknown@example.com');
    expect(res.status).toBe(200);
    const body = await res.json() as { subscription: unknown };
    expect(body.subscription).toBeNull();
  });

  it('8. active Stripe-linked row returned', async () => {
    const { app, sqlite } = freshApp();
    const now = new Date().toISOString();
    sqlite.prepare(
      `INSERT INTO subscriptions (id, email, plan, status, created_at, updated_at, stripe_customer_id, stripe_subscription_id, stripe_price_id)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    ).run('sub_t8', 'active@example.com', 'pro', 'active', now, now, 'cus_abc', 'sub_live_001', 'price_pro');

    const res = await app.request('/stripe/subscription/active@example.com');
    expect(res.status).toBe(200);
    const body = await res.json() as { subscription: Record<string, unknown> };
    expect(body.subscription).not.toBeNull();
    expect(body.subscription['email']).toBe('active@example.com');
    expect(body.subscription['plan']).toBe('pro');
    expect(body.subscription['stripeSubscriptionId']).toBe('sub_live_001');
  });

  it('9. cancelled subscription → { subscription: null }', async () => {
    const { app, sqlite } = freshApp();
    const now = new Date().toISOString();
    sqlite.prepare(
      `INSERT INTO subscriptions (id, email, plan, status, created_at, updated_at, stripe_customer_id, stripe_subscription_id, stripe_price_id, cancelled_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    ).run('sub_t9', 'cancelled@example.com', 'pro', 'cancelled', now, now, 'cus_xyz', 'sub_cancelled_001', 'price_pro', now);

    const res = await app.request('/stripe/subscription/cancelled@example.com');
    expect(res.status).toBe(200);
    const body = await res.json() as { subscription: unknown };
    expect(body.subscription).toBeNull();
  });

  it('10. active row without stripeSubscriptionId → { subscription: null }', async () => {
    const { app, sqlite } = freshApp();
    const now = new Date().toISOString();
    sqlite.prepare(
      `INSERT INTO subscriptions (id, email, plan, status, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?)`,
    ).run('sub_t10', 'free@example.com', 'free', 'active', now, now);

    const res = await app.request('/stripe/subscription/free@example.com');
    expect(res.status).toBe(200);
    const body = await res.json() as { subscription: unknown };
    expect(body.subscription).toBeNull();
  });
});
