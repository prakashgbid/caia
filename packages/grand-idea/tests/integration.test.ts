/**
 * End-to-end integration: API handler → MemoryGrandIdeaPersistence →
 * StateMachine (in-memory) → idea-captured. Validates the row-write +
 * FSM-advance composition.
 */

import { describe, expect, it } from 'vitest';

import { InMemoryStateStore, StateMachine } from '@caia/state-machine';

import {
  MemoryGrandIdeaPersistence,
  StaticAccessVerifier,
  createCaptureHandler,
} from '../src/index.js';

async function buildPipeline() {
  const mem = new MemoryGrandIdeaPersistence({ tenantSchema: 'caia_pt' });
  mem.addTenant({
    id: 'tenant-1',
    slug: 'prakash-tiwari',
    schemaName: 'caia_pt',
    onboardingComplete: true,
  });
  const store = new InMemoryStateStore();
  const sm = new StateMachine(store);
  await sm.init();
  const projectId = '55555555-5555-5555-5555-555555555555';
  await sm.createProject({
    id: projectId,
    tenantId: 'tenant-1',
    slug: 'prakash-tiwari',
    displayName: 'Test',
    initialState: 'onboarding',
  });
  const handler = createCaptureHandler({
    persistence: mem,
    stateMachine: sm,
    accessVerifier: new StaticAccessVerifier('founder@example.com'),
  });
  return { handler, mem, sm, projectId };
}

describe('end-to-end integration', () => {
  it('advances the project through onboarding → idea-captured on first capture', async () => {
    const { handler, sm, projectId } = await buildPipeline();
    expect(await sm.currentState(projectId)).toBe('onboarding');
    const res = await handler({
      body: {
        tenantSlug: 'prakash-tiwari',
        projectId,
        prompt: 'A community-driven directory of open APIs with quality scores.',
      },
      headers: {},
    });
    expect(res.status).toBe(201);
    expect(await sm.currentState(projectId)).toBe('idea-captured');
  });

  it('supports re-capture: a second call writes a new revision; FSM stays in idea-captured', async () => {
    const { handler, sm, mem, projectId } = await buildPipeline();
    await handler({
      body: {
        tenantSlug: 'prakash-tiwari',
        projectId,
        prompt: 'first revision describes the original founder idea here',
      },
      headers: {},
    });
    const res2 = await handler({
      body: {
        tenantSlug: 'prakash-tiwari',
        projectId,
        prompt: 'second revision pivots the idea to a different audience now',
      },
      headers: {},
    });
    expect(res2.status).toBe(201);
    if (!res2.body.ok) throw new Error('expected ok');
    expect(res2.body.revisionNumber).toBe(2);
    expect(res2.body.fsmAdvanced).toBe(false); // already in idea-captured
    expect(mem.listRows().length).toBe(2);
    expect(await sm.currentState(projectId)).toBe('idea-captured');
  });

  it('produces stable IDs and the latest row is the most-recent revision', async () => {
    const { handler, mem, projectId } = await buildPipeline();
    for (let i = 0; i < 3; i++) {
      await handler({
        body: {
          tenantSlug: 'prakash-tiwari',
          projectId,
          prompt: `revision number ${i + 1} for the project with enough words to pass`,
        },
        headers: {},
      });
    }
    const rows = mem.listRows();
    expect(rows.length).toBe(3);
    const latest = await mem.readLatestGrandIdea(projectId);
    expect(latest?.revisionNumber).toBe(3);
  });

  it('blocks captures from a non-onboarded tenant', async () => {
    const mem = new MemoryGrandIdeaPersistence({ tenantSchema: 'caia_pt' });
    mem.addTenant({
      id: 'tenant-1',
      slug: 'acme',
      schemaName: 'caia_pt',
      onboardingComplete: false,
    });
    const store = new InMemoryStateStore();
    const sm = new StateMachine(store);
    await sm.init();
    const projectId = '66666666-6666-6666-6666-666666666666';
    await sm.createProject({
      id: projectId,
      tenantId: 'tenant-1',
      slug: 'acme',
      displayName: 'Test',
      initialState: 'onboarding',
    });
    const handler = createCaptureHandler({
      persistence: mem,
      stateMachine: sm,
      accessVerifier: new StaticAccessVerifier('founder@example.com'),
    });
    const res = await handler({
      body: {
        tenantSlug: 'acme',
        projectId,
        prompt: 'A long enough prompt that passes the validation floor easily',
      },
      headers: {},
    });
    expect(res.status).toBe(409);
    expect(await sm.currentState(projectId)).toBe('onboarding'); // unchanged
  });

  it('captured rows record metadata when supplied', async () => {
    const { handler, mem, projectId } = await buildPipeline();
    await handler({
      body: {
        tenantSlug: 'prakash-tiwari',
        projectId,
        prompt: 'A directory with quality scores for open APIs and SLAs.',
        metadata: { source: 'admin-ui', browser: 'firefox' },
      },
      headers: {},
    });
    expect(mem.listRows()[0]?.metadata).toEqual({
      source: 'admin-ui',
      browser: 'firefox',
    });
  });
});
