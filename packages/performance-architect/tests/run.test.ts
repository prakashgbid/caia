/**
 * `run()` tests — verifies the runtime pipeline:
 *
 *   - happy path returns a well-formed ArchitectOutput
 *   - idempotency: same input → equivalent output
 *   - re-runs REPLACE owned fields (do not append)
 *   - dependency declaration on output (depends on frontend)
 *   - failure modes (spawn failure, validation failure)
 *   - reviewer feedback is plumbed through
 *   - spend telemetry comes from the spawner, not the assistant
 *   - upstream Frontend output is plumbed into the user prompt
 */

import { describe, it, expect } from 'vitest';

import { PERFORMANCE_ARCHITECT_NAME, PerformanceArchitect } from '../src/architect.js';
import { PERFORMANCE_OWNED_FIELD_KEYS } from '../src/contract.js';
import { buildUserPrompt, runPerformanceArchitect } from '../src/run.js';
import { buildPerformanceSystemPrompt } from '../src/system-prompt.js';
import {
  buildFakeInput,
  fakeGoldenSpawner,
  fakeSpawnerReturning,
  goldenAssistantText
} from './helpers/fakes.js';

describe('runPerformanceArchitect — happy path', () => {
  it('produces an ArchitectOutput with the right architectName', async () => {
    const { fn: spawner } = fakeGoldenSpawner();
    const out = await runPerformanceArchitect(buildFakeInput(), {
      spawner,
      systemPrompt: buildPerformanceSystemPrompt(),
      architectName: PERFORMANCE_ARCHITECT_NAME
    });
    expect(out.architectName).toBe('performance');
  });

  it('output covers every owned field key', async () => {
    const { fn: spawner } = fakeGoldenSpawner();
    const out = await runPerformanceArchitect(buildFakeInput(), {
      spawner,
      systemPrompt: buildPerformanceSystemPrompt(),
      architectName: PERFORMANCE_ARCHITECT_NAME
    });
    for (const k of PERFORMANCE_OWNED_FIELD_KEYS) {
      expect(out.architectureFields).toHaveProperty(k);
    }
  });

  it('output status is `ok` on the canonical golden text', async () => {
    const { fn: spawner } = fakeGoldenSpawner();
    const out = await runPerformanceArchitect(buildFakeInput(), {
      spawner,
      systemPrompt: buildPerformanceSystemPrompt(),
      architectName: PERFORMANCE_ARCHITECT_NAME
    });
    expect(out.status).toBe('ok');
  });

  it('spend telemetry comes from the spawner, not the assistant', async () => {
    const { fn: spawner } = fakeSpawnerReturning(goldenAssistantText());
    const out = await runPerformanceArchitect(buildFakeInput(), {
      spawner,
      systemPrompt: buildPerformanceSystemPrompt(),
      architectName: PERFORMANCE_ARCHITECT_NAME
    });
    expect(out.spend.inputTokens).toBe(1000);
    expect(out.spend.outputTokens).toBe(500);
    expect(out.spend.usdCost).toBe(0.01);
    expect(out.spend.wallClockMs).toBe(1234);
    expect(out.spend.model).toBe('sonnet');
  });

  it('passes the system prompt to the spawner', async () => {
    const { fn: spawner, calls } = fakeGoldenSpawner();
    await runPerformanceArchitect(buildFakeInput(), {
      spawner,
      systemPrompt: buildPerformanceSystemPrompt(),
      architectName: PERFORMANCE_ARCHITECT_NAME
    });
    expect(calls[0]?.systemPrompt).toBe(buildPerformanceSystemPrompt());
  });

  it('passes the projected user prompt to the spawner', async () => {
    const input = buildFakeInput();
    const { fn: spawner, calls } = fakeGoldenSpawner();
    await runPerformanceArchitect(input, {
      spawner,
      systemPrompt: buildPerformanceSystemPrompt(),
      architectName: PERFORMANCE_ARCHITECT_NAME
    });
    expect(calls[0]?.userPrompt).toBe(buildUserPrompt(input));
  });

  it('passes the budget through to the spawner', async () => {
    const input = buildFakeInput();
    const { fn: spawner, calls } = fakeGoldenSpawner();
    await runPerformanceArchitect(input, {
      spawner,
      systemPrompt: buildPerformanceSystemPrompt(),
      architectName: PERFORMANCE_ARCHITECT_NAME
    });
    expect(calls[0]?.budget).toEqual(input.budget);
  });
});

describe('runPerformanceArchitect — idempotency', () => {
  it('same input → same output (deterministic spawner)', async () => {
    const { fn: spawner } = fakeGoldenSpawner();
    const input = buildFakeInput();
    const a = await runPerformanceArchitect(input, {
      spawner,
      systemPrompt: buildPerformanceSystemPrompt(),
      architectName: PERFORMANCE_ARCHITECT_NAME
    });
    const b = await runPerformanceArchitect(input, {
      spawner,
      systemPrompt: buildPerformanceSystemPrompt(),
      architectName: PERFORMANCE_ARCHITECT_NAME
    });
    expect(a).toEqual(b);
  });

  it('re-run REPLACES the architectureFields (no append)', async () => {
    const { fn: spawner } = fakeGoldenSpawner();
    const input = buildFakeInput();
    const r1 = await runPerformanceArchitect(input, {
      spawner,
      systemPrompt: buildPerformanceSystemPrompt(),
      architectName: PERFORMANCE_ARCHITECT_NAME
    });
    const r2 = await runPerformanceArchitect(input, {
      spawner,
      systemPrompt: buildPerformanceSystemPrompt(),
      architectName: PERFORMANCE_ARCHITECT_NAME
    });
    expect(Object.keys(r2.architectureFields).sort()).toEqual(
      Object.keys(r1.architectureFields).sort()
    );
    expect(Object.keys(r2.architectureFields).length).toBe(
      PERFORMANCE_OWNED_FIELD_KEYS.length
    );
  });
});

describe('runPerformanceArchitect — failure modes', () => {
  it('returns status=failed when the spawner fails', async () => {
    const { fn: spawner } = fakeSpawnerReturning('', false);
    const out = await runPerformanceArchitect(buildFakeInput(), {
      spawner,
      systemPrompt: buildPerformanceSystemPrompt(),
      architectName: PERFORMANCE_ARCHITECT_NAME
    });
    expect(out.status).toBe('failed');
    expect(out.failureReason).toBeTruthy();
    expect(Object.keys(out.architectureFields)).toEqual([]);
  });

  it('returns status=partial when validation fails', async () => {
    const { fn: spawner } = fakeSpawnerReturning('{"architectName":"performance"}');
    const out = await runPerformanceArchitect(buildFakeInput(), {
      spawner,
      systemPrompt: buildPerformanceSystemPrompt(),
      architectName: PERFORMANCE_ARCHITECT_NAME
    });
    expect(out.status).toBe('partial');
    expect(out.failureReason).toBeTruthy();
    expect(out.risks.length).toBeGreaterThan(0);
  });

  it('returns status=partial when the assistant text is not JSON', async () => {
    const { fn: spawner } = fakeSpawnerReturning('not json at all');
    const out = await runPerformanceArchitect(buildFakeInput(), {
      spawner,
      systemPrompt: buildPerformanceSystemPrompt(),
      architectName: PERFORMANCE_ARCHITECT_NAME
    });
    expect(out.status).toBe('partial');
  });
});

describe('runPerformanceArchitect — dependency declaration', () => {
  it('performance declares Frontend as an upstream architect-meta dependency', () => {
    const a = new PerformanceArchitect();
    expect(a.sectionContract.architectMeta.dependsOn).toEqual(['frontend']);
  });

  it('performance output reports zero per-ticket sibling dependencies on the golden fixture', async () => {
    const { fn: spawner } = fakeGoldenSpawner();
    const out = await runPerformanceArchitect(buildFakeInput(), {
      spawner,
      systemPrompt: buildPerformanceSystemPrompt(),
      architectName: PERFORMANCE_ARCHITECT_NAME
    });
    // Per-ticket sibling deps (`output.dependencies`) is a separate
    // concept from architect-meta `dependsOn`. The hero widget has no
    // sibling ticket prerequisites.
    expect(out.dependencies).toEqual([]);
  });
});

describe('buildUserPrompt', () => {
  it('serialises the ticket', () => {
    const p = buildUserPrompt(buildFakeInput());
    expect(p).toContain('ticket-pt-001');
  });

  it('serialises the designVersion tokens', () => {
    const p = buildUserPrompt(buildFakeInput());
    expect(p).toContain('color.brand.primary');
    expect(p).toContain('#0f3057');
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

  it('includes the upstream Frontend output (componentTree + framework)', () => {
    const p = buildUserPrompt(buildFakeInput());
    expect(p).toContain('frontend.componentTree');
    expect(p).toContain('frontend.framework');
    expect(p).toContain('hero-portrait');
    expect(p).toContain('hero-cta-primary');
  });

  it('passes through reviewer feedback when present', () => {
    const input = buildFakeInput();
    const withFeedback = {
      ...input,
      reviewerFeedback: { reason: 'tighten LCP target', severity: 'P1' as const }
    };
    const p = buildUserPrompt(withFeedback);
    expect(p).toContain('tighten LCP target');
  });
});

describe('PerformanceArchitect — class-level integration', () => {
  it('uses the architect class with a fake spawner', async () => {
    const { fn: spawner } = fakeGoldenSpawner();
    const a = new PerformanceArchitect({ spawner });
    const out = await a.run(buildFakeInput());
    expect(out.architectName).toBe('performance');
    expect(out.status).toBe('ok');
  });
});
