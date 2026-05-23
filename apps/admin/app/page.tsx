import { redirect } from 'next/navigation';
import { getEngine } from '../lib/engine';

/**
 * Landing — creates a default tenant (dev only) and routes to the
 * first uncomplete category. In prod, a tenant row is inserted via
 * the signup form (out of scope for the wizard package).
 */
export default async function Home() {
  const { engine, store } = getEngine();
  // Dev tenant — production reads tenantId from a session cookie.
  let tenant = await store.getTenant('dev-tenant');
  if (!tenant) {
    tenant = await store.createTenant({
      id: 'dev-tenant',
      slug: 'dev',
      name: 'Dev Tenant',
      ownerEmail: 'dev@caia.local',
      billingEmail: 'dev@caia.local',
      timezone: 'UTC',
      locale: 'en-US',
    });
  }
  const state = await engine.stateFor(tenant.id);
  const next = state.current?.id ?? 'identity';
  redirect(`/onboarding/${next}`);
}
