import { describe, expect, it } from 'vitest';

import { executePlans, planRuns } from '../src/runner.js';
import type { RunAdapter, RunPlan, RunnerRawOutput } from '../src/types.js';
import { makeLoadedTicket, makeTestCase } from './fixtures/ticket-fixture.js';

function stubAdapter(responder: (plan: RunPlan) => RunnerRawOutput | Promise<RunnerRawOutput>): RunAdapter {
  return {
    async run(plan: RunPlan): Promise<RunnerRawOutput> {
      return responder(plan);
    },
  };
}

describe('planRuns', () => {
  it('groups unit + integration into a single vitest plan', () => {
    const ticket = makeLoadedTicket({
      testCases: [
        makeTestCase({ id: 'U1', title: 'unit a', category: 'happy', layer: 'unit' }),
        makeTestCase({ id: 'U2', title: 'unit b', category: 'happy', layer: 'unit' }),
        makeTestCase({ id: 'I1', title: 'integ a', category: 'happy', layer: 'integration' }),
      ],
      unitTestPaths: ['tests/unit/u.test.ts'],
      integrationTestPaths: ['tests/integration/i.test.ts'],
    });
    const plans = planRuns(ticket);
    expect(plans).toHaveLength(1);
    expect(plans[0]?.runner).toBe('vitest');
    expect(plans[0]?.cases.map((c) => c.id)).toEqual(['U1', 'U2', 'I1']);
    expect(plans[0]?.vitestFiles).toContain('tests/unit/u.test.ts');
    expect(plans[0]?.vitestFiles).toContain('tests/integration/i.test.ts');
  });

  it('routes layer=accessibility to axe and visual+performance to lighthouse', () => {
    const ticket = makeLoadedTicket({
      testCases: [
        makeTestCase({ id: 'A1', title: 'a11y', category: 'accessibility', layer: 'accessibility' }),
        makeTestCase({ id: 'P1', title: 'perf', category: 'performance', layer: 'visual' }),
        makeTestCase({ id: 'V1', title: 'visual', category: 'visual', layer: 'visual' }),
      ],
    });
    const plans = planRuns(ticket);
    const runners = plans.map((p) => p.runner);
    expect(runners).toEqual(expect.arrayContaining(['axe', 'lighthouse', 'playwright']));
    const lh = plans.find((p) => p.runner === 'lighthouse');
    expect(lh?.url).toBe('http://localhost:3000');
  });

  it('honours resolveBaseUrl override', () => {
    const ticket = makeLoadedTicket({
      testCases: [makeTestCase({ id: 'E', title: 'e', category: 'happy', layer: 'e2e' })],
    });
    const plans = planRuns(ticket, { resolveBaseUrl: () => 'https://staging.example.com' });
    expect(plans[0]?.url).toBe('https://staging.example.com');
  });

  it('honours resolveTestFile selector hint', () => {
    const ticket = makeLoadedTicket({
      testCases: [
        makeTestCase({
          id: 'U',
          title: 'unit',
          category: 'happy',
          layer: 'unit',
          selectorHints: ['src/lib.ts'],
        }),
      ],
    });
    const plans = planRuns(ticket, { resolveTestFile: () => 'custom.test.ts' });
    expect(plans[0]?.vitestFiles).toEqual(['custom.test.ts']);
  });

  it('treats selectorHints[0] that looks like a test file as the vitest file', () => {
    const ticket = makeLoadedTicket({
      testCases: [
        makeTestCase({
          id: 'U',
          title: 'unit',
          category: 'happy',
          layer: 'unit',
          selectorHints: ['./src/foo.test.ts'],
        }),
      ],
      unitTestPaths: [],
    });
    const plans = planRuns(ticket);
    expect(plans[0]?.vitestFiles).toEqual(['./src/foo.test.ts']);
  });
});

describe('executePlans', () => {
  it('passes parsed results through', async () => {
    const ticket = makeLoadedTicket({
      testCases: [makeTestCase({ id: 'TC-1', title: 'a', category: 'happy', layer: 'unit' })],
    });
    const plans = planRuns(ticket);
    const adapter = stubAdapter((plan) => ({
      runner: plan.runner,
      exitCode: 0,
      stdout: '',
      stderr: '',
      durationMs: 11,
      plan,
      jsonReport: {
        testResults: [
          {
            name: 'x.test.ts',
            assertionResults: [
              { fullName: 'TC-1 a', title: 'TC-1 a', status: 'passed', duration: 11 },
            ],
          },
        ],
      },
    }));
    const out = await executePlans(plans, adapter);
    expect(out).toHaveLength(1);
    expect(out[0]?.caseId).toBe('TC-1');
    expect(out[0]?.status).toBe('passed');
  });

  it('synthesises errored results when adapter rejects', async () => {
    const ticket = makeLoadedTicket({
      testCases: [makeTestCase({ id: 'TC-1', title: 'a', category: 'happy', layer: 'unit' })],
    });
    const plans = planRuns(ticket);
    const adapter: RunAdapter = {
      async run(): Promise<RunnerRawOutput> {
        throw new Error('spawn ENOENT');
      },
    };
    const out = await executePlans(plans, adapter);
    expect(out).toHaveLength(1);
    expect(out[0]?.status).toBe('errored');
    expect(out[0]?.errorMessage).toContain('spawn ENOENT');
  });

  it('synthesises errored results when runner exits non-zero with no parseable output', async () => {
    const ticket = makeLoadedTicket({
      testCases: [makeTestCase({ id: 'TC-1', title: 'a', category: 'happy', layer: 'unit' })],
    });
    const plans = planRuns(ticket);
    const adapter = stubAdapter((plan) => ({
      runner: plan.runner,
      exitCode: 2,
      stdout: 'garbage',
      stderr: 'broken',
      durationMs: 0,
      plan,
    }));
    const out = await executePlans(plans, adapter);
    expect(out).toHaveLength(1);
    expect(out[0]?.status).toBe('errored');
    expect(out[0]?.errorMessage).toContain('exited 2');
  });
});
