/**
 * `run()` tests — verifies the runtime pipeline.
 */

import { describe, it, expect } from 'vitest';

import { AB_TESTING_ARCHITECT_NAME, ABTestingArchitect } from '../src/architect.js';
import { AB_TESTING_OWNED_FIELD_KEYS } from '../src/contract.js';
import { buildUserPrompt, runABTestingArchitect } from '../src/run.js';
import { buildABTestingSystemPrompt } from '../src/system-prompt.js';
import {
  buildFakeInput,
  fakeGoldenSpawner,
  fakeSpawnerReturning,
  goldenAssistantText
} from './helpers/fakes.js';

describe('runABTestingArchitect — happy path', () => {
  it('produces an ArchitectOutput with the right architectName', async () => {
    const { fn: spawner } = fakeGoldenSpawner();
    const out = await runABTestingArchitect(buildFakeInput(), {
      spawner,
      systemPrompt: buildABTestingSystemPrompt(),
      architectName: AB_TESTING_ARCHITECT_NAME
    });
    expect(out.architectName).toBe('abTesting');
  });

  it('output covers every owned field key', async () => {
    const { fn: spawner } = fakeGoldenSpawner();
    const out = await runABTestingArchitect(buildFakeInput(), {
      spawner,
      systemPrompt: buildABTestingSystemPrompt(),
      architectName: AB_TESTING_ARCHITECT_NAME
    });
    for (const k of AB_TESTING_OWNED_FIELD_KEYS) {
      expect(out.architectureFields).toHaveProperty(k);
    }
  });

  it('output status is `ok` on the canonical golden text', async () => {
    const { fn: spawner } = fakeGoldenSpawner();
    const out = await runABTestingArchitect(buildFakeInput(), {
      spawner,
      systemPrompt: buildABTestingSystemPrompt(),
      architectName: AB_TESTING_ARCHITECT_NAME
    });
    expect(out.status).toBe('ok');
  });

  it('spend telemetry comes from the spawner, not the assistant', async () => {
    const { fn: spawner } = fakeSpawnerReturning(goldenAssistantText());
    const out = await runABTestingArchitect(buildFakeInput(), {
      spawner,
      systemPrompt: buildABTestingSystemPrompt(),
      architectName: AB_TESTING_ARCHITECT_NAME
    });
    expect(out.spend.inputTokens).toBe(1000);
    expect(out.spend.outputTokens).toBe(500);
    expect(out.spend.usdCost).toBe(0.01);
    expect(out.spend.wallClockMs).toBe(1234);
    expect(out.spend.model).toBe('sonnet');
  });

  it('passes the system prompt to the spawner', async () => {
    const { fn: spawner, calls } = fakeGoldenSpawner();
    await runABTestingArchitect(buildFakeInput(), {
      spawner,
      systemPrompt: buildABTestingSystemPrompt(),
      architectName: AB_TESTING_ARCHITECT_NAME
    });
    expect(calls[0]?.systemPrompt).toBe(buildABTestingSystemPrompt());
  });

  it('passes the projected user prompt to the spawner', async () => {
    const input = buildFakeInput();
    const { fn: spawner, calls } = fakeGoldenSpawner();
    await runABTestingArchitect(input, {
      spawner,
      systemPrompt: buildABTestingSystemPrompt(),
      architectName: AB_TESTING_ARCHITECT_NAME
    });
    expect(calls[0]?.userPrompt).toBe(buildUserPrompt(input));
  });

  it('passes the budget through to the spawner', async () => {
    const input = buildFakeInput();
    const { fn: spawner, calls } = fakeGoldenSpawner();
    await runABTestingArchitect(input, {
      spawner,
      systemPrompt: buildABTestingSystemPrompt(),
      architectName: AB_TESTING_ARCHITECT_NAME
    });
    expect(calls[0]?.budget).toEqual(input.budget);
  });
});

describe('runABTestingArchitect — idempotency', () => {
  it('same input → same output (deterministic spawner)', async () => {
    const { fn: spawner } = fakeGoldenSpawner();
    const input = buildFakeInput();
    const a = await runABTestingArchitect(input, {
      spawner,
      systemPrompt: buildABTestingSystemPrompt(),
      architectName: AB_TESTING_ARCHITECT_NAME
    });
    const b = await runABTestingArchitect(input, {
      spawner,
      systemPrompt: buildABTestingSystemPrompt(),
      architectName: AB_TESTING_ARCHITECT_NAME
    });
    expect(a).toEqual(b);
  });

  it('re-run REPLACES the architectureFields (no append)', async () => {
    const { fn: spawner } = fakeGoldenSpawner();
    const input = buildFakeInput();
    const r1 = await runABTestingArchitect(input, {
      spawner,
      systemPrompt: buildABTestingSystemPrompt(),
      architectName: AB_TESTING_ARCHITECT_NAME
    });
    const r2 = await runABTestingArchitect(input, {
      spawner,
      systemPrompt: buildABTestingSystemPrompt(),
      architectName: AB_TESTING_ARCHITECT_NAME
    });
    expect(Object.keys(r2.architectureFields).slice().sort()).toEqual(
      Object.keys(r1.architectureFields).slice().sort()
    );
    expect(Object.keys(r2.architectureFields).length).toBe(AB_TESTING_OWNED_FIELD_KEYS.length);
  });
});

describe('runABTestingArchitect — failure modes', () => {
  it('returns status=failed when the spawner fails', async () => {
    const { fn: spawner } = fakeSpawnerReturning('', false);
    const out = await runABTestingArchitect(buildFakeInput(), {
      spawner,
      systemPrompt: buildABTestingSystemPrompt(),
      architectName: AB_TESTING_ARCHITECT_NAME
    });
    expect(out.status).toBe('failed');
    expect(out.failureReason).toBeTruthy();
    expect(Object.keys(out.architectureFields)).toEqual([]);
  });

  it('returns status=partial when validation fails', async () => {
    const { fn: spawner } = fakeSpawnerReturning('{"architectName":"abTesting"}');
    const out = await runABTestingArchitect(buildFakeInput(), {
      spawner,
      systemPrompt: buildABTestingSystemPrompt(),
      architectName: AB_TESTING_ARCHITECT_NAME
    });
    expect(out.status).toBe('partial');
    expect(out.failureReason).toBeTruthy();
    expect(out.risks.length).toBeGreaterThan(0);
  });

  it('returns status=partial when the assistant text is not JSON', async () => {
    const { fn: spawner } = fakeSpawnerReturning('not json at all');
    const out = await runABTestingArchitect(buildFakeInput(), {
      spawner,
      systemPrompt: buildABTestingSystemPrompt(),
      architectName: AB_TESTING_ARCHITECT_NAME
    });
    expect(out.status).toBe('partial');
  });
});

describe('runABTestingArchitect — dependency declaration', () => {
  it('abTesting is a wave-3 architect (no sibling-ticket deps in this fixture)', async () => {
    const { fn: spawner } = fakeGoldenSpawner();
    const out = await runABTestingArchitect(buildFakeInput(), {
      spawner,
      systemPrompt: buildABTestingSystemPrompt(),
      architectName: AB_TESTING_ARCHITECT_NAME
    });
    expect(out.dependencies).toEqual([]);
  });
});

describe('buildUserPrompt', () => {
  it('serialises the ticket', () => {
    const p = buildUserPrompt(buildFakeInput());
    expect(p).toContain('ticket-pt-ab-001');
  });

  it('serialises the Analytics upstream eventTaxonomy', () => {
    const p = buildUserPrompt(buildFakeInput());
    expect(p).toContain('analytics.eventTaxonomy');
    expect(p).toContain('booking_started');
  });

  it('serialises the Analytics upstream conversionGoals', () => {
    const p = buildUserPrompt(buildFakeInput());
    expect(p).toContain('analytics.conversionGoals');
  });

  it('serialises the Feature Flagging upstream flagsSchema', () => {
    const p = buildUserPrompt(buildFakeInput());
    expect(p).toContain('featureFlagging.flagsSchema');
    expect(p).toContain('exp_hero_cta_2026_05');
  });

  it('omits privacy-sensitive tenant fields (schemaName, vaultNamespace)', () => {
    const p = buildUserPrompt(buildFakeInput());
    expect(p).not.toContain('pt_001');
    expect(p).not.toContain('"vault/');
  });

  it('preserves tenantContext.compliance.dataResidency', () => {
    const p = buildUserPrompt(buildFakeInput());
    expect(p).toContain('dataResidency');
    expect(p).toContain('EU');
  });

  it('includes the tenantId for attribution', () => {
    const p = buildUserPrompt(buildFakeInput());
    expect(p).toContain('tenant-prakash-tiwari');
  });

  it('passes through reviewer feedback when present', () => {
    const input = buildFakeInput();
    const withFeedback = {
      ...input,
      reviewerFeedback: { reason: 'increase MDE to fit in duration cap', severity: 'P1' as const }
    };
    const p = buildUserPrompt(withFeedback);
    expect(p).toContain('increase MDE to fit in duration cap');
  });
});

describe('ABTestingArchitect — class-level integration', () => {
  it('uses the architect class with a fake spawner', async () => {
    const { fn: spawner } = fakeGoldenSpawner();
    const a = new ABTestingArchitect({ spawner });
    const out = await a.run(buildFakeInput());
    expect(out.architectName).toBe('abTesting');
    expect(out.status).toBe('ok');
  });
});
