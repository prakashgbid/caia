import { describe, it, expect } from 'vitest';
import { InMemoryOnboardingStore } from '../src/store/in-memory.js';

describe('InMemoryOnboardingStore', () => {
  it('creates and retrieves tenants', async () => {
    const s = new InMemoryOnboardingStore();
    const t = await s.createTenant({
      slug: 'acme',
      name: 'Acme',
      ownerEmail: 'a@acme.com',
      billingEmail: 'b@acme.com',
      timezone: 'UTC',
      locale: 'en-US',
    });
    expect(t.status).toBe('onboarding');
    expect(t.onboardingComplete).toBe(false);
    const got = await s.getTenant(t.id);
    expect(got?.slug).toBe('acme');
  });

  it('marks a tenant onboarded', async () => {
    const s = new InMemoryOnboardingStore();
    const t = await s.createTenant({
      slug: 's',
      name: 'n',
      ownerEmail: 'a@b.com',
      billingEmail: 'a@b.com',
      timezone: 'UTC',
      locale: 'en-US',
    });
    await s.markTenantOnboarded(t.id);
    const after = await s.getTenant(t.id);
    expect(after?.onboardingComplete).toBe(true);
    expect(after?.status).toBe('onboarded');
  });

  it('upserts steps idempotently', async () => {
    const s = new InMemoryOnboardingStore();
    const t = await s.createTenant({
      slug: 's',
      name: 'n',
      ownerEmail: 'a@b.com',
      billingEmail: 'a@b.com',
      timezone: 'UTC',
      locale: 'en-US',
    });
    await s.upsertStep({
      tenantId: t.id,
      category: 'repo',
      status: 'pending',
      required: true,
      attemptCount: 0,
    });
    await s.upsertStep({
      tenantId: t.id,
      category: 'repo',
      status: 'passed',
      required: true,
      attemptCount: 1,
    });
    const steps = await s.listSteps(t.id);
    expect(steps.length).toBe(1);
    expect(steps[0]?.status).toBe('passed');
  });

  it('increments attempt_count on probing', async () => {
    const s = new InMemoryOnboardingStore();
    await s.setStepStatus('t', 'repo', 'probing');
    await s.setStepStatus('t', 'repo', 'probing');
    const step = await s.getStep('t', 'repo');
    expect(step?.attemptCount).toBeGreaterThanOrEqual(2);
  });

  it('stores and lists customer choices', async () => {
    const s = new InMemoryOnboardingStore();
    await s.putChoice({
      tenantId: 't',
      category: 'cloud',
      choiceKey: 'provider',
      choiceValue: 'cloudflare-pages',
      source: 'wizard',
    });
    await s.putChoice({
      tenantId: 't',
      category: 'cloud',
      choiceKey: 'region',
      choiceValue: 'auto',
      source: 'wizard',
    });
    const xs = await s.listChoices('t');
    expect(xs.length).toBe(2);
  });

  it('stores and lists credentials (secret_ref only)', async () => {
    const s = new InMemoryOnboardingStore();
    await s.putCredential({
      tenantId: 't',
      category: 'cloud',
      keyId: 'api_token',
      secretRef: 'infisical://tenants/t/cloud/api_token@v1',
      archetype: 'api_token',
      provider: 'cloudflare-pages',
      scopesGranted: ['Account:Read'],
      scopesRequired: ['Account:Read'],
      status: 'active',
      validatedAt: new Date(),
      metadata: {},
    });
    const creds = await s.listCredentials('t');
    expect(creds.length).toBe(1);
    expect(creds[0]?.secretRef).toMatch(/^infisical:\/\//);
    // crucially, no raw secret value stored
    const c = creds[0] as Record<string, unknown>;
    expect(c['value']).toBeUndefined();
  });

  it('audit log is append-only and tenant-scoped', async () => {
    const s = new InMemoryOnboardingStore();
    await s.appendAudit({
      tenantId: 't1',
      actorType: 'customer',
      action: 'onboarding.step.passed',
      payload: { x: 1 },
      occurredAt: new Date(),
    });
    await s.appendAudit({
      tenantId: 't2',
      actorType: 'customer',
      action: 'onboarding.step.passed',
      payload: { x: 1 },
      occurredAt: new Date(),
    });
    expect((await s.listAudit('t1')).length).toBe(1);
    expect((await s.listAudit('t2')).length).toBe(1);
  });

  it('listAudit returns newest first', async () => {
    const s = new InMemoryOnboardingStore();
    await s.appendAudit({
      tenantId: 't',
      actorType: 'customer',
      action: 'a.one',
      payload: {},
      occurredAt: new Date(2000, 0, 1),
    });
    await s.appendAudit({
      tenantId: 't',
      actorType: 'customer',
      action: 'a.two',
      payload: {},
      occurredAt: new Date(2026, 0, 1),
    });
    const list = await s.listAudit('t');
    expect(list[0]?.action).toBe('a.two');
  });

  it('credential lookup returns undefined for unknown key', async () => {
    const s = new InMemoryOnboardingStore();
    expect(await s.getCredential('t', 'cloud', 'nope')).toBeUndefined();
  });
});
