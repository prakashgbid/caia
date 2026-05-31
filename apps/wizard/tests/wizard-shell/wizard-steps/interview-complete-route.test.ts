/**
 * Unit tests for POST /api/wizard/interview/complete.
 *
 * Mocks `next/headers` for the tenant id, mocks the store-wire factory
 * + state.server lookup to control the FSM snapshot, and verifies:
 *   - 401 without tenant
 *   - 400 without projectId
 *   - 404 when no thread exists
 *   - 412 when coverage is below threshold (and no force)
 *   - 200 when force=true bypasses threshold
 *   - 200 with idempotent re-entry when already complete
 *   - 409 when FSM cannot transition
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('next/headers', () => ({
  headers: async () => ({
    get(name: string) {
      if (name === 'x-tenant-id') return 'tenant-test';
      return null;
    },
  }),
}));

// Mock the wizard state-machine wiring. The route imports from these
// paths so the mocks intercept cleanly.
const mockSnapshot = vi.hoisted(() => ({
  current: { state: 'interviewing' as string },
}));

const transitionSpy = vi.hoisted(() => vi.fn(async () => undefined));

vi.mock('@caia/state-machine', async () => {
  return {
    canTransition: (from: string, to: string) => {
      if (from === 'interviewing' && to === 'interview-complete') return true;
      if (from === 'interview-complete') return false;
      return false;
    },
    StateMachine: class {
      transition = transitionSpy;
    },
  };
});

vi.mock('../../../lib/wizard/store-wire', () => ({
  getStateStoreForTenant: async () => ({ __mock: true }),
}));

// Mock the NATS publisher + pool wiring added by WIZARD-B5 so the route
// doesn't try to open a real Postgres pool from inside the unit test.
vi.mock('../../../lib/tenants/wire', () => ({
  getFsmPublisher: async () => ({ publish: async () => undefined }),
  getPool: () => ({
    query: async () => ({ rowCount: 1, rows: [{ schema_name: 'tenant_test' }] }),
  }),
}));

vi.mock('../../../lib/wizard/state.server', async (orig) => {
  const real = (await orig()) as Record<string, unknown>;
  return {
    ...real,
    getWizardState: async () => ({
      projectId: 'p-x',
      state: mockSnapshot.current.state,
      currentStepIndex: 3,
      updatedAtIso: '2026-05-26T00:00:00.000Z',
    }),
  };
});

beforeEach(async () => {
  transitionSpy.mockClear();
  mockSnapshot.current.state = 'interviewing';
  const mod = await import('../../../lib/wizard/interview-thread-store');
  mod.__resetInterviewThreadStore();
});

afterEach(() => {
  // nothing — env-free route.
});

async function loadCompleteRoute(): Promise<
  typeof import('../../../app/api/wizard/interview/complete/route')
> {
  return await import('../../../app/api/wizard/interview/complete/route');
}

async function loadAnswerRoute(): Promise<
  typeof import('../../../app/api/wizard/interview/answer/route')
> {
  return await import('../../../app/api/wizard/interview/answer/route');
}

function makeReq(path: string, body: unknown): Request {
  return new Request(`http://localhost:7777${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
}

async function seedThreadAndExhaust(projectId: string): Promise<void> {
  const { POST } = await loadAnswerRoute();
  await POST(makeReq('/api/wizard/interview/answer', { projectId }) as never);
  for (let i = 0; i < 8; i += 1) {
    // eslint-disable-next-line no-await-in-loop
    await POST(
      makeReq('/api/wizard/interview/answer', {
        projectId,
        response: 'A long enough answer with plenty of characters to bump the per-pillar score.',
      }) as never,
    );
  }
}

describe('POST /api/wizard/interview/complete', () => {
  it('returns 400 on bad json', async () => {
    const { POST } = await loadCompleteRoute();
    const res = await POST(
      new Request('http://localhost/api/wizard/interview/complete', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: 'not json',
      }) as never,
    );
    expect(res.status).toBe(400);
  });

  it('returns 400 when projectId is missing', async () => {
    const { POST } = await loadCompleteRoute();
    const res = await POST(makeReq('/api/wizard/interview/complete', {}) as never);
    expect(res.status).toBe(400);
  });

  it('returns 404 when no thread was started for the project', async () => {
    const { POST } = await loadCompleteRoute();
    const res = await POST(
      makeReq('/api/wizard/interview/complete', { projectId: 'p-nothread' }) as never,
    );
    expect(res.status).toBe(404);
  });

  it('returns 412 when coverage is below threshold and force is not set', async () => {
    const answer = await loadAnswerRoute();
    await answer.POST(
      makeReq('/api/wizard/interview/answer', { projectId: 'p-low' }) as never,
    );
    // Only one short reply — aggregate stays low.
    await answer.POST(
      makeReq('/api/wizard/interview/answer', { projectId: 'p-low', response: 'x' }) as never,
    );
    const { POST } = await loadCompleteRoute();
    const res = await POST(
      makeReq('/api/wizard/interview/complete', { projectId: 'p-low' }) as never,
    );
    expect(res.status).toBe(412);
    const body = (await res.json()) as { error: string };
    expect(body.error).toBe('coverage-below-threshold');
  });

  it('returns 200 + dispatches transition when force=true even with low coverage', async () => {
    const answer = await loadAnswerRoute();
    await answer.POST(
      makeReq('/api/wizard/interview/answer', { projectId: 'p-force' }) as never,
    );
    const { POST } = await loadCompleteRoute();
    const res = await POST(
      makeReq('/api/wizard/interview/complete', { projectId: 'p-force', force: true }) as never,
    );
    expect(res.status).toBe(200);
    expect(transitionSpy).toHaveBeenCalledWith(
      'p-force',
      'interview-complete',
      expect.objectContaining({ reason: 'operator-force-close' }),
    );
  });

  it('returns 200 + dispatches transition when coverage clears threshold (exhausted)', async () => {
    await seedThreadAndExhaust('p-ok');
    const { POST } = await loadCompleteRoute();
    const res = await POST(
      makeReq('/api/wizard/interview/complete', { projectId: 'p-ok' }) as never,
    );
    expect(res.status).toBe(200);
    expect(transitionSpy).toHaveBeenCalledWith(
      'p-ok',
      'interview-complete',
      expect.objectContaining({ reason: 'critic-coverage-sufficient' }),
    );
  });

  it('idempotent: returns 200 when project is already at interview-complete', async () => {
    await seedThreadAndExhaust('p-idem');
    mockSnapshot.current.state = 'interview-complete';
    const { POST } = await loadCompleteRoute();
    const res = await POST(
      makeReq('/api/wizard/interview/complete', { projectId: 'p-idem' }) as never,
    );
    expect(res.status).toBe(200);
    const body = (await res.json()) as { alreadyAdvanced?: boolean };
    expect(body.alreadyAdvanced).toBe(true);
  });

  it('returns 409 when FSM forbids the transition', async () => {
    await seedThreadAndExhaust('p-bad');
    mockSnapshot.current.state = 'proposal-generated'; // canTransition returns false from this
    const { POST } = await loadCompleteRoute();
    const res = await POST(
      makeReq('/api/wizard/interview/complete', { projectId: 'p-bad' }) as never,
    );
    expect(res.status).toBe(409);
  });

  it('runtime is nodejs', async () => {
    const mod = await loadCompleteRoute();
    expect(mod.runtime).toBe('nodejs');
  });

  it('dynamic is force-dynamic', async () => {
    const mod = await loadCompleteRoute();
    expect(mod.dynamic).toBe('force-dynamic');
  });
});
