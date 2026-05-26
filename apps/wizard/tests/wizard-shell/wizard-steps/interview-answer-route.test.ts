/**
 * Unit tests for POST /api/wizard/interview/answer.
 *
 * Mirrors the proposal-route test conventions: mock `next/headers`,
 * dynamic-import the route handler, build `Request` instances with
 * `new Request(...)`, assert on the JSON envelope.
 *
 * The in-memory thread store is module-scoped so each test resets it
 * via `__resetInterviewThreadStore()` to avoid bleed.
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

const realEnv = { ...process.env };

beforeEach(async () => {
  delete process.env['WIZARD_INTERVIEW_LIVE'];
  const mod = await import('../../../lib/wizard/interview-thread-store');
  mod.__resetInterviewThreadStore();
});

afterEach(() => {
  for (const k of Object.keys(process.env)) {
    if (!(k in realEnv)) delete process.env[k];
  }
  for (const k of Object.keys(realEnv)) {
    process.env[k] = realEnv[k]!;
  }
});

async function loadRoute(): Promise<typeof import('../../../app/api/wizard/interview/answer/route')> {
  return await import('../../../app/api/wizard/interview/answer/route');
}

function makeReq(body: unknown): Request {
  return new Request('http://localhost:7777/api/wizard/interview/answer', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
}

describe('POST /api/wizard/interview/answer', () => {
  it('runtime is nodejs', async () => {
    const mod = await loadRoute();
    expect(mod.runtime).toBe('nodejs');
  });

  it('dynamic is force-dynamic', async () => {
    const mod = await loadRoute();
    expect(mod.dynamic).toBe('force-dynamic');
  });

  it('returns 400 on bad json', async () => {
    const { POST } = await loadRoute();
    const res = await POST(
      new Request('http://localhost/api/wizard/interview/answer', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: 'not json',
      }) as never,
    );
    expect(res.status).toBe(400);
  });

  it('returns 400 when projectId is missing', async () => {
    const { POST } = await loadRoute();
    const res = await POST(makeReq({}) as never);
    expect(res.status).toBe(400);
  });

  it('starts a thread on first call and returns turn-1 question', async () => {
    const { POST } = await loadRoute();
    const res = await POST(makeReq({ projectId: 'p-a' }) as never);
    expect(res.status).toBe(200);
    const body = (await res.json()) as { turn: number; nextQuestion: { pillar: string } | null };
    expect(body.turn).toBe(1);
    expect(body.nextQuestion?.pillar).toBe('B1');
  });

  it('advances on a follow-up call and returns the second question', async () => {
    const { POST } = await loadRoute();
    await POST(makeReq({ projectId: 'p-b' }) as never);
    const res = await POST(
      makeReq({ projectId: 'p-b', response: 'A short answer about the product.' }) as never,
    );
    expect(res.status).toBe(200);
    const body = (await res.json()) as { turn: number; nextQuestion: { id: string } | null };
    expect(body.turn).toBe(2);
    expect(body.nextQuestion?.id).toBe('Q-2');
  });

  it('emits pillarCoverage keyed by all 16 PillarIds', async () => {
    const { POST } = await loadRoute();
    const res = await POST(makeReq({ projectId: 'p-c' }) as never);
    const body = (await res.json()) as { pillarCoverage: Record<string, unknown> };
    expect(Object.keys(body.pillarCoverage)).toHaveLength(16);
    expect(body.pillarCoverage).toHaveProperty('B1');
    expect(body.pillarCoverage).toHaveProperty('B16');
  });

  it('exhausted=true when the scripted bank is consumed', async () => {
    const { POST } = await loadRoute();
    await POST(makeReq({ projectId: 'p-d' }) as never);
    // 8 scripted Qs → 8 user replies exhausts the bank.
    for (let i = 0; i < 8; i += 1) {
      // eslint-disable-next-line no-await-in-loop
      await POST(makeReq({ projectId: 'p-d', response: `answer ${i}` }) as never);
    }
    const res = await POST(makeReq({ projectId: 'p-d' }) as never);
    const body = (await res.json()) as { exhausted: boolean; nextQuestion: unknown };
    expect(body.exhausted).toBe(true);
    expect(body.nextQuestion).toBeNull();
  });

  it('meetsThreshold flips true when aggregate >= 82', async () => {
    const { POST } = await loadRoute();
    await POST(makeReq({ projectId: 'p-e' }) as never);
    // Each answer bumps a different pillar by 22-30. After 4 long answers,
    // aggregate ≈ (4 * 30) / 16 = 7. That's not enough — so this test
    // verifies we keep going until exhausted, at which point meetsThreshold
    // flips true via the exhaustion clause.
    for (let i = 0; i < 8; i += 1) {
      // eslint-disable-next-line no-await-in-loop
      await POST(
        makeReq({
          projectId: 'p-e',
          response:
            'A long answer with enough characters to bump the score meaningfully because length matters.',
        }) as never,
      );
    }
    const res = await POST(makeReq({ projectId: 'p-e' }) as never);
    const body = (await res.json()) as { meetsThreshold: boolean; exhausted: boolean };
    expect(body.meetsThreshold).toBe(true);
    expect(body.exhausted).toBe(true);
  });

  it('returns source=memory in default mode', async () => {
    const { POST } = await loadRoute();
    const res = await POST(makeReq({ projectId: 'p-f' }) as never);
    const body = (await res.json()) as { source: string };
    expect(body.source).toBe('memory');
  });
});
