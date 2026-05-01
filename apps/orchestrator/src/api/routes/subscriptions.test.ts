/**
 * BILLING-001 — Subscriptions route unit tests (18 cases).
 *
 *  POST /subscribe
 *   1. missing email → 400
 *   2. invalid email (no @) → 400
 *   3. whitespace-only email → 400
 *   4. valid email, no plan → 201, defaults to free
 *   5. valid email, explicit pro plan → 201
 *   6. email normalised to lowercase → 201
 *   7. invalid plan string → 201, defaults to free
 *   8. idempotent: same email+plan active → 200 with existing row
 *   9. same email, different plan → 201 new row
 *
 *  GET /subscriptions
 *  10. no subscriptions → empty list
 *  11. lists all subscriptions
 *  12. filters by status
 *  13. filters by plan
 *  14. filters by email (case-insensitive)
 *
 *  GET /subscriptions/:id
 *  15. found → 200 with row
 *  16. not found → 404
 *
 *  DELETE /subscriptions/:id
 *  17. soft-cancel active → 200, status=cancelled, cancelledAt set
 *  18. already cancelled → 409
 *  19. not found → 404
 */

import { describe, it, expect } from 'vitest';
import { Hono } from 'hono';
import Database from 'better-sqlite3';
import { drizzle } from 'drizzle-orm/better-sqlite3';
import * as schema from '../../db/schema';
import { registerSubscriptionsRoutes } from './subscriptions';

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
  registerSubscriptionsRoutes(app, db);
  return { app, sqlite, db };
}

function insertSubscription(
  sqlite: ReturnType<typeof Database>,
  overrides: Partial<{
    id: string;
    email: string;
    plan: string;
    status: string;
    cancelledAt: string | null;
  }> = {},
) {
  const now = new Date().toISOString();
  const row = {
    id: `sub_test_${Math.random().toString(36).slice(2)}`,
    email: 'user@example.com',
    plan: 'free',
    status: 'active',
    cancelledAt: null,
    ...overrides,
  };
  sqlite
    .prepare(
      `INSERT INTO subscriptions (id, email, plan, status, created_at, updated_at, cancelled_at)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
    )
    .run(row.id, row.email, row.plan, row.status, now, now, row.cancelledAt);
  return row;
}

// ─── POST /subscribe ───────────────────────────────────────────────────────

describe('BILLING-001 POST /subscribe — validation', () => {
  it('1. missing email → 400', async () => {
    const { app } = freshApp();
    const res = await app.request('/subscribe', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ plan: 'pro' }),
    });
    expect(res.status).toBe(400);
    const body = await res.json() as { error: string };
    expect(body.error).toMatch(/email/i);
  });

  it('2. invalid email (no @) → 400', async () => {
    const { app } = freshApp();
    const res = await app.request('/subscribe', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ email: 'not-an-email', plan: 'free' }),
    });
    expect(res.status).toBe(400);
    const body = await res.json() as { error: string };
    expect(body.error).toMatch(/email/i);
  });

  it('3. whitespace-only email → 400', async () => {
    const { app } = freshApp();
    const res = await app.request('/subscribe', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ email: '   ', plan: 'free' }),
    });
    expect(res.status).toBe(400);
  });
});

describe('BILLING-001 POST /subscribe — creation', () => {
  it('4. valid email, no plan → 201, defaults to free', async () => {
    const { app } = freshApp();
    const res = await app.request('/subscribe', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ email: 'newuser@example.com' }),
    });
    expect(res.status).toBe(201);
    const body = await res.json() as { plan: string; status: string };
    expect(body.plan).toBe('free');
    expect(body.status).toBe('active');
  });

  it('5. valid email, explicit pro plan → 201', async () => {
    const { app } = freshApp();
    const res = await app.request('/subscribe', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ email: 'prouser@example.com', plan: 'pro' }),
    });
    expect(res.status).toBe(201);
    const body = await res.json() as { plan: string; email: string };
    expect(body.plan).toBe('pro');
    expect(body.email).toBe('prouser@example.com');
  });

  it('6. email normalised to lowercase → 201', async () => {
    const { app } = freshApp();
    const res = await app.request('/subscribe', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ email: 'MixedCase@Example.COM', plan: 'free' }),
    });
    expect(res.status).toBe(201);
    const body = await res.json() as { email: string };
    expect(body.email).toBe('mixedcase@example.com');
  });

  it('7. invalid plan string → 201, defaults to free', async () => {
    const { app } = freshApp();
    const res = await app.request('/subscribe', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ email: 'user@example.com', plan: 'ultimate' }),
    });
    expect(res.status).toBe(201);
    const body = await res.json() as { plan: string };
    expect(body.plan).toBe('free');
  });
});

describe('BILLING-001 POST /subscribe — idempotency', () => {
  it('8. same email+plan with active subscription → 200 with existing row', async () => {
    const { app, sqlite } = freshApp();
    const existing = insertSubscription(sqlite, { email: 'repeat@example.com', plan: 'pro' });

    const res = await app.request('/subscribe', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ email: 'repeat@example.com', plan: 'pro' }),
    });
    expect(res.status).toBe(200);
    const body = await res.json() as { id: string };
    expect(body.id).toBe(existing.id);
  });

  it('9. same email but different plan → 201 new row', async () => {
    const { app, sqlite } = freshApp();
    insertSubscription(sqlite, { email: 'multi@example.com', plan: 'free' });

    const res = await app.request('/subscribe', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ email: 'multi@example.com', plan: 'pro' }),
    });
    expect(res.status).toBe(201);
    const body = await res.json() as { plan: string };
    expect(body.plan).toBe('pro');
  });
});

// ─── GET /subscriptions ────────────────────────────────────────────────────

describe('BILLING-001 GET /subscriptions', () => {
  it('10. no subscriptions → empty list with total=0', async () => {
    const { app } = freshApp();
    const res = await app.request('/subscriptions');
    expect(res.status).toBe(200);
    const body = await res.json() as { subscriptions: unknown[]; total: number };
    expect(body.subscriptions).toHaveLength(0);
    expect(body.total).toBe(0);
  });

  it('11. lists all subscriptions', async () => {
    const { app, sqlite } = freshApp();
    insertSubscription(sqlite, { email: 'a@example.com', plan: 'free' });
    insertSubscription(sqlite, { email: 'b@example.com', plan: 'pro' });

    const res = await app.request('/subscriptions');
    expect(res.status).toBe(200);
    const body = await res.json() as { subscriptions: unknown[]; total: number };
    expect(body.total).toBe(2);
    expect(body.subscriptions).toHaveLength(2);
  });

  it('12. filters by status', async () => {
    const { app, sqlite } = freshApp();
    const now = new Date().toISOString();
    insertSubscription(sqlite, { email: 'active@example.com', status: 'active' });
    insertSubscription(sqlite, { email: 'cancelled@example.com', status: 'cancelled', cancelledAt: now });

    const res = await app.request('/subscriptions?status=active');
    expect(res.status).toBe(200);
    const body = await res.json() as { subscriptions: Array<{ status: string }>; total: number };
    expect(body.total).toBe(1);
    expect(body.subscriptions[0]!.status).toBe('active');
  });

  it('13. filters by plan', async () => {
    const { app, sqlite } = freshApp();
    insertSubscription(sqlite, { email: 'free@example.com', plan: 'free' });
    insertSubscription(sqlite, { email: 'pro@example.com', plan: 'pro' });
    insertSubscription(sqlite, { email: 'ent@example.com', plan: 'enterprise' });

    const res = await app.request('/subscriptions?plan=pro');
    expect(res.status).toBe(200);
    const body = await res.json() as { subscriptions: Array<{ plan: string }>; total: number };
    expect(body.total).toBe(1);
    expect(body.subscriptions[0]!.plan).toBe('pro');
  });

  it('14. filters by email (case-insensitive normalised)', async () => {
    const { app, sqlite } = freshApp();
    insertSubscription(sqlite, { email: 'target@example.com', plan: 'free' });
    insertSubscription(sqlite, { email: 'other@example.com', plan: 'pro' });

    const res = await app.request('/subscriptions?email=target@example.com');
    expect(res.status).toBe(200);
    const body = await res.json() as { subscriptions: Array<{ email: string }>; total: number };
    expect(body.total).toBe(1);
    expect(body.subscriptions[0]!.email).toBe('target@example.com');
  });
});

// ─── GET /subscriptions/:id ────────────────────────────────────────────────

describe('BILLING-001 GET /subscriptions/:id', () => {
  it('15. found → 200 with row', async () => {
    const { app, sqlite } = freshApp();
    const row = insertSubscription(sqlite, { id: 'sub_specific', email: 'lookup@example.com', plan: 'enterprise' });

    const res = await app.request(`/subscriptions/${row.id}`);
    expect(res.status).toBe(200);
    const body = await res.json() as { id: string; email: string; plan: string };
    expect(body.id).toBe('sub_specific');
    expect(body.email).toBe('lookup@example.com');
    expect(body.plan).toBe('enterprise');
  });

  it('16. not found → 404', async () => {
    const { app } = freshApp();
    const res = await app.request('/subscriptions/does_not_exist');
    expect(res.status).toBe(404);
    const body = await res.json() as { error: string };
    expect(body.error).toMatch(/not found/i);
  });
});

// ─── DELETE /subscriptions/:id ─────────────────────────────────────────────

describe('BILLING-001 DELETE /subscriptions/:id', () => {
  it('17. soft-cancel active subscription → 200, status=cancelled, cancelledAt set', async () => {
    const { app, sqlite } = freshApp();
    const row = insertSubscription(sqlite, { id: 'sub_to_cancel', email: 'cancel@example.com', plan: 'pro', status: 'active' });

    const res = await app.request(`/subscriptions/${row.id}`, { method: 'DELETE' });
    expect(res.status).toBe(200);
    const body = await res.json() as { status: string; cancelledAt: string | null };
    expect(body.status).toBe('cancelled');
    expect(body.cancelledAt).toBeTruthy();
  });

  it('18. already cancelled → 409', async () => {
    const { app, sqlite } = freshApp();
    const now = new Date().toISOString();
    const row = insertSubscription(sqlite, {
      id: 'sub_already_cancelled',
      email: 'already@example.com',
      status: 'cancelled',
      cancelledAt: now,
    });

    const res = await app.request(`/subscriptions/${row.id}`, { method: 'DELETE' });
    expect(res.status).toBe(409);
    const body = await res.json() as { error: string };
    expect(body.error).toMatch(/already cancelled/i);
  });

  it('19. not found → 404', async () => {
    const { app } = freshApp();
    const res = await app.request('/subscriptions/ghost_id', { method: 'DELETE' });
    expect(res.status).toBe(404);
    const body = await res.json() as { error: string };
    expect(body.error).toMatch(/not found/i);
  });
});
