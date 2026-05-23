/**
 * `run()` tests — verifies the runtime pipeline.
 */

import { describe, it, expect } from 'vitest';

import { OBSERVABILITY_ARCHITECT_NAME, ObservabilityArchitect } from '../src/architect.js';
import { OBSERVABILITY_OWNED_FIELD_KEYS } from '../src/contract.js';
import { buildUserPrompt, runObservabilityArchitect } from '../src/run.js';
import { buildObservabilitySystemPrompt } from '../src/system-prompt.js';
import {
  buildFakeInput,
  fakeGoldenSpawner,
  fakeSpawnerReturning,
  goldenAssistantText
} from './helpers/fakes.js';

describe('runObservabilityArchitect — happy path', () => {
  it('produces an ArchitectOutput with the right architectName', async () => {
    const { fn: spawner } = fakeGoldenSpawner();
    const out = await runObservabilityArchitect(buildFakeInput(), {
      spawner,
      systemPrompt: buildObservabilitySystemPrompt(),
      architectName: OBSERVABILITY_ARCHITECT_NAME
    });
    expect(out.architectName).toBe('observability');
  });

  it('output covers every owned field key', async () => {
    const { fn: spawner } = fakeGoldenSpawner();
    const out = await runObservabilityArchitect(buildFakeInput(), {
      spawner,
      systemPrompt: buildObservabilitySystemPrompt(),
      architectName: OBSERVABILITY_ARCHITECT_NAME
    });
    for (const k of OBSERVABILITY_OWNED_FIELD_KEYS) {
      expect(out.architectureFields).toHaveProperty(k);
    }
  });

  it('output status is `ok` on the canonical golden text', async () => {
    const { fn: spawner } = fakeGoldenSpawner();
    const out = await runObservabilityArchitect(buildFakeInput(), {
      spawner,
      systemPrompt: buildObservabilitySystemPrompt(),
      architectName: OBSERVABILITY_ARCHITECT_NAME
    });
    expect(out.status).toBe('ok');
  });

  it('spend telemetry comes from the spawner, not the assistant', async () => {
    const { fn: spawner } = fakeSpawnerReturning(goldenAssistantText());
    const out = await runObservabilityArchitect(buildFakeInput(), {
      spawner,
      systemPrompt: buildObservabilitySystemPrompt(),
      architectName: OBSERVABILITY_ARCHITECT_NAME
    });
    expect(out.spend.inputTokens).toBe(1000);
    expect(out.spend.outputTokens).toBe(500);
    expect(out.spend.usdCost).toBe(0.01);
    expect(out.spend.wallClockMs).toBe(1234);
    expect(out.spend.model).toBe('sonnet');
  });

  it('passes the system prompt to the spawner', async () => {
    const { fn: spawner, calls } = fakeGoldenSpawner();
    await runObservabilityArchitect(buildFakeInput(), {
      spawner,
      systemPrompt: buildObservabilitySystemPrompt(),
      architectName: OBSERVABILITY_ARCHITECT_NAME
    });
    expect(calls[0]?.systemPrompt).toBe(buildObservabilitySystemPrompt());
  });

  it('passes the projected user prompt to the spawner', async () => {
    const input = buildFakeInput();
    const { fn: spawner, calls } = fakeGoldenSpawner();
    await runObservabilityArchitect(input, {
      spawner,
      systemPrompt: buildObservabilitySystemPrompt(),
      architectName: OBSERVABILITY_ARCHITECT_NAME
    });
    expect(calls[0]?.userPrompt).toBe(buildUserPrompt(input));
  });

  it('passes the budget through to the spawner', async () => {
    const input = buildFakeInput();
    const { fn: spawner, calls } = fakeGoldenSpawner();
    await runObservabilityArchitect(input, {
      spawner,
      systemPrompt: buildObservabilitySystemPrompt(),
      architectName: OBSERVABILITY_ARCHITECT_NAME
    });
    expect(calls[0]?.budget).toEqual(input.budget);
  });
});

describe('runObservabilityArchitect — idempotency', () => {
  it('same input → same output (deterministic spawner)', async () => {
    const { fn: spawner } = fakeGoldenSpawner();
    const input = buildFakeInput();
    const a = await runObservabilityArchitect(input, {
      spawner,
      systemPrompt: buildObservabilitySystemPrompt(),
      architectName: OBSERVABILITY_ARCHITECT_NAME
    });
    const b = await runObservabilityArchitect(input, {
      spawner,
      systemPrompt: buildObservabilitySystemPrompt(),
      architectName: OBSERVABILITY_ARCHITECT_NAME
    });
    expect(a).toEqual(b);
  });

  it('re-run REPLACES the architectureFields (no append)', async () => {
    const { fn: spawner } = fakeGoldenSpawner();
    const input = buildFakeInput();
    const r1 = await runObservabilityArchitect(input, {
      spawner,
      systemPrompt: buildObservabilitySystemPrompt(),
      architectName: OBSERVABILITY_ARCHITECT_NAME
    });
    const r2 = await runObservabilityArchitect(input, {
      spawner,
      systemPrompt: buildObservabilitySystemPrompt(),
      architectName: OBSERVABILITY_ARCHITECT_NAME
    });
    expect(Object.keys(r2.architectureFields).sort()).toEqual(
      Object.keys(r1.architectureFields).sort()
    );
    expect(Object.keys(r2.architectureFields).length).toBe(OBSERVABILITY_OWNED_FIELD_KEYS.length);
  });
});

describe('runObservabilityArchitect — failure modes', () => {
  it('returns status=failed when the spawner fails', async () => {
    const { fn: spawner } = fakeSpawnerReturning('', false);
    const out = await runObservabilityArchitect(buildFakeInput(), {
      spawner,
      systemPrompt: buildObservabilitySystemPrompt(),
      architectName: OBSERVABILITY_ARCHITECT_NAME
    });
    expect(out.status).toBe('failed');
    expect(out.failureReason).toBeTruthy();
    expect(Object.keys(out.architectureFields)).toEqual([]);
  });

  it('returns status=partial when validation fails', async () => {
    const { fn: spawner } = fakeSpawnerReturning('{"architectName":"observability"}');
    const out = await runObservabilityArchitect(buildFakeInput(), {
      spawner,
      systemPrompt: buildObservabilitySystemPrompt(),
      architectName: OBSERVABILITY_ARCHITECT_NAME
    });
    expect(out.status).toBe('partial');
    expect(out.failureReason).toBeTruthy();
    expect(out.risks.length).toBeGreaterThan(0);
  });

  it('returns status=partial when the assistant text is not JSON', async () => {
    const { fn: spawner } = fakeSpawnerReturning('not json at all');
    const out = await runObservabilityArchitect(buildFakeInput(), {
      spawner,
      systemPrompt: buildObservabilitySystemPrompt(),
      architectName: OBSERVABILITY_ARCHITECT_NAME
    });
    expect(out.status).toBe('partial');
  });
});

describe('buildUserPrompt', () => {
  it('serialises the ticket', () => {
    const p = buildUserPrompt(buildFakeInput());
    expect(p).toContain('ticket-pt-obs-001');
  });

  it('includes the upstream Backend output (apiEndpoints)', () => {
    const p = buildUserPrompt(buildFakeInput());
    expect(p).toContain('backend.apiEndpoints');
    expect(p).toContain('/api/contacts');
  });

  it('includes the upstream Backend errorEnvelope', () => {
    const p = buildUserPrompt(buildFakeInput());
    expect(p).toContain('backend.errorEnvelope');
    expect(p).toContain('VALIDATION_ERROR');
  });

  it('omits privacy-sensitive tenant fields (schemaName, vaultNamespace)', () => {
    const p = buildUserPrompt(buildFakeInput());
    expect(p).not.toContain('pt_001');
    expect(p).not.toContain('"vault/');
  });

  it('includes the tenantId for attribution', () => {
    const p = buildUserPrompt(buildFakeInput());
    expect(p).toContain('tenant-prakash-tiwari');
  });

  it('passes through reviewer feedback when present', () => {
    const input = buildFakeInput();
    const withFeedback = {
      ...input,
      reviewerFeedback: { reason: 'add a P0 alert on latency burn', severity: 'P1' as const }
    };
    const p = buildUserPrompt(withFeedback);
    expect(p).toContain('add a P0 alert on latency burn');
  });
});

describe('ObservabilityArchitect — class-level integration', () => {
  it('uses the architect class with a fake spawner', async () => {
    const { fn: spawner } = fakeGoldenSpawner();
    const a = new ObservabilityArchitect({ spawner });
    const out = await a.run(buildFakeInput());
    expect(out.architectName).toBe('observability');
    expect(out.status).toBe('ok');
  });
});
