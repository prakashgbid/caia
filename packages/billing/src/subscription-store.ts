/**
 * `subscription-store.ts` — abstract persistence for `tenant_subscriptions`.
 *
 * The package stays DB-agnostic by defining a `SubscriptionStore`
 * interface and shipping an `InMemorySubscriptionStore` for tests.
 * Operator wires a real Postgres-backed implementation in the dashboard
 * boot path on day 1 (see README).
 */

import type { TenantSubscription, Tier, SubscriptionStatus } from './types.js';

export interface SubscriptionStore {
  get(tenantId: string): Promise<TenantSubscription | null>;
  getByStripeSubscriptionId(
    stripeSubscriptionId: string,
  ): Promise<TenantSubscription | null>;
  getByStripeCustomerId(
    stripeCustomerId: string,
  ): Promise<TenantSubscription | null>;
  upsert(sub: TenantSubscription): Promise<void>;
  listByStatus(status: SubscriptionStatus): Promise<TenantSubscription[]>;
}

export class InMemorySubscriptionStore implements SubscriptionStore {
  private readonly byTenant = new Map<string, TenantSubscription>();

  async get(tenantId: string): Promise<TenantSubscription | null> {
    return this.byTenant.get(tenantId) ?? null;
  }

  async getByStripeSubscriptionId(
    stripeSubscriptionId: string,
  ): Promise<TenantSubscription | null> {
    for (const sub of this.byTenant.values()) {
      if (sub.stripeSubscriptionId === stripeSubscriptionId) return sub;
    }
    return null;
  }

  async getByStripeCustomerId(
    stripeCustomerId: string,
  ): Promise<TenantSubscription | null> {
    for (const sub of this.byTenant.values()) {
      if (sub.stripeCustomerId === stripeCustomerId) return sub;
    }
    return null;
  }

  async upsert(sub: TenantSubscription): Promise<void> {
    this.byTenant.set(sub.tenantId, { ...sub });
  }

  async listByStatus(status: SubscriptionStatus): Promise<TenantSubscription[]> {
    return [...this.byTenant.values()].filter((s) => s.status === status);
  }

  async seed(
    tenantId: string,
    overrides: Partial<TenantSubscription> = {},
  ): Promise<TenantSubscription> {
    const seeded: TenantSubscription = {
      tenantId,
      tier: 'free',
      status: 'active',
      stripeCustomerId: null,
      stripeSubscriptionId: null,
      currentPeriodEnd: null,
      cancelAtPeriodEnd: false,
      updatedAt: new Date(),
      ...overrides,
    };
    await this.upsert(seeded);
    return seeded;
  }

  size(): number {
    return this.byTenant.size;
  }
}

/**
 * Map a Stripe-side status string → our internal enum. Unknown strings
 * degrade to `'incomplete'` so a webhook never 500s on a label we don't
 * recognise.
 */
export function mapStripeStatus(raw: string): SubscriptionStatus {
  const allowed: readonly SubscriptionStatus[] = [
    'incomplete',
    'incomplete_expired',
    'trialing',
    'active',
    'past_due',
    'canceled',
    'unpaid',
    'paused',
  ];
  return (allowed as readonly string[]).includes(raw)
    ? (raw as SubscriptionStatus)
    : 'incomplete';
}

/**
 * Map a Stripe price `lookup_key` → CAIA tier. Returns `null` for
 * unrecognised keys (e.g. legacy pricing experiments).
 */
export function lookupKeyToTier(lookupKey: string | null | undefined): Tier | null {
  if (!lookupKey) return null;
  if (lookupKey === 'caia_free_v1') return 'free';
  if (lookupKey === 'caia_professional_monthly_v1') return 'professional';
  if (lookupKey === 'caia_team_monthly_v1') return 'team';
  return null;
}
