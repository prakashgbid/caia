/**
 * ImplementationEngine — CODING-003 unit tests.
 *
 * Drives the engine with the MockLlmAdapter to verify:
 *   - lifecycle (start once, send N, end)
 *   - implement loop terminates on DONE_MARKER
 *   - implement loop respects max-turn budget
 *   - applyFix loop terminates on FIX_APPLIED <sha>
 *   - prompt builder embeds bundle data deterministically (snapshot)
 *   - errors propagate as adapter-error status
 *
 * 11 cases.
 */

import {
  DONE_MARKER,
  ImplementationEngine,
  MockLlmAdapter,
} from '../src/implementation-engine';
import type { Bundle } from '../src/bundle-reader';
import type { Worktree } from '../src/worktree-manager';

function makeBundle(overrides: Partial<Bundle> = {}): Bundle {
  return {
    story: {
      id: 's1',
      title: 'add a /health endpoint',
      description: '',
      status: 'pending',
      rootPromptId: null,
      parentEntityId: null,
      parentEntityType: null,
      bucketId: 'bkt_a',
      templateVersion: 'v1',
      templateValidationStatus: 'pending',
      templateValidationErrors: null,
      enrichedAt: null,
      updatedAt: null,
    },
    ticket: {
      acceptanceCriteria: ['returns 200', 'returns { ok: true }'],
      claims: { files: ['apps/dashboard/app/health/route.ts'], schemas: [], apiRoutes: ['/health'], domains: [] },
      architecturalInstructions: [
        { kind: 'create', domain: 'frontend', text: 'create new Next.js route handler at app/health/route.ts' },
      ],
      agentSections: { backend: 'GET /health returns ok' },
      testCases: [
        { id: 'TC-001', title: 'happy path 200', category: 'happy' },
      ],
    },
    ticketParseError: null,
    prompt: null,
    requirement: null,
    bucket: { id: 'bkt_a', kind: 'parallel', domainSlug: null, sequenceIndex: null, status: 'open' },
    labels: [],
    dependencies: { upstream: [], downstream: [] },
    inputDependencies: [],
    ...overrides,
  };
}

function makeWorktree(): Worktree {
  return {
    storyId: 's1',
    path: '/tmp/wt/s1',
    branch: 'feat/s1-add-health',
    integrationBranch: 'main',
    createdAt: 1234,
  };
}

function makeEngine(opts: { adapter?: MockLlmAdapter; bundle?: Bundle } = {}) {
  const adapter = opts.adapter ?? new MockLlmAdapter();
  const engine = new ImplementationEngine({
    bundle: opts.bundle ?? makeBundle(),
    worktree: makeWorktree(),
    adapter,
    sessionId: 'sess_test',
    maxImplementTurns: 5,
    maxFixTurns: 3,
  });
  return { engine, adapter };
}

describe('ImplementationEngine — lifecycle', () => {
  it('start() opens the SDK session with the right metadata', async () => {
    const { engine, adapter } = makeEngine();
    await engine.start();
    expect(adapter.startCalls).toHaveLength(1);
    expect(adapter.startCalls[0]!.sessionId).toBe('sess_test');
    expect(adapter.startCalls[0]!.cwd).toBe('/tmp/wt/s1');
    await engine.end();
  });

  it('start() called twice throws', async () => {
    const { engine } = makeEngine();
    await engine.start();
    await expect(engine.start()).rejects.toThrow(/twice/);
    await engine.end();
  });

  it('end() is idempotent', async () => {
    const { engine, adapter } = makeEngine();
    await engine.start();
    await engine.end();
    await engine.end();
    expect(adapter.endCalls).toBe(1);
  });

  it('start() after end() throws', async () => {
    const { engine } = makeEngine();
    await engine.start();
    await engine.end();
    await expect(engine.start()).rejects.toThrow(/end/);
  });
});

describe('ImplementationEngine — implement', () => {
  it('returns done on first turn when adapter emits DONE_MARKER', async () => {
    const { engine, adapter } = makeEngine();
    adapter.enqueue({ text: `building...\n${DONE_MARKER}`, done: true });
    await engine.start();
    const r = await engine.implement();
    expect(r.status).toBe('done');
    expect(r.turns).toBe(1);
    expect(r.totalTokens.input).toBe(100);
    await engine.end();
  });

  it('iterates multiple turns until DONE_MARKER', async () => {
    const { engine, adapter } = makeEngine();
    adapter.enqueue({ text: 'thinking...' });
    adapter.enqueue({ text: 'still thinking...' });
    adapter.enqueue({ text: `${DONE_MARKER}`, done: true });
    await engine.start();
    const r = await engine.implement();
    expect(r.status).toBe('done');
    expect(r.turns).toBe(3);
    expect(r.totalTokens.input).toBe(300);
    expect(r.totalTokens.output).toBe(150);
    await engine.end();
  });

  it('hits turn-limit when DONE_MARKER never arrives', async () => {
    const { engine, adapter } = makeEngine();
    for (let i = 0; i < 5; i++) adapter.enqueue({ text: `t${i}` });
    await engine.start();
    const r = await engine.implement();
    expect(r.status).toBe('turn-limit');
    expect(r.turns).toBe(5);
    await engine.end();
  });

  it('returns adapter-error when send() throws', async () => {
    const adapter = new MockLlmAdapter();   // empty queue → throws on first send
    const { engine } = makeEngine({ adapter });
    await engine.start();
    const r = await engine.implement();
    expect(r.status).toBe('adapter-error');
    expect(r.turns).toBe(1);
    await engine.end();
  });

  it('throws if implement() called before start()', async () => {
    const { engine } = makeEngine();
    await expect(engine.implement()).rejects.toThrow(/start/);
  });
});

describe('ImplementationEngine — applyFix', () => {
  it('returns fix-applied on first turn with parsed sha', async () => {
    const { engine, adapter } = makeEngine();
    adapter.enqueue({ text: 'fixed.\nFIX_APPLIED abc1234', fixApplied: true, fixSha: 'abc1234' });
    await engine.start();
    const r = await engine.applyFix({
      testCaseId: 'TC-001',
      whatFailed: 'expected 200, got 500',
      hypothesis: 'route handler returning Response from wrong import',
    });
    expect(r.status).toBe('fix-applied');
    expect(r.sha).toBe('abc1234');
    expect(r.turns).toBe(1);
    await engine.end();
  });

  it('hits turn-limit when fix is never applied', async () => {
    const { engine, adapter } = makeEngine();
    for (let i = 0; i < 3; i++) adapter.enqueue({ text: `t${i}` });
    await engine.start();
    const r = await engine.applyFix({ testCaseId: 'TC-001', whatFailed: 'x', hypothesis: 'y' });
    expect(r.status).toBe('turn-limit');
    expect(r.sha).toBeNull();
    await engine.end();
  });
});

describe('ImplementationEngine — system prompt', () => {
  it('embeds story, AC, claims, instructions, test cases', () => {
    const { engine } = makeEngine();
    const prompt = engine.buildSystemPrompt();
    expect(prompt).toContain('Story id:    s1');
    expect(prompt).toContain('add a /health endpoint');
    expect(prompt).toContain('returns 200');
    expect(prompt).toContain('returns { ok: true }');
    expect(prompt).toContain('apps/dashboard/app/health/route.ts');
    expect(prompt).toContain('/health');
    expect(prompt).toContain('[create/frontend]');
    expect(prompt).toContain('TC-001');
    expect(prompt).toContain(DONE_MARKER);
    expect(prompt).toContain('FIX_APPLIED');
  });

  it('handles missing architecturalInstructions gracefully', () => {
    const bundle = makeBundle();
    delete (bundle.ticket as Record<string, unknown>).architecturalInstructions;
    const { engine } = makeEngine({ bundle });
    const prompt = engine.buildSystemPrompt();
    expect(prompt).toContain('(none yet — fall back to agentSections)');
  });
});
