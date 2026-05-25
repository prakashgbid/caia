import { describe, expect, it } from 'vitest';

import { InMemoryStateStore, StateMachine } from '@caia/state-machine';

import { buildPrComment, runStoryTests } from '../src/api.js';
import type {
  LoadedTicket,
  RunAdapter,
  RunPlan,
  RunnerRawOutput,
  TestCaseResult,
  TicketStore,
} from '../src/types.js';
import { makeLoadedTicket, makeTestCase } from './fixtures/ticket-fixture.js';

function staticStore(ticket: LoadedTicket): TicketStore {
  return {
    async loadTicket(): Promise<LoadedTicket> {
      return ticket;
    },
  };
}

function stubAdapter(responder: (plan: RunPlan) => RunnerRawOutput): RunAdapter {
  return {
    async run(plan: RunPlan): Promise<RunnerRawOutput> {
      return responder(plan);
    },
  };
}

function vitestReport(caseId: string, title: string, status: 'passed' | 'failed', failureMessages: string[] = []): unknown {
  return {
    testResults: [
      {
        name: 'tests/unit/x.test.ts',
        assertionResults: [
          {
            fullName: `${caseId} ${title}`,
            title: `${caseId} ${title}`,
            status,
            duration: 5,
            ...(failureMessages.length > 0 ? { failureMessages } : {}),
          },
        ],
      },
    ],
  };
}

async function setupStateMachine(projectId: string): Promise<StateMachine> {
  const store = new InMemoryStateStore();
  const sm = new StateMachine(store);
  await sm.init();
  await sm.createProject({
    id: projectId,
    tenantId: 'test',
    slug: 'test-slug',
    displayName: 'Test Project',
    initialState: 'code-complete',
  });
  return sm;
}

describe('runStoryTests', () => {
  it('returns status=passed when all required cases pass and applies the per-story-tested transition', async () => {
    const ticket = makeLoadedTicket({
      ticketId: 'TKT-PASS',
      projectId: 'proj-pass',
      testCases: [makeTestCase({ id: 'TC-1', title: 'happy', category: 'happy', layer: 'unit' })],
    });
    const sm = await setupStateMachine('proj-pass');
    const adapter = stubAdapter((plan) => ({
      runner: plan.runner,
      exitCode: 0,
      stdout: '',
      stderr: '',
      durationMs: 5,
      plan,
      jsonReport: vitestReport('TC-1', 'happy', 'passed'),
    }));

    const out = await runStoryTests('TKT-PASS', {
      store: staticStore(ticket),
      adapter,
      stateMachine: sm,
    });

    expect(out.status).toBe('passed');
    expect(out.summary.requiredFailures).toBe(0);
    expect(out.prComment).toBeUndefined();
    expect(out.transition?.applied).toBe(true);
    expect(out.transition?.toState).toBe('per-story-tested');
    const project = await sm.getProject('proj-pass');
    expect(project?.status).toBe('per-story-tested');
  });

  it('returns status=failed, builds prComment, and transitions to per-story-test-failed when a required case fails', async () => {
    const ticket = makeLoadedTicket({
      ticketId: 'TKT-FAIL',
      projectId: 'proj-fail',
      testCases: [
        makeTestCase({ id: 'TC-1', title: 'broken', category: 'happy', layer: 'unit' }),
        makeTestCase({
          id: 'TC-2',
          title: 'opt-passes',
          category: 'happy',
          layer: 'unit',
          required: false,
        }),
      ],
    });
    const sm = await setupStateMachine('proj-fail');
    const adapter = stubAdapter((plan) => ({
      runner: plan.runner,
      exitCode: 1,
      stdout: '',
      stderr: '',
      durationMs: 5,
      plan,
      jsonReport: {
        testResults: [
          {
            name: 'tests/unit/x.test.ts',
            assertionResults: [
              {
                fullName: 'TC-1 broken',
                title: 'TC-1 broken',
                status: 'failed',
                duration: 5,
                failureMessages: ['AssertionError: nope'],
              },
              {
                fullName: 'TC-2 opt-passes',
                title: 'TC-2 opt-passes',
                status: 'passed',
                duration: 5,
              },
            ],
          },
        ],
      },
    }));

    const out = await runStoryTests('TKT-FAIL', {
      store: staticStore(ticket),
      adapter,
      stateMachine: sm,
    });

    expect(out.status).toBe('failed');
    expect(out.summary.requiredFailures).toBe(1);
    expect(out.prComment).toBeDefined();
    expect(out.prComment?.requestChanges).toBe(true);
    expect(out.prComment?.threads[0]?.caseId).toBe('TC-1');
    expect(out.transition?.applied).toBe(true);
    expect(out.transition?.toState).toBe('per-story-test-failed');
    const project = await sm.getProject('proj-fail');
    expect(project?.status).toBe('per-story-test-failed');
  });

  it('skips state-machine transition when skipStateMachine=true', async () => {
    const ticket = makeLoadedTicket({
      ticketId: 'TKT-SKIP',
      projectId: 'proj-skip',
      testCases: [makeTestCase({ id: 'TC-1', title: 'a', category: 'happy', layer: 'unit' })],
    });
    const sm = await setupStateMachine('proj-skip');
    const adapter = stubAdapter((plan) => ({
      runner: plan.runner,
      exitCode: 0,
      stdout: '',
      stderr: '',
      durationMs: 1,
      plan,
      jsonReport: vitestReport('TC-1', 'a', 'passed'),
    }));
    const out = await runStoryTests('TKT-SKIP', {
      store: staticStore(ticket),
      adapter,
      stateMachine: sm,
      skipStateMachine: true,
    });
    expect(out.transition).toBeUndefined();
    const project = await sm.getProject('proj-skip');
    expect(project?.status).toBe('code-complete');
  });

  it('records a project-not-found transition outcome when the project does not exist', async () => {
    const ticket = makeLoadedTicket({
      ticketId: 'TKT-NF',
      projectId: 'proj-missing',
      testCases: [makeTestCase({ id: 'TC-1', title: 'a', category: 'happy', layer: 'unit' })],
    });
    const store = new InMemoryStateStore();
    const sm = new StateMachine(store);
    await sm.init();
    const adapter = stubAdapter((plan) => ({
      runner: plan.runner,
      exitCode: 0,
      stdout: '',
      stderr: '',
      durationMs: 1,
      plan,
      jsonReport: vitestReport('TC-1', 'a', 'passed'),
    }));
    const out = await runStoryTests('TKT-NF', {
      store: staticStore(ticket),
      adapter,
      stateMachine: sm,
    });
    expect(out.transition?.applied).toBe(false);
    expect(out.transition?.reason).toContain('not found');
  });

  it('treats missing case results as skipped (deterministic order)', async () => {
    const ticket = makeLoadedTicket({
      ticketId: 'TKT-MISS',
      projectId: 'proj-miss',
      testCases: [
        makeTestCase({ id: 'TC-1', title: 'a', category: 'happy', layer: 'unit', required: false }),
        makeTestCase({ id: 'TC-2', title: 'b', category: 'happy', layer: 'unit', required: false }),
      ],
    });
    const adapter = stubAdapter((plan) => ({
      runner: plan.runner,
      exitCode: 0,
      stdout: '',
      stderr: '',
      durationMs: 1,
      plan,
      jsonReport: vitestReport('TC-1', 'a', 'passed'),
    }));
    const out = await runStoryTests('TKT-MISS', {
      store: staticStore(ticket),
      adapter,
      skipStateMachine: true,
    });
    expect(out.perCase.map((p) => p.caseId)).toEqual(['TC-1', 'TC-2']);
    expect(out.perCase[1]?.status).toBe('skipped');
  });
});

describe('buildPrComment', () => {
  it('summarises failures into threads', () => {
    const loaded = makeLoadedTicket();
    const perCase: TestCaseResult[] = [
      {
        caseId: 'TC-X',
        testName: 'broken',
        file: 'src/foo.ts',
        line: 42,
        layer: 'unit',
        category: 'happy',
        runner: 'vitest',
        status: 'failed',
        durationMs: 5,
        errorMessage: 'expected true to be false',
      },
    ];
    const comment = buildPrComment(perCase, loaded);
    expect(comment.requestChanges).toBe(true);
    expect(comment.threads).toHaveLength(1);
    expect(comment.threads[0]?.line).toBe(42);
    expect(comment.body).toContain('TC-X');
    expect(comment.body).toContain('src/foo.ts:42');
  });
});
