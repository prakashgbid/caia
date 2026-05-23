/**
 * `run()` tests — verifies the runtime pipeline:
 *
 *   - happy path returns a well-formed ArchitectOutput
 *   - idempotency: same input → equivalent output
 *   - re-runs REPLACE owned fields (do not append)
 *   - dependency declaration on output
 *   - failure modes (spawn failure, validation failure)
 *   - reviewer feedback is plumbed through
 *   - spend telemetry comes from the spawner, not the assistant
 */

import { describe, it, expect } from 'vitest';

import { ANALYTICS_ARCHITECT_NAME, AnalyticsArchitect } from '../src/architect.js';
import { ANALYTICS_OWNED_FIELD_KEYS } from '../src/contract.js';
import { buildUserPrompt, runAnalyticsArchitect } from '../src/run.js';
import { buildAnalyticsSystemPrompt } from '../src/system-prompt.js';
import {
  buildFakeInput,
  fakeGoldenSpawner,
  fakeSpawnerReturning,
  goldenAssistantText
} from './helpers/fakes.js';

describe('runAnalyticsArchitect — happy path', () => {
  it('produces an ArchitectOutput with the right architectName', async () => {
    const { fn: spawner } = fakeGoldenSpawner();
    const out = await runAnalyticsArchitect(buildFakeInput(), {
      spawner,
      systemPrompt: buildAnalyticsSystemPrompt(),
      architectName: ANALYTICS_ARCHITECT_NAME
    });
    expect(out.architectName).toBe('analytics');
  });

  it('output covers every owned field key', async () => {
    const { fn: spawner } = fakeGoldenSpawner();
    const out = await runAnalyticsArchitect(buildFakeInput(), {
      spawner,
      systemPrompt: buildAnalyticsSystemPrompt(),
      architectName: ANALYTICS_ARCHITECT_NAME
    });
    for (const k of ANALYTICS_OWNED_FIELD_KEYS) {
      expect(out.architectureFields).toHaveProperty(k);
    }
  });

  it('output status is `ok` on the canonical golden text', async () => {
    const { fn: spawner } = fakeGoldenSpawner();
    const out = await runAnalyticsArchitect(buildFakeInput(), {
      spawner,
      systemPrompt: buildAnalyticsSystemPrompt(),
      architectName: ANALYTICS_ARCHITECT_NAME
    });
    expect(out.status).toBe('ok');
  });

  it('spend telemetry comes from the spawner, not the assistant', async () => {
    const { fn: spawner } = fakeSpawnerReturning(goldenAssistantText());
    const out = await runAnalyticsArchitect(buildFakeInput(), {
      spawner,
      systemPrompt: buildAnalyticsSystemPrompt(),
      architectName: ANALYTICS_ARCHITECT_NAME
    });
    expect(out.spend.inputTokens).toBe(1000);
    expect(out.spend.outputTokens).toBe(500);
    expect(out.spend.usdCost).toBe(0.01);
    expect(out.spend.wallClockMs).toBe(1234);
    expect(out.spend.model).toBe('sonnet');
  });

  it('passes the system prompt to the spawner', async () => {
    const { fn: spawner, calls } = fakeGoldenSpawner();
    await runAnalyticsArchitect(buildFakeInput(), {
      spawner,
      systemPrompt: buildAnalyticsSystemPrompt(),
      architectName: ANALYTICS_ARCHITECT_NAME
    });
    expect(calls[0]?.systemPrompt).toBe(buildAnalyticsSystemPrompt());
  });

  it('passes the projected user prompt to the spawner', async () => {
    const input = buildFakeInput();
    const { fn: spawner, calls } = fakeGoldenSpawner();
    await runAnalyticsArchitect(input, {
      spawner,
      systemPrompt: buildAnalyticsSystemPrompt(),
      architectName: ANALYTICS_ARCHITECT_NAME
    });
    expect(calls[0]?.userPrompt).toBe(buildUserPrompt(input));
  });

  it('passes the budget through to the spawner', async () => {
    const input = buildFakeInput();
    const { fn: spawner, calls } = fakeGoldenSpawner();
    await runAnalyticsArchitect(input, {
      spawner,
      systemPrompt: buildAnalyticsSystemPrompt(),
      architectName: ANALYTICS_ARCHITECT_NAME
    });
    expect(calls[0]?.budget).toEqual(input.budget);
  });
});

describe('runAnalyticsArchitect — idempotency', () => {
  it('same input → same output (deterministic spawner)', async () => {
    const { fn: spawner } = fakeGoldenSpawner();
    const input = buildFakeInput();
    const a = await runAnalyticsArchitect(input, {
      spawner,
      systemPrompt: buildAnalyticsSystemPrompt(),
      architectName: ANALYTICS_ARCHITECT_NAME
    });
    const b = await runAnalyticsArchitect(input, {
      spawner,
      systemPrompt: buildAnalyticsSystemPrompt(),
      architectName: ANALYTICS_ARCHITECT_NAME
    });
    expect(a).toEqual(b);
  });

  it('re-run REPLACES the architectureFields (no append)', async () => {
    const { fn: spawner } = fakeGoldenSpawner();
    const input = buildFakeInput();
    const r1 = await runAnalyticsArchitect(input, {
      spawner,
      systemPrompt: buildAnalyticsSystemPrompt(),
      architectName: ANALYTICS_ARCHITECT_NAME
    });
    const r2 = await runAnalyticsArchitect(input, {
      spawner,
      systemPrompt: buildAnalyticsSystemPrompt(),
      architectName: ANALYTICS_ARCHITECT_NAME
    });
    expect(Object.keys(r2.architectureFields).slice().sort()).toEqual(
      Object.keys(r1.architectureFields).slice().sort()
    );
    expect(Object.keys(r2.architectureFields).length).toBe(ANALYTICS_OWNED_FIELD_KEYS.length);
  });
});

describe('runAnalyticsArchitect — failure modes', () => {
  it('returns status=failed when the spawner fails', async () => {
    const { fn: spawner } = fakeSpawnerReturning('', false);
    const out = await runAnalyticsArchitect(buildFakeInput(), {
      spawner,
      systemPrompt: buildAnalyticsSystemPrompt(),
      architectName: ANALYTICS_ARCHITECT_NAME
    });
    expect(out.status).toBe('failed');
    expect(out.failureReason).toBeTruthy();
    expect(Object.keys(out.architectureFields)).toEqual([]);
  });

  it('returns status=partial when validation fails', async () => {
    const { fn: spawner } = fakeSpawnerReturning('{"architectName":"analytics"}');
    const out = await runAnalyticsArchitect(buildFakeInput(), {
      spawner,
      systemPrompt: buildAnalyticsSystemPrompt(),
      architectName: ANALYTICS_ARCHITECT_NAME
    });
    expect(out.status).toBe('partial');
    expect(out.failureReason).toBeTruthy();
    expect(out.risks.length).toBeGreaterThan(0);
  });

  it('returns status=partial when the assistant text is not JSON', async () => {
    const { fn: spawner } = fakeSpawnerReturning('not json at all');
    const out = await runAnalyticsArchitect(buildFakeInput(), {
      spawner,
      systemPrompt: buildAnalyticsSystemPrompt(),
      architectName: ANALYTICS_ARCHITECT_NAME
    });
    expect(out.status).toBe('partial');
  });
});

describe('runAnalyticsArchitect — dependency declaration', () => {
  it('analytics is a wave-2 architect (no sibling-ticket deps in this fixture)', async () => {
    const { fn: spawner } = fakeGoldenSpawner();
    const out = await runAnalyticsArchitect(buildFakeInput(), {
      spawner,
      systemPrompt: buildAnalyticsSystemPrompt(),
      architectName: ANALYTICS_ARCHITECT_NAME
    });
    // Output `dependencies` field is sibling TICKET ids — not architect
    // dependencies (those live in architectMeta.dependsOn). The hero
    // widget has no sibling-ticket dep so this is an empty array.
    expect(out.dependencies).toEqual([]);
  });
});

describe('buildUserPrompt', () => {
  it('serialises the ticket', () => {
    const p = buildUserPrompt(buildFakeInput());
    expect(p).toContain('ticket-pt-001');
  });

  it('serialises the Frontend upstream componentTree', () => {
    const p = buildUserPrompt(buildFakeInput());
    expect(p).toContain('frontend.componentTree');
    expect(p).toContain('hero-cta-primary');
  });

  it('serialises the Frontend upstream interactionStates', () => {
    const p = buildUserPrompt(buildFakeInput());
    expect(p).toContain('frontend.interactionStates');
  });

  it('omits privacy-sensitive tenant fields (schemaName, vaultNamespace)', () => {
    const p = buildUserPrompt(buildFakeInput());
    expect(p).not.toContain('pt_001');
    expect(p).not.toContain('"vault/');
  });

  it('preserves tenantContext.compliance.dataResidency for residency decisions', () => {
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
      reviewerFeedback: { reason: 'tighten consent gate on commerce events', severity: 'P1' as const }
    };
    const p = buildUserPrompt(withFeedback);
    expect(p).toContain('tighten consent gate on commerce events');
  });
});

describe('AnalyticsArchitect — class-level integration', () => {
  it('uses the architect class with a fake spawner', async () => {
    const { fn: spawner } = fakeGoldenSpawner();
    const a = new AnalyticsArchitect({ spawner });
    const out = await a.run(buildFakeInput());
    expect(out.architectName).toBe('analytics');
    expect(out.status).toBe('ok');
  });
});
