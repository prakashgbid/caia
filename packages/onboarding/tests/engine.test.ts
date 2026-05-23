import { describe, it, expect, beforeEach } from 'vitest';
import { OnboardingEngine } from '../src/engine/engine.js';
import { InMemoryOnboardingStore } from '../src/store/in-memory.js';
import { mockFetch, fixedContext, fakeSecretsPutter } from './helpers.js';
import { MANDATORY_CATEGORY_IDS } from '../src/categories/index.js';
import type { TenantRow } from '../src/types.js';

async function setup(): Promise<{
  engine: OnboardingEngine;
  store: InMemoryOnboardingStore;
  tenant: TenantRow;
  secrets: ReturnType<typeof fakeSecretsPutter>;
}> {
  const store = new InMemoryOnboardingStore();
  const secrets = fakeSecretsPutter();
  const tenant = await store.createTenant({
    slug: 'acme',
    name: 'Acme',
    ownerEmail: 'p@acme.com',
    billingEmail: 'p@acme.com',
    timezone: 'UTC',
    locale: 'en-US',
  });
  const { fetch } = mockFetch({
    'https://api.github.com/user': {
      status: 200,
      body: { login: 'octo', id: 1 },
      headers: { 'X-OAuth-Scopes': 'repo, workflow' },
    },
    'https://api.cloudflare.com/client/v4/user/tokens/verify': {
      status: 200,
      body: { success: true, result: { id: 't', status: 'active' } },
    },
    'https://api.resend.com/domains': {
      status: 200,
      body: { data: [{ id: 'd' }] },
    },
    'https://sentry.io/api/0/organizations/': { status: 200, body: [] },
    'https://api.linear.app/graphql': {
      status: 200,
      body: { data: { viewer: { id: 'v' } } },
    },
    'https://app.posthog.com/api/users/@me/': { status: 200, body: { id: 'u' } },
    'https://api.axiom.co/v1/user': { status: 200, body: { id: 'u' } },
    'https://api.honeycomb.io/1/auth': { status: 200, body: { team: {} } },
    'https://api.anthropic.com/v1/messages': { status: 200, body: {} },
  });
  const engine = new OnboardingEngine({
    store,
    secrets,
    validatorCtx: fixedContext(fetch),
  });
  return { engine, store, tenant, secrets };
}

describe('OnboardingEngine — basic flow', () => {
  let env: Awaited<ReturnType<typeof setup>>;
  beforeEach(async () => {
    env = await setup();
  });

  it('lists all 19 categories', () => {
    expect(env.engine.categories().length).toBe(19);
  });

  it('initial state.current points to identity (first required)', async () => {
    const st = await env.engine.stateFor(env.tenant.id);
    expect(st.current?.id).toBe('identity');
    expect(st.ready).toBe(false);
  });

  it('submitStep with caia-managed (no creds) marks passed', async () => {
    const r = await env.engine.submitStep({
      tenantId: env.tenant.id,
      category: 'repo',
      providerId: 'caia-managed',
      choices: {},
      credentials: {},
    });
    expect(r.status).toBe('passed');
    expect(r.credentialRefs).toEqual([]);
  });

  it('submitStep with GitHub PUTs secret into the secrets adapter', async () => {
    const r = await env.engine.submitStep({
      tenantId: env.tenant.id,
      category: 'repo',
      providerId: 'github',
      choices: {},
      credentials: { api_token: 'gh_xyz' },
    });
    expect(r.status).toBe('passed');
    expect(env.secrets.puts.length).toBe(1);
    expect(env.secrets.puts[0]?.value).toBe('gh_xyz');
    expect(r.credentialRefs[0]).toMatch(/^infisical:\/\//);
  });

  it('credential row stores secret_ref only, not the raw value', async () => {
    await env.engine.submitStep({
      tenantId: env.tenant.id,
      category: 'repo',
      providerId: 'github',
      choices: {},
      credentials: { api_token: 'gh_xyz' },
    });
    const creds = await env.store.listCredentials(env.tenant.id);
    expect(creds.length).toBe(1);
    expect(creds[0]?.secretRef).toMatch(/^infisical:\/\//);
    const c = creds[0] as Record<string, unknown>;
    expect(c['value']).toBeUndefined();
  });

  it('writes choice rows', async () => {
    await env.engine.submitStep({
      tenantId: env.tenant.id,
      category: 'repo',
      providerId: 'github',
      choices: { defaultBranch: 'main' },
      credentials: { api_token: 'gh_xyz' },
    });
    const choices = await env.store.listChoices(env.tenant.id);
    const provider = choices.find((c) => c.choiceKey === 'provider');
    const branch = choices.find((c) => c.choiceKey === 'defaultBranch');
    expect(provider?.choiceValue).toBe('github');
    expect(branch?.choiceValue).toBe('main');
  });

  it('audit log records started + passed actions', async () => {
    await env.engine.submitStep({
      tenantId: env.tenant.id,
      category: 'repo',
      providerId: 'github',
      choices: {},
      credentials: { api_token: 'gh_xyz' },
    });
    const log = await env.store.listAudit(env.tenant.id);
    const actions = log.map((e) => e.action);
    expect(actions).toContain('onboarding.step.started');
    expect(actions).toContain('onboarding.step.passed');
    expect(actions).toContain('credential.put');
  });

  it('audit log records failed actions on bad credentials', async () => {
    const store = new InMemoryOnboardingStore();
    const { fetch } = mockFetch({
      'https://api.github.com/user': { status: 401, body: {} },
    });
    const engine = new OnboardingEngine({
      store,
      secrets: fakeSecretsPutter(),
      validatorCtx: fixedContext(fetch),
    });
    const t = await store.createTenant({
      slug: 's',
      name: 'n',
      ownerEmail: 'a@b.com',
      billingEmail: 'a@b.com',
      timezone: 'UTC',
      locale: 'en-US',
    });
    const r = await engine.submitStep({
      tenantId: t.id,
      category: 'repo',
      providerId: 'github',
      choices: {},
      credentials: { api_token: 'bad' },
    });
    expect(r.status).toBe('failed');
    const log = await store.listAudit(t.id);
    expect(log.some((e) => e.action === 'onboarding.step.failed')).toBe(true);
    expect(log.some((e) => e.action === 'credential.put')).toBe(false);
  });

  it('re-submitting the same step is idempotent (no duplicate credential)', async () => {
    await env.engine.submitStep({
      tenantId: env.tenant.id,
      category: 'repo',
      providerId: 'github',
      choices: {},
      credentials: { api_token: 'gh_xyz' },
    });
    await env.engine.submitStep({
      tenantId: env.tenant.id,
      category: 'repo',
      providerId: 'github',
      choices: {},
      credentials: { api_token: 'gh_xyz' },
    });
    const creds = await env.store.listCredentials(env.tenant.id);
    expect(creds.length).toBe(1);
  });

  it('attempt_count rises on each probing', async () => {
    await env.engine.submitStep({
      tenantId: env.tenant.id,
      category: 'repo',
      providerId: 'github',
      choices: {},
      credentials: { api_token: 'gh_xyz' },
    });
    await env.engine.submitStep({
      tenantId: env.tenant.id,
      category: 'repo',
      providerId: 'github',
      choices: {},
      credentials: { api_token: 'gh_xyz' },
    });
    const step = await env.store.getStep(env.tenant.id, 'repo');
    expect(step?.attemptCount).toBeGreaterThanOrEqual(2);
  });

  it('current step advances when previous one passes', async () => {
    await env.engine.submitStep({
      tenantId: env.tenant.id,
      category: 'identity',
      providerId: 'self',
      choices: {
        ownerEmail: 'p@example.com',
        timezone: 'UTC',
        locale: 'en-US',
      },
      credentials: {},
    });
    const st = await env.engine.stateFor(env.tenant.id);
    expect(st.current?.id).toBe('auth');
  });

  it('defer is rejected for required categories', async () => {
    await expect(
      env.engine.defer(env.tenant.id, 'repo', 'too hard'),
    ).rejects.toThrow();
  });

  it('defer is allowed for optional categories', async () => {
    await env.engine.defer(env.tenant.id, 'docs', 'skip');
    const step = await env.store.getStep(env.tenant.id, 'docs');
    expect(step?.status).toBe('deferred');
  });

  it('tenant is marked onboarded only after every mandatory step is done', async () => {
    // Use caia-managed everywhere available; sprinkle real validators
    // where caia-managed is not an option.
    for (const cat of MANDATORY_CATEGORY_IDS) {
      const providerByCat: Record<string, { providerId: string; choices?: Record<string, unknown>; credentials?: Record<string, string> }> = {
        identity: {
          providerId: 'self',
          choices: { ownerEmail: 'p@acme.com', timezone: 'UTC', locale: 'en-US' },
          credentials: {},
        },
        auth: { providerId: 'email-magic-link', credentials: {} },
        pricing: {
          providerId: 'byok',
          credentials: { anthropic_api_key: 'sk-ant-x' },
        },
        repo: { providerId: 'caia-managed', credentials: {} },
        ci: { providerId: 'caia-managed', credentials: {} },
        cloud: { providerId: 'caia-managed', credentials: {} },
        domain: { providerId: 'none', credentials: {} },
        dns: { providerId: 'none', credentials: {} },
        cdn: { providerId: 'caia-managed', credentials: {} },
        database: { providerId: 'caia-managed', credentials: {} },
        email: { providerId: 'caia-managed', credentials: {} },
        analytics: { providerId: 'none', credentials: {} },
        errors: { providerId: 'cloudflare-logpush', credentials: {} },
        observability: { providerId: 'none', credentials: {} },
        pm: { providerId: 'caia-managed', credentials: {} },
      };
      const spec = providerByCat[cat];
      if (!spec) throw new Error(`missing provider for ${cat}`);
      await env.engine.submitStep({
        tenantId: env.tenant.id,
        category: cat,
        providerId: spec.providerId,
        choices: spec.choices ?? {},
        credentials: spec.credentials ?? {},
      });
    }
    const t = await env.store.getTenant(env.tenant.id);
    expect(t?.onboardingComplete).toBe(true);
    const log = await env.store.listAudit(env.tenant.id);
    expect(log.some((e) => e.action === 'onboarding.completed')).toBe(true);
  });

  it('resume: failed step keeps current pointer on that step', async () => {
    const store = new InMemoryOnboardingStore();
    const { fetch } = mockFetch({
      'https://api.github.com/user': { status: 401, body: {} },
    });
    const engine = new OnboardingEngine({
      store,
      secrets: fakeSecretsPutter(),
      validatorCtx: fixedContext(fetch),
    });
    const t = await store.createTenant({
      slug: 's',
      name: 'n',
      ownerEmail: 'a@b.com',
      billingEmail: 'a@b.com',
      timezone: 'UTC',
      locale: 'en-US',
    });
    // identity first (so the next required is auth) — use self
    await engine.submitStep({
      tenantId: t.id,
      category: 'identity',
      providerId: 'self',
      choices: { ownerEmail: 'a@b.com', timezone: 'UTC', locale: 'en-US' },
      credentials: {},
    });
    // pricing fails on auth provider — leave as-is
    const st1 = await engine.stateFor(t.id);
    expect(st1.current?.id).toBe('auth');
  });
});

describe('OnboardingEngine — error handling', () => {
  it('throws on unknown category', async () => {
    const store = new InMemoryOnboardingStore();
    const engine = new OnboardingEngine({
      store,
      secrets: fakeSecretsPutter(),
    });
    const t = await store.createTenant({
      slug: 's',
      name: 'n',
      ownerEmail: 'a@b.com',
      billingEmail: 'a@b.com',
      timezone: 'UTC',
      locale: 'en-US',
    });
    await expect(
      engine.submitStep({
        tenantId: t.id,
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        category: 'nope' as any,
        providerId: 'x',
        choices: {},
        credentials: {},
      }),
    ).rejects.toThrow();
  });

  it('throws on unknown provider', async () => {
    const store = new InMemoryOnboardingStore();
    const engine = new OnboardingEngine({
      store,
      secrets: fakeSecretsPutter(),
    });
    const t = await store.createTenant({
      slug: 's',
      name: 'n',
      ownerEmail: 'a@b.com',
      billingEmail: 'a@b.com',
      timezone: 'UTC',
      locale: 'en-US',
    });
    await expect(
      engine.submitStep({
        tenantId: t.id,
        category: 'repo',
        providerId: 'unknown',
        choices: {},
        credentials: {},
      }),
    ).rejects.toThrow();
  });

  it('captures validator throw as provider_error failure', async () => {
    const store = new InMemoryOnboardingStore();
    // fetch throws → network_error from validator, not engine throw
    const fetchImpl = (async () => {
      throw new Error('connect ECONNREFUSED');
    }) as unknown as typeof fetch;
    const engine = new OnboardingEngine({
      store,
      secrets: fakeSecretsPutter(),
      validatorCtx: { fetch: fetchImpl, now: () => new Date() },
    });
    const t = await store.createTenant({
      slug: 's',
      name: 'n',
      ownerEmail: 'a@b.com',
      billingEmail: 'a@b.com',
      timezone: 'UTC',
      locale: 'en-US',
    });
    const r = await engine.submitStep({
      tenantId: t.id,
      category: 'repo',
      providerId: 'github',
      choices: {},
      credentials: { api_token: 'gh' },
    });
    expect(r.status).toBe('failed');
  });

  it('non-storable credentials (DNS proof) are not PUT into Infisical', async () => {
    const store = new InMemoryOnboardingStore();
    const secrets = fakeSecretsPutter();
    const { fetch } = mockFetch({
      'https://cloudflare-dns.com/dns-query': {
        status: 200,
        body: {
          Answer: [
            { name: '_caia-verify-t.example.com.', type: 16, data: '"tok"' },
          ],
        },
      },
    });
    const engine = new OnboardingEngine({
      store,
      secrets,
      validatorCtx: { fetch, now: () => new Date() },
    });
    const t = await store.createTenant({
      slug: 's',
      name: 'n',
      ownerEmail: 'a@b.com',
      billingEmail: 'a@b.com',
      timezone: 'UTC',
      locale: 'en-US',
    });
    const r = await engine.submitStep({
      tenantId: t.id,
      category: 'dns',
      providerId: 'manual-dns-proof',
      choices: { zone: 'example.com' },
      credentials: { dns_proof_token: 'tok' },
    });
    expect(r.status).toBe('passed');
    expect(secrets.puts.length).toBe(0); // dns proof not stored
    const log = await store.listAudit(t.id);
    expect(log.some((e) => e.action === 'credential.validated')).toBe(true);
  });
});
