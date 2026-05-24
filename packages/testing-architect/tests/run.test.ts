/**
 * `run()` tests.
 */

import { describe, it, expect } from 'vitest';

import { TESTING_ARCHITECT_NAME, TestingArchitect } from '../src/architect.js';
import { TESTING_OWNED_FIELD_KEYS } from '../src/contract.js';
import { buildUserPrompt, runTestingArchitect } from '../src/run.js';
import { buildTestingSystemPrompt } from '../src/system-prompt.js';
import {
  buildFakeInput,
  fakeGoldenSpawner,
  fakeSpawnerReturning,
  goldenAssistantText
} from './helpers/fakes.js';

describe('runTestingArchitect — happy path', () => {
  it('produces an ArchitectOutput with the right architectName', async () => {
    const { fn: spawner } = fakeGoldenSpawner();
    const out = await runTestingArchitect(buildFakeInput(), {
      spawner,
      systemPrompt: buildTestingSystemPrompt(),
      architectName: TESTING_ARCHITECT_NAME
    });
    expect(out.architectName).toBe('testing');
  });

  it('output covers every owned field key', async () => {
    const { fn: spawner } = fakeGoldenSpawner();
    const out = await runTestingArchitect(buildFakeInput(), {
      spawner,
      systemPrompt: buildTestingSystemPrompt(),
      architectName: TESTING_ARCHITECT_NAME
    });
    for (const k of TESTING_OWNED_FIELD_KEYS) {
      expect(out.architectureFields).toHaveProperty(k);
    }
  });

  it('output status is `ok` on the canonical golden text', async () => {
    const { fn: spawner } = fakeGoldenSpawner();
    const out = await runTestingArchitect(buildFakeInput(), {
      spawner,
      systemPrompt: buildTestingSystemPrompt(),
      architectName: TESTING_ARCHITECT_NAME
    });
    expect(out.status).toBe('ok');
  });

  it('spend telemetry comes from the spawner, not the assistant', async () => {
    const { fn: spawner } = fakeSpawnerReturning(goldenAssistantText());
    const out = await runTestingArchitect(buildFakeInput(), {
      spawner,
      systemPrompt: buildTestingSystemPrompt(),
      architectName: TESTING_ARCHITECT_NAME
    });
    expect(out.spend.inputTokens).toBe(1000);
    expect(out.spend.outputTokens).toBe(500);
    expect(out.spend.usdCost).toBe(0.01);
    expect(out.spend.wallClockMs).toBe(1234);
    expect(out.spend.model).toBe('sonnet');
  });

  it('passes the system prompt to the spawner', async () => {
    const { fn: spawner, calls } = fakeGoldenSpawner();
    await runTestingArchitect(buildFakeInput(), {
      spawner,
      systemPrompt: buildTestingSystemPrompt(),
      architectName: TESTING_ARCHITECT_NAME
    });
    expect(calls[0]?.systemPrompt).toBe(buildTestingSystemPrompt());
  });

  it('passes the projected user prompt to the spawner', async () => {
    const input = buildFakeInput();
    const { fn: spawner, calls } = fakeGoldenSpawner();
    await runTestingArchitect(input, {
      spawner,
      systemPrompt: buildTestingSystemPrompt(),
      architectName: TESTING_ARCHITECT_NAME
    });
    expect(calls[0]?.userPrompt).toBe(buildUserPrompt(input));
  });

  it('passes the budget through to the spawner', async () => {
    const input = buildFakeInput();
    const { fn: spawner, calls } = fakeGoldenSpawner();
    await runTestingArchitect(input, {
      spawner,
      systemPrompt: buildTestingSystemPrompt(),
      architectName: TESTING_ARCHITECT_NAME
    });
    expect(calls[0]?.budget).toEqual(input.budget);
  });
});

describe('runTestingArchitect — idempotency', () => {
  it('same input → same output (deterministic spawner)', async () => {
    const { fn: spawner } = fakeGoldenSpawner();
    const input = buildFakeInput();
    const a = await runTestingArchitect(input, {
      spawner,
      systemPrompt: buildTestingSystemPrompt(),
      architectName: TESTING_ARCHITECT_NAME
    });
    const b = await runTestingArchitect(input, {
      spawner,
      systemPrompt: buildTestingSystemPrompt(),
      architectName: TESTING_ARCHITECT_NAME
    });
    expect(a).toEqual(b);
  });

  it('re-run REPLACES the architectureFields (no append)', async () => {
    const { fn: spawner } = fakeGoldenSpawner();
    const input = buildFakeInput();
    const r1 = await runTestingArchitect(input, {
      spawner,
      systemPrompt: buildTestingSystemPrompt(),
      architectName: TESTING_ARCHITECT_NAME
    });
    const r2 = await runTestingArchitect(input, {
      spawner,
      systemPrompt: buildTestingSystemPrompt(),
      architectName: TESTING_ARCHITECT_NAME
    });
    expect(Object.keys(r2.architectureFields).sort()).toEqual(
      Object.keys(r1.architectureFields).sort()
    );
    expect(Object.keys(r2.architectureFields).length).toBe(TESTING_OWNED_FIELD_KEYS.length);
  });
});

describe('runTestingArchitect — failure modes', () => {
  it('returns status=failed when the spawner fails', async () => {
    const { fn: spawner } = fakeSpawnerReturning('', false);
    const out = await runTestingArchitect(buildFakeInput(), {
      spawner,
      systemPrompt: buildTestingSystemPrompt(),
      architectName: TESTING_ARCHITECT_NAME
    });
    expect(out.status).toBe('failed');
    expect(out.failureReason).toBeTruthy();
    expect(Object.keys(out.architectureFields)).toEqual([]);
    expect(out.dependencies).toContain('frontend');
    expect(out.dependencies).toContain('backend');
    expect(out.dependencies).toContain('database');
  });

  it('returns status=partial when validation fails', async () => {
    const { fn: spawner } = fakeSpawnerReturning('{"architectName":"testing"}');
    const out = await runTestingArchitect(buildFakeInput(), {
      spawner,
      systemPrompt: buildTestingSystemPrompt(),
      architectName: TESTING_ARCHITECT_NAME
    });
    expect(out.status).toBe('partial');
    expect(out.failureReason).toBeTruthy();
    expect(out.risks.length).toBeGreaterThan(0);
    expect(out.dependencies).toContain('frontend');
    expect(out.dependencies).toContain('backend');
    expect(out.dependencies).toContain('database');
  });

  it('returns status=partial when the assistant text is not JSON', async () => {
    const { fn: spawner } = fakeSpawnerReturning('not json at all');
    const out = await runTestingArchitect(buildFakeInput(), {
      spawner,
      systemPrompt: buildTestingSystemPrompt(),
      architectName: TESTING_ARCHITECT_NAME
    });
    expect(out.status).toBe('partial');
  });
});

describe('runTestingArchitect — dependency declaration', () => {
  it('Testing is wave-2; ensures frontend + backend + database in dependencies', async () => {
    const { fn: spawner } = fakeGoldenSpawner();
    const out = await runTestingArchitect(buildFakeInput(), {
      spawner,
      systemPrompt: buildTestingSystemPrompt(),
      architectName: TESTING_ARCHITECT_NAME
    });
    expect(out.dependencies).toContain('frontend');
    expect(out.dependencies).toContain('backend');
    expect(out.dependencies).toContain('database');
  });

  it('preserves sibling ticket IDs the model emitted alongside the canonical deps', async () => {
    const fakeWithSiblings = {
      ...JSON.parse(goldenAssistantText()),
      dependencies: ['ticket-other-1', 'frontend']
    };
    const { fn: spawner } = fakeSpawnerReturning(JSON.stringify(fakeWithSiblings));
    const out = await runTestingArchitect(buildFakeInput(), {
      spawner,
      systemPrompt: buildTestingSystemPrompt(),
      architectName: TESTING_ARCHITECT_NAME
    });
    expect(out.dependencies).toContain('ticket-other-1');
    expect(out.dependencies).toContain('frontend');
    expect(out.dependencies).toContain('backend');
    expect(out.dependencies).toContain('database');
    expect(out.dependencies.filter(d => d === 'frontend').length).toBe(1);
  });
});

describe('buildUserPrompt', () => {
  it('serialises the ticket', () => {
    expect(buildUserPrompt(buildFakeInput())).toContain('ticket-pt-test-001');
  });

  it('serialises the upstream Frontend output (componentTree)', () => {
    const p = buildUserPrompt(buildFakeInput());
    expect(p).toContain('frontend.componentTree');
    expect(p).toContain('contact-form');
  });

  it('serialises the upstream Backend output (apiEndpoints)', () => {
    const p = buildUserPrompt(buildFakeInput());
    expect(p).toContain('backend.apiEndpoints');
    expect(p).toContain('/v1/contacts');
  });

  it('serialises the upstream Database output (schemaDDL)', () => {
    const p = buildUserPrompt(buildFakeInput());
    expect(p).toContain('database.schemaDDL');
    expect(p).toContain('contacts');
  });

  it('omits privacy-sensitive tenant fields (schemaName, vaultNamespace)', () => {
    const p = buildUserPrompt(buildFakeInput());
    expect(p).not.toContain('pt_001');
    expect(p).not.toContain('"vault/');
  });

  it('includes the tenantId for attribution', () => {
    expect(buildUserPrompt(buildFakeInput())).toContain('tenant-prakash-tiwari');
  });

  it('includes the tenant billingPosture', () => {
    expect(buildUserPrompt(buildFakeInput())).toContain('subscription');
  });

  it('passes through reviewer feedback when present', () => {
    const input = buildFakeInput();
    const withFeedback = {
      ...input,
      reviewerFeedback: { reason: 'bump e2e share to 12%', severity: 'P1' as const }
    };
    expect(buildUserPrompt(withFeedback)).toContain('bump e2e share to 12%');
  });
});

describe('TestingArchitect — class-level integration', () => {
  it('uses the architect class with a fake spawner', async () => {
    const { fn: spawner } = fakeGoldenSpawner();
    const a = new TestingArchitect({ spawner });
    const out = await a.run(buildFakeInput());
    expect(out.architectName).toBe('testing');
    expect(out.status).toBe('ok');
  });
});
