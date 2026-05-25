import { describe, it, expect } from 'vitest';

import { TestAuthorAgent, DEFAULT_BUDGET } from '../src/agent.js';
import {
  buildFakeInput,
  fakeGoldenSpawner,
  fakeSpawnerReturning,
  goldenAssistantText
} from './helpers/fakes.js';

const FIXED_NOW = 1_716_624_000_000;

describe('TestAuthorAgent — happy path', () => {
  it('returns the golden output for the prakash-tiwari ticket', async () => {
    const { fn: spawner } = fakeGoldenSpawner(FIXED_NOW);
    const agent = new TestAuthorAgent({ spawner, clock: () => FIXED_NOW });
    const out = await agent.design(buildFakeInput());

    expect(out.status).toBe('ok');
    expect(out.agentName).toBe('test-author');
    expect(out.testCases.length).toBe(15);
    expect(out.testDesign.totalCases).toBe(15);
  });

  it('rewrites testDesign.designedBy to "test-author" even if the spawner returned a different name', async () => {
    const text = goldenAssistantText(FIXED_NOW).replace(/"designedBy":"test-author"/g, '"designedBy":"someone-else"');
    const { fn: spawner } = fakeSpawnerReturning(text);
    const agent = new TestAuthorAgent({ spawner, clock: () => FIXED_NOW });
    const out = await agent.design(buildFakeInput());

    expect(out.testDesign.designedBy).toBe('test-author');
  });

  it('always ensures testing/frontend/backend/database appear in dependencies', async () => {
    const { fn: spawner } = fakeGoldenSpawner(FIXED_NOW);
    const agent = new TestAuthorAgent({ spawner, clock: () => FIXED_NOW });
    const out = await agent.design(buildFakeInput());

    expect(out.dependencies).toContain('testing');
    expect(out.dependencies).toContain('frontend');
    expect(out.dependencies).toContain('backend');
    expect(out.dependencies).toContain('database');
  });

  it('uses DEFAULT_BUDGET when input.budget is omitted', async () => {
    const { fn: spawner, calls } = fakeGoldenSpawner(FIXED_NOW);
    const agent = new TestAuthorAgent({ spawner, clock: () => FIXED_NOW });
    const input = buildFakeInput();
    delete (input as Record<string, unknown>)['budget'];
    await agent.design(input);

    expect(calls[0]?.budget.preferredModel).toBe(DEFAULT_BUDGET.preferredModel);
    expect(calls[0]?.budget.maxOutputTokens).toBe(DEFAULT_BUDGET.maxOutputTokens);
  });

  it('passes the systemPrompt through to the spawner', async () => {
    const { fn: spawner, calls } = fakeGoldenSpawner(FIXED_NOW);
    const agent = new TestAuthorAgent({ spawner, clock: () => FIXED_NOW });
    await agent.design(buildFakeInput());

    expect(calls[0]?.systemPrompt.length).toBeGreaterThan(100);
    expect(calls[0]?.systemPrompt).toContain('Test Author Agent');
  });

  it('embeds the ticket, composedArchitecture, AC, and reviewerFeedback in the user prompt', async () => {
    const { fn: spawner, calls } = fakeGoldenSpawner(FIXED_NOW);
    const agent = new TestAuthorAgent({ spawner, clock: () => FIXED_NOW });
    const input = buildFakeInput();
    input.reviewerFeedback = { reason: 'add edge', severity: 'P1' };
    await agent.design(input);

    const user = calls[0]?.userPrompt ?? '';
    expect(user).toContain('ticket-pt-test-001');
    expect(user).toContain('testing.testTypeMixPercentages');
    expect(user).toContain('Submitting valid contact data');
    expect(user).toContain('add edge');
  });

  it('is idempotent — same input ⇒ same output', async () => {
    const agent = new TestAuthorAgent({
      spawner: fakeGoldenSpawner(FIXED_NOW).fn,
      clock: () => FIXED_NOW
    });
    const a = await agent.design(buildFakeInput());
    const b = await agent.design(buildFakeInput());

    expect(JSON.stringify(a)).toBe(JSON.stringify(b));
  });
});

describe('TestAuthorAgent — failure modes', () => {
  it('returns status=failed when the spawner fails', async () => {
    const { fn: spawner } = fakeSpawnerReturning('', false);
    const agent = new TestAuthorAgent({ spawner, clock: () => FIXED_NOW });
    const out = await agent.design(buildFakeInput());

    expect(out.status).toBe('failed');
    expect(out.testCases).toEqual([]);
    expect(out.testDesign.totalCases).toBe(0);
    expect(out.failureReason).toBeDefined();
  });

  it('returns status=partial when the spawner returns invalid JSON', async () => {
    const { fn: spawner } = fakeSpawnerReturning('not json at all');
    const agent = new TestAuthorAgent({ spawner, clock: () => FIXED_NOW });
    const out = await agent.design(buildFakeInput());

    expect(out.status).toBe('partial');
    expect(out.testCases).toEqual([]);
    expect(out.failureReason).toContain('invalid-json');
  });

  it('returns status=partial when a test case has an invalid category', async () => {
    const bad = JSON.stringify({
      agentName: 'test-author',
      testCases: [
        {
          id: 'tc-1',
          title: 'x',
          category: 'wat',
          layer: 'unit',
          given: 'g',
          when: 'w',
          then: 't',
          designedBy: 'test-author',
          designedAt: 0
        }
      ],
      confidence: 0.5,
      notes: '',
      dependencies: [],
      risks: [],
      toolCalls: [],
      spend: { inputTokens: 0, outputTokens: 0, usdCost: 0, wallClockMs: 0, model: 'sonnet' },
      status: 'ok'
    });
    const { fn: spawner } = fakeSpawnerReturning(bad);
    const agent = new TestAuthorAgent({ spawner, clock: () => FIXED_NOW });
    const out = await agent.design(buildFakeInput());

    expect(out.status).toBe('partial');
    expect(out.failureReason).toContain('invalid-test-case-category');
  });

  it('returns status=partial when linkedAcceptanceCriterionIndex points outside the AC array', async () => {
    const bad = JSON.stringify({
      agentName: 'test-author',
      testCases: [
        {
          id: 'tc-1',
          title: 'x',
          category: 'happy',
          layer: 'unit',
          given: 'g',
          when: 'w',
          then: 't',
          linkedAcceptanceCriterionIndex: 99,
          designedBy: 'test-author',
          designedAt: 0
        }
      ],
      confidence: 0.5,
      notes: '',
      dependencies: [],
      risks: [],
      toolCalls: [],
      spend: { inputTokens: 0, outputTokens: 0, usdCost: 0, wallClockMs: 0, model: 'sonnet' },
      status: 'ok'
    });
    const { fn: spawner } = fakeSpawnerReturning(bad);
    const agent = new TestAuthorAgent({ spawner, clock: () => FIXED_NOW });
    const out = await agent.design(buildFakeInput());

    expect(out.status).toBe('partial');
    expect(out.failureReason).toContain('invalid-linked-ac-index');
  });

  it('reports model + token usage from the spawner even on failure', async () => {
    const { fn: spawner } = fakeSpawnerReturning('not json');
    const agent = new TestAuthorAgent({ spawner, clock: () => FIXED_NOW });
    const out = await agent.design(buildFakeInput());

    expect(out.spend.inputTokens).toBe(1234);
    expect(out.spend.outputTokens).toBe(567);
  });
});

describe('TestAuthorAgent — system prompt', () => {
  it('returns a non-empty string', () => {
    const agent = new TestAuthorAgent({ spawner: fakeGoldenSpawner().fn });
    const sp = agent.systemPrompt();
    expect(sp.length).toBeGreaterThan(500);
  });
});
