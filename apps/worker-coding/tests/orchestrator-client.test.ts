/**
 * CODING-007 — OrchestratorClient tests.
 *
 * Validates that each of the four lifecycle endpoints produces the right
 * verb + path + body, and that non-2xx responses surface as Errors.
 */

import { OrchestratorClient } from '../src/orchestrator-client';

interface CapturedCall {
  url: string;
  method: string;
  headers: Record<string, string>;
  body: unknown;
}

function makeFetch(replies: Array<{ status?: number; body: unknown }>): {
  fetchImpl: typeof fetch;
  calls: CapturedCall[];
} {
  const calls: CapturedCall[] = [];
  let i = 0;
  const fetchImpl: typeof fetch = (async (url: string, init: RequestInit = {}) => {
    const reply = replies[i++] ?? { status: 200, body: {} };
    const headers: Record<string, string> = {};
    const initHeaders = init.headers as Record<string, string> | undefined;
    if (initHeaders) Object.assign(headers, initHeaders);
    calls.push({
      url,
      method: init.method ?? 'GET',
      headers,
      body: init.body ? JSON.parse(init.body as string) : undefined,
    });
    return new Response(JSON.stringify(reply.body), {
      status: reply.status ?? 200,
      headers: { 'content-type': 'application/json' },
    });
  }) as unknown as typeof fetch;
  return { fetchImpl, calls };
}

describe('OrchestratorClient', () => {
  it('register POSTs to /api/workers/register and returns the workerId', async () => {
    const { fetchImpl, calls } = makeFetch([{ body: { workerId: 'wkr_42' } }]);
    const c = new OrchestratorClient({ baseUrl: 'http://orc:7776', fetchImpl });
    const r = await c.register({ kind: 'coding', socketPath: '/tmp/x.sock' });
    expect(r.workerId).toBe('wkr_42');
    expect(calls[0]?.url).toBe('http://orc:7776/api/workers/register');
    expect(calls[0]?.method).toBe('POST');
    expect((calls[0]?.body as { kind: string }).kind).toBe('coding');
    expect((calls[0]?.body as { socketPath: string }).socketPath).toBe('/tmp/x.sock');
  });

  it('strips trailing slash from baseUrl', async () => {
    const { fetchImpl, calls } = makeFetch([{ body: { workerId: 'w' } }]);
    const c = new OrchestratorClient({ baseUrl: 'http://orc:7776/', fetchImpl });
    await c.register({ kind: 'coding', socketPath: '/tmp/x.sock' });
    expect(calls[0]?.url).toBe('http://orc:7776/api/workers/register');
  });

  it('heartbeat POSTs to /api/workers/:id/heartbeat', async () => {
    const { fetchImpl, calls } = makeFetch([
      { body: { ok: true, status: 'busy', currentStoryId: 's_1' } },
    ]);
    const c = new OrchestratorClient({ baseUrl: 'http://orc:7776', fetchImpl });
    const r = await c.heartbeat('wkr_42');
    expect(r.ok).toBe(true);
    expect(r.status).toBe('busy');
    expect(r.currentStoryId).toBe('s_1');
    expect(calls[0]?.url).toBe('http://orc:7776/api/workers/wkr_42/heartbeat');
    expect(calls[0]?.method).toBe('POST');
  });

  it('getAssignment returns null when no story is assigned', async () => {
    const { fetchImpl, calls } = makeFetch([{ body: { assignment: null } }]);
    const c = new OrchestratorClient({ baseUrl: 'http://orc:7776', fetchImpl });
    const r = await c.getAssignment('wkr_42');
    expect(r.assignment).toBeNull();
    expect(calls[0]?.method).toBe('GET');
    expect(calls[0]?.url).toBe('http://orc:7776/api/workers/wkr_42/assignment');
  });

  it('getAssignment returns the assigned story', async () => {
    const { fetchImpl } = makeFetch([
      { body: { assignment: { storyId: 's_1', bucketId: 'b_main', assignedAt: 12345 } } },
    ]);
    const c = new OrchestratorClient({ baseUrl: 'http://orc:7776', fetchImpl });
    const r = await c.getAssignment('wkr_42');
    expect(r.assignment?.storyId).toBe('s_1');
    expect(r.assignment?.bucketId).toBe('b_main');
  });

  it('release POSTs the reason', async () => {
    const { fetchImpl, calls } = makeFetch([{ body: { ok: true } }]);
    const c = new OrchestratorClient({ baseUrl: 'http://orc:7776', fetchImpl });
    await c.release('wkr_42', { reason: 'task-completed' });
    expect((calls[0]?.body as { reason: string }).reason).toBe('task-completed');
    expect(calls[0]?.url).toBe('http://orc:7776/api/workers/wkr_42/release');
  });

  it('throws on non-2xx', async () => {
    const { fetchImpl } = makeFetch([{ status: 500, body: { error: 'boom' } }]);
    const c = new OrchestratorClient({ baseUrl: 'http://orc:7776', fetchImpl });
    await expect(c.heartbeat('wkr_42')).rejects.toThrow(/500/);
  });

  it('encodes worker ids with weird chars', async () => {
    const { fetchImpl, calls } = makeFetch([{ body: { ok: true, status: 'idle', currentStoryId: null } }]);
    const c = new OrchestratorClient({ baseUrl: 'http://orc:7776', fetchImpl });
    await c.heartbeat('wkr/with/slash');
    expect(calls[0]?.url).toBe('http://orc:7776/api/workers/wkr%2Fwith%2Fslash/heartbeat');
  });

  it('sends content-type: application/json on POSTs', async () => {
    const { fetchImpl, calls } = makeFetch([{ body: { workerId: 'w' } }]);
    const c = new OrchestratorClient({ baseUrl: 'http://orc:7776', fetchImpl });
    await c.register({ kind: 'coding', socketPath: '/tmp/x.sock' });
    expect(calls[0]?.headers['content-type']).toBe('application/json');
  });
});
