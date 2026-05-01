import type { Hono } from 'hono';
import { eq, and } from 'drizzle-orm';
import type { Db } from '../../db/connection';
import { subscriptions } from '../../db/schema';

const VALID_PLANS = ['free', 'pro', 'enterprise'] as const;
const VALID_STATUSES = ['active', 'cancelled', 'expired'] as const;

type Plan = typeof VALID_PLANS[number];
type Status = typeof VALID_STATUSES[number];

function nanoid(): string {
  return `sub_${Date.now()}_${Math.random().toString(36).slice(2, 9)}`;
}

export function registerSubscriptionsRoutes(app: Hono, db: Db): void {
  // POST /subscribe — create a new subscription
  app.post('/subscribe', async (c) => {
    const body = await c.req.json<{ email?: string; plan?: string }>();

    if (!body.email || typeof body.email !== 'string') {
      return c.json({ error: 'email is required' }, 400);
    }
    const email = body.email.trim().toLowerCase();
    if (!email.includes('@')) {
      return c.json({ error: 'invalid email address' }, 400);
    }

    const plan: Plan = VALID_PLANS.includes(body.plan as Plan) ? (body.plan as Plan) : 'free';

    // Idempotent: return existing active subscription for the same email+plan
    const existing = db
      .select()
      .from(subscriptions)
      .where(and(eq(subscriptions.email, email), eq(subscriptions.plan, plan), eq(subscriptions.status, 'active')))
      .all()[0];

    if (existing) {
      return c.json(existing, 200);
    }

    const now = new Date().toISOString();
    const row = { id: nanoid(), email, plan, status: 'active' as Status, createdAt: now, updatedAt: now, cancelledAt: null };
    db.insert(subscriptions).values(row).run();
    return c.json(row, 201);
  });

  // GET /subscriptions — list subscriptions (optionally filter by status/plan)
  app.get('/subscriptions', (c) => {
    const { status, plan, email } = c.req.query() as Record<string, string>;
    let rows = db.select().from(subscriptions).all();

    if (status) rows = rows.filter((r) => r.status === status);
    if (plan) rows = rows.filter((r) => r.plan === plan);
    if (email) rows = rows.filter((r) => r.email === email.toLowerCase());

    return c.json({ subscriptions: rows, total: rows.length });
  });

  // GET /subscriptions/:id — get a single subscription
  app.get('/subscriptions/:id', (c) => {
    const { id } = c.req.param();
    const row = db.select().from(subscriptions).where(eq(subscriptions.id, id)).all()[0];
    if (!row) return c.json({ error: 'not found' }, 404);
    return c.json(row);
  });

  // DELETE /subscriptions/:id — soft-cancel a subscription
  app.delete('/subscriptions/:id', (c) => {
    const { id } = c.req.param();
    const row = db.select().from(subscriptions).where(eq(subscriptions.id, id)).all()[0];
    if (!row) return c.json({ error: 'not found' }, 404);
    if (row.status === 'cancelled') return c.json({ error: 'already cancelled' }, 409);

    const now = new Date().toISOString();
    db.update(subscriptions)
      .set({ status: 'cancelled', cancelledAt: now, updatedAt: now })
      .where(eq(subscriptions.id, id))
      .run();

    return c.json({ ...row, status: 'cancelled', cancelledAt: now, updatedAt: now });
  });
}
