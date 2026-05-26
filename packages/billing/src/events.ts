/**
 * `events.ts` — bus integration via `@chiefaia/events`.
 *
 * Other packages subscribe to these events to react to billing changes
 * (e.g. spend-guard tightens caps when a tenant drops to `free`,
 * onboarding nudges a tenant to add a runtime key after first
 * subscription, audit pipeline records every key read).
 */

import type { EventBus } from '@chiefaia/events';

import type {
  ByokProvider,
  RuntimeKeyReadAuditEntry,
  SubscriptionStatus,
  TenantSubscription,
  Tier,
} from './types.js';

export const EVENT_TENANT_SUBSCRIPTION_CHANGED =
  'tenant.subscription.changed' as const;
export const EVENT_TENANT_RUNTIME_KEY_SET = 'tenant.runtime.key.set' as const;
export const EVENT_TENANT_RUNTIME_KEY_REVOKED =
  'tenant.runtime.key.revoked' as const;
export const EVENT_TENANT_RUNTIME_KEY_READ =
  'tenant.runtime.key.read' as const;

export interface TenantSubscriptionChangedPayload {
  tenantId: string;
  previous: TenantSubscription | null;
  current: TenantSubscription;
  /** Convenience: `previous?.tier ?? null` when caller doesn't want to derive it. */
  previousTier: Tier | null;
  currentTier: Tier;
  /** Convenience: `previous?.status ?? null`. */
  previousStatus: SubscriptionStatus | null;
  currentStatus: SubscriptionStatus;
}

export interface TenantRuntimeKeySetPayload {
  tenantId: string;
  provider: ByokProvider;
  /** Whether this replaced an existing key (rotation) or set a new one. */
  rotated: boolean;
  at: Date;
}

export interface TenantRuntimeKeyRevokedPayload {
  tenantId: string;
  provider: ByokProvider;
  at: Date;
}

export type TenantRuntimeKeyReadPayload = RuntimeKeyReadAuditEntry;

/**
 * Emit helpers. The bus is passed in (not a singleton) so each app
 * boots its own and tests use an isolated one.
 */
export class BillingEvents {
  constructor(private readonly bus: EventBus) {}

  async subscriptionChanged(
    payload: TenantSubscriptionChangedPayload,
  ): Promise<void> {
    await this.bus.emit(EVENT_TENANT_SUBSCRIPTION_CHANGED, payload);
  }

  async runtimeKeySet(payload: TenantRuntimeKeySetPayload): Promise<void> {
    await this.bus.emit(EVENT_TENANT_RUNTIME_KEY_SET, payload);
  }

  async runtimeKeyRevoked(
    payload: TenantRuntimeKeyRevokedPayload,
  ): Promise<void> {
    await this.bus.emit(EVENT_TENANT_RUNTIME_KEY_REVOKED, payload);
  }

  async runtimeKeyRead(payload: TenantRuntimeKeyReadPayload): Promise<void> {
    await this.bus.emit(EVENT_TENANT_RUNTIME_KEY_READ, payload);
  }
}
