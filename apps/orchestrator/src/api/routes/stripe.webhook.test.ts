/**
 * STRIPE-WEBHOOK-001 — handleWebhookEvent unit tests (13 cases).
 *
 * Tests the extracted pure function, bypassing signature verification so
 * each Stripe event type can be exercised against an in-memory SQLite DB.
 *
 *  checkout.session.completed:
 *   1. mode !== 'subscription' → no DB change
 *   2. no prior row → new subscription created with all Stripe fields
 *   3. existing active row for same email+plan → Stripe IDs attached, no duplicate
 *
 *  customer.subscription.updated:
 *   4. stripe status 'active'    → local status 'active'
 *   5. stripe status 'canceled'  → local status 'cancelled', cancelledAt set
 *   6. stripe status 'past_due'  → local status 'expired'
 *   7. unknown stripeSubscriptionId → no-op
 *
 *  customer.subscription.deleted:
 *   8. active row → status='cancelled', cancelledAt set
 *   9. already cancelled → no update (idempotent)
 *  10. unknown ID → no-op
 *
 *  invoice.payment_failed:
 *  11. known subscription → status='expired'
 *  12. unknown subscription ID → no-op
 *  13. subscription field absent → no-op
 */

import { describe, it, expect, vi } from 'vitest';
import Database from 'better-sqlite3';
import { drizzle } from 'drizzle-orm/better-sqlite3';
import * as schema from '../../db/schema';
import { handleWebhookEvent } from './stripe';

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

function freshDb() {
  const sqlite = new Database(':memory:');
  sqlite.exec(SCHEMA_SQL);
  const db = drizzle(sqlite, { schema });
  return { sqlite, db };
}

const NOW = '2025-01-01T00:00:00.000Z';
const noPriceId = vi.fn().mockResolvedValue('price_none');

function insertSub(
  sqlite: Database.Database,
  overrides: Partial<{
    id: string;
    email: string;
    plan: string;
    status: string;
    stripeSubscriptionId: string | null;
    stripeCustomerId: string | null;
    cancelledAt: string | null;
  }> = {},
) {
  const row = {
    id: `sub_${Math.random().toString(36).slice(2, 9)}`,
    email: 'user@example.com',
    plan: 'pro',
    status: 'active',
    stripeSubscriptionId: null,
    stripeCustomerId: null,
    cancelledAt: null,
    ...overrides,
  };
  sqlite
    .prepare(
      `INSERT INTO subscriptions (id, email, plan, status, created_at, updated_at, stripe_subscription_id, stripe_customer_id, cancelled_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .run(row.id, row.email, row.plan, row.status, NOW, NOW, row.stripeSubscriptionId, row.stripeCustomerId, row.cancelledAt);
  return row;
}

// ─── checkout.session.completed ───────────────────────────────────────────────

describe('STRIPE-WEBHOOK-001 checkout.session.completed', () => {
  it('1. mode !== subscription → no DB change', async () => {
    const { sqlite, db } = freshDb();
    await handleWebhookEvent(
      {
        type: 'checkout.session.completed',
        data: {
          object: { mode: 'payment', metadata: { email: 'a@b.com', plan: 'pro' }, customer: 'cus_x', subscription: 'sub_x' },
        },
      },
      db,
      NOW,
      noPriceId,
    );
    const rows = sqlite.prepare('SELECT * FROM subscriptions').all();
    expect(rows).toHaveLength(0);
  });

  it('2. no prior row → new subscription created with all Stripe fields', async () => {
    const { sqlite, db } = freshDb();
    const getPriceId = vi.fn().mockResolvedValue('price_pro_123');
    await handleWebhookEvent(
      {
        type: 'checkout.session.completed',
        data: {
          object: {
            mode: 'subscription',
            metadata: { email: 'new@example.com', plan: 'pro' },
            customer: 'cus_new',
            subscription: 'sub_new',
          },
        },
      },
      db,
      NOW,
      getPriceId,
    );
    expect(getPriceId).toHaveBeenCalledWith('sub_new');
    const rows = sqlite.prepare('SELECT * FROM subscriptions').all() as Array<Record<string, unknown>>;
    expect(rows).toHaveLength(1);
    expect(rows[0]!['email']).toBe('new@example.com');
    expect(rows[0]!['plan']).toBe('pro');
    expect(rows[0]!['status']).toBe('active');
    expect(rows[0]!['stripe_customer_id']).toBe('cus_new');
    expect(rows[0]!['stripe_subscription_id']).toBe('sub_new');
    expect(rows[0]!['stripe_price_id']).toBe('price_pro_123');
  });

  it('3. existing active row for same email+plan → Stripe IDs attached, no duplicate', async () => {
    const { sqlite, db } = freshDb();
    const existing = insertSub(sqlite, { id: 'sub_existing', email: 'exist@example.com', plan: 'pro', status: 'active' });
    await handleWebhookEvent(
      {
        type: 'checkout.session.completed',
        data: {
          object: {
            mode: 'subscription',
            metadata: { email: 'exist@example.com', plan: 'pro' },
            customer: 'cus_attach',
            subscription: 'sub_attach',
          },
        },
      },
      db,
      NOW,
      vi.fn().mockResolvedValue('price_pro_attached'),
    );
    const rows = sqlite.prepare('SELECT * FROM subscriptions').all() as Array<Record<string, unknown>>;
    // No new row created
    expect(rows).toHaveLength(1);
    expect(rows[0]!['id']).toBe(existing.id);
    expect(rows[0]!['stripe_customer_id']).toBe('cus_attach');
    expect(rows[0]!['stripe_subscription_id']).toBe('sub_attach');
    expect(rows[0]!['stripe_price_id']).toBe('price_pro_attached');
  });
});

// ─── customer.subscription.updated ───────────────────────────────────────────

describe('STRIPE-WEBHOOK-001 customer.subscription.updated', () => {
  it('4. stripe status active → local status active', async () => {
    const { sqlite, db } = freshDb();
    insertSub(sqlite, { id: 'sub_upd4', stripeSubscriptionId: 'stripe_upd4', status: 'expired' });
    await handleWebhookEvent(
      { type: 'customer.subscription.updated', data: { object: { id: 'stripe_upd4', status: 'active' } } },
      db,
      NOW,
      noPriceId,
    );
    const row = sqlite.prepare('SELECT * FROM subscriptions WHERE id = ?').get('sub_upd4') as Record<string, unknown>;
    expect(row['status']).toBe('active');
    expect(row['cancelled_at']).toBeNull();
  });

  it('5. stripe status canceled → local status cancelled, cancelledAt set', async () => {
    const { sqlite, db } = freshDb();
    insertSub(sqlite, { id: 'sub_upd5', stripeSubscriptionId: 'stripe_upd5', status: 'active' });
    await handleWebhookEvent(
      { type: 'customer.subscription.updated', data: { object: { id: 'stripe_upd5', status: 'canceled' } } },
      db,
      NOW,
      noPriceId,
    );
    const row = sqlite.prepare('SELECT * FROM subscriptions WHERE id = ?').get('sub_upd5') as Record<string, unknown>;
    expect(row['status']).toBe('cancelled');
    expect(row['cancelled_at']).toBe(NOW);
  });

  it('6. stripe status past_due → local status expired', async () => {
    const { sqlite, db } = freshDb();
    insertSub(sqlite, { id: 'sub_upd6', stripeSubscriptionId: 'stripe_upd6', status: 'active' });
    await handleWebhookEvent(
      { type: 'customer.subscription.updated', data: { object: { id: 'stripe_upd6', status: 'past_due' } } },
      db,
      NOW,
      noPriceId,
    );
    const row = sqlite.prepare('SELECT * FROM subscriptions WHERE id = ?').get('sub_upd6') as Record<string, unknown>;
    expect(row['status']).toBe('expired');
  });

  it('7. unknown stripeSubscriptionId → no-op', async () => {
    const { sqlite, db } = freshDb();
    insertSub(sqlite, { id: 'sub_upd7', stripeSubscriptionId: 'stripe_known', status: 'active' });
    await handleWebhookEvent(
      { type: 'customer.subscription.updated', data: { object: { id: 'stripe_unknown', status: 'canceled' } } },
      db,
      NOW,
      noPriceId,
    );
    const row = sqlite.prepare('SELECT * FROM subscriptions WHERE id = ?').get('sub_upd7') as Record<string, unknown>;
    // unchanged
    expect(row['status']).toBe('active');
  });
});

// ─── customer.subscription.deleted ───────────────────────────────────────────

describe('STRIPE-WEBHOOK-001 customer.subscription.deleted', () => {
  it('8. active row → status cancelled, cancelledAt set', async () => {
    const { sqlite, db } = freshDb();
    insertSub(sqlite, { id: 'sub_del8', stripeSubscriptionId: 'stripe_del8', status: 'active' });
    await handleWebhookEvent(
      { type: 'customer.subscription.deleted', data: { object: { id: 'stripe_del8' } } },
      db,
      NOW,
      noPriceId,
    );
    const row = sqlite.prepare('SELECT * FROM subscriptions WHERE id = ?').get('sub_del8') as Record<string, unknown>;
    expect(row['status']).toBe('cancelled');
    expect(row['cancelled_at']).toBe(NOW);
  });

  it('9. already cancelled → no update (idempotent)', async () => {
    const ORIG_CANCELLED_AT = '2024-06-01T00:00:00.000Z';
    const { sqlite, db } = freshDb();
    insertSub(sqlite, {
      id: 'sub_del9',
      stripeSubscriptionId: 'stripe_del9',
      status: 'cancelled',
      cancelledAt: ORIG_CANCELLED_AT,
    });
    await handleWebhookEvent(
      { type: 'customer.subscription.deleted', data: { object: { id: 'stripe_del9' } } },
      db,
      NOW,
      noPriceId,
    );
    const row = sqlite.prepare('SELECT * FROM subscriptions WHERE id = ?').get('sub_del9') as Record<string, unknown>;
    // cancelledAt must not be overwritten
    expect(row['cancelled_at']).toBe(ORIG_CANCELLED_AT);
  });

  it('10. unknown ID → no-op', async () => {
    const { sqlite, db } = freshDb();
    insertSub(sqlite, { id: 'sub_del10', stripeSubscriptionId: 'stripe_known2', status: 'active' });
    await handleWebhookEvent(
      { type: 'customer.subscription.deleted', data: { object: { id: 'stripe_ghost' } } },
      db,
      NOW,
      noPriceId,
    );
    const row = sqlite.prepare('SELECT * FROM subscriptions WHERE id = ?').get('sub_del10') as Record<string, unknown>;
    expect(row['status']).toBe('active');
  });
});

// ─── invoice.payment_failed ───────────────────────────────────────────────────

describe('STRIPE-WEBHOOK-001 invoice.payment_failed', () => {
  it('11. known subscription → status expired', async () => {
    const { sqlite, db } = freshDb();
    insertSub(sqlite, { id: 'sub_inv11', stripeSubscriptionId: 'stripe_inv11', status: 'active' });
    await handleWebhookEvent(
      { type: 'invoice.payment_failed', data: { object: { subscription: 'stripe_inv11' } } },
      db,
      NOW,
      noPriceId,
    );
    const row = sqlite.prepare('SELECT * FROM subscriptions WHERE id = ?').get('sub_inv11') as Record<string, unknown>;
    expect(row['status']).toBe('expired');
  });

  it('12. unknown subscription ID → no-op', async () => {
    const { sqlite, db } = freshDb();
    insertSub(sqlite, { id: 'sub_inv12', stripeSubscriptionId: 'stripe_inv12', status: 'active' });
    await handleWebhookEvent(
      { type: 'invoice.payment_failed', data: { object: { subscription: 'stripe_ghost2' } } },
      db,
      NOW,
      noPriceId,
    );
    const row = sqlite.prepare('SELECT * FROM subscriptions WHERE id = ?').get('sub_inv12') as Record<string, unknown>;
    expect(row['status']).toBe('active');
  });

  it('13. subscription field absent → no-op', async () => {
    const { sqlite, db } = freshDb();
    insertSub(sqlite, { id: 'sub_inv13', stripeSubscriptionId: 'stripe_inv13', status: 'active' });
    await handleWebhookEvent(
      { type: 'invoice.payment_failed', data: { object: {} } },
      db,
      NOW,
      noPriceId,
    );
    const row = sqlite.prepare('SELECT * FROM subscriptions WHERE id = ?').get('sub_inv13') as Record<string, unknown>;
    expect(row['status']).toBe('active');
  });
});
