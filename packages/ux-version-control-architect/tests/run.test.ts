/**
 * `run()` tests — verifies the runtime pipeline.
 */

import { describe, it, expect } from 'vitest';

import {
  UX_VERSION_CONTROL_ARCHITECT_NAME,
  UxVersionControlArchitect
} from '../src/architect.js';
import { UX_VERSION_CONTROL_OWNED_FIELD_KEYS } from '../src/contract.js';
import { buildUserPrompt, runUxVersionControlArchitect } from '../src/run.js';
import { buildUxVersionControlSystemPrompt } from '../src/system-prompt.js';
import {
  buildFakeInput,
  fakeGoldenSpawner,
  fakeSpawnerReturning,
  goldenAssistantText
} from './helpers/fakes.js';

describe('runUxVersionControlArchitect — happy path', () => {
  it('produces an ArchitectOutput with the right architectName', async () => {
    const { fn: spawner } = fakeGoldenSpawner();
    const out = await runUxVersionControlArchitect(buildFakeInput(), {
      spawner,
      systemPrompt: buildUxVersionControlSystemPrompt(),
      architectName: UX_VERSION_CONTROL_ARCHITECT_NAME
    });
    expect(out.architectName).toBe('ux-version-control');
  });

  it('output covers every owned field key', async () => {
    const { fn: spawner } = fakeGoldenSpawner();
    const out = await runUxVersionControlArchitect(buildFakeInput(), {
      spawner,
      systemPrompt: buildUxVersionControlSystemPrompt(),
      architectName: UX_VERSION_CONTROL_ARCHITECT_NAME
    });
    for (const k of UX_VERSION_CONTROL_OWNED_FIELD_KEYS) {
      expect(out.architectureFields).toHaveProperty(k);
    }
  });

  it('output status is `ok` on the canonical golden text', async () => {
    const { fn: spawner } = fakeGoldenSpawner();
    const out = await runUxVersionControlArchitect(buildFakeInput(), {
      spawner,
      systemPrompt: buildUxVersionControlSystemPrompt(),
      architectName: UX_VERSION_CONTROL_ARCHITECT_NAME
    });
    expect(out.status).toBe('ok');
  });

  it('spend telemetry comes from the spawner, not the assistant', async () => {
    const { fn: spawner } = fakeSpawnerReturning(goldenAssistantText());
    const out = await runUxVersionControlArchitect(buildFakeInput(), {
      spawner,
      systemPrompt: buildUxVersionControlSystemPrompt(),
      architectName: UX_VERSION_CONTROL_ARCHITECT_NAME
    });
    expect(out.spend.inputTokens).toBe(1000);
    expect(out.spend.outputTokens).toBe(500);
    expect(out.spend.usdCost).toBe(0.01);
    expect(out.spend.wallClockMs).toBe(1234);
    expect(out.spend.model).toBe('sonnet');
  });

  it('passes the system prompt to the spawner', async () => {
    const { fn: spawner, calls } = fakeGoldenSpawner();
    await runUxVersionControlArchitect(buildFakeInput(), {
      spawner,
      systemPrompt: buildUxVersionControlSystemPrompt(),
      architectName: UX_VERSION_CONTROL_ARCHITECT_NAME
    });
    expect(calls[0]?.systemPrompt).toBe(buildUxVersionControlSystemPrompt());
  });

  it('passes the projected user prompt to the spawner', async () => {
    const input = buildFakeInput();
    const { fn: spawner, calls } = fakeGoldenSpawner();
    await runUxVersionControlArchitect(input, {
      spawner,
      systemPrompt: buildUxVersionControlSystemPrompt(),
      architectName: UX_VERSION_CONTROL_ARCHITECT_NAME
    });
    expect(calls[0]?.userPrompt).toBe(buildUserPrompt(input));
  });

  it('passes the budget through to the spawner', async () => {
    const input = buildFakeInput();
    const { fn: spawner, calls } = fakeGoldenSpawner();
    await runUxVersionControlArchitect(input, {
      spawner,
      systemPrompt: buildUxVersionControlSystemPrompt(),
      architectName: UX_VERSION_CONTROL_ARCHITECT_NAME
    });
    expect(calls[0]?.budget).toEqual(input.budget);
  });
});

describe('runUxVersionControlArchitect — idempotency', () => {
  it('same input → same output (deterministic spawner)', async () => {
    const { fn: spawner } = fakeGoldenSpawner();
    const input = buildFakeInput();
    const a = await runUxVersionControlArchitect(input, {
      spawner,
      systemPrompt: buildUxVersionControlSystemPrompt(),
      architectName: UX_VERSION_CONTROL_ARCHITECT_NAME
    });
    const b = await runUxVersionControlArchitect(input, {
      spawner,
      systemPrompt: buildUxVersionControlSystemPrompt(),
      architectName: UX_VERSION_CONTROL_ARCHITECT_NAME
    });
    expect(a).toEqual(b);
  });

  it('re-run REPLACES the architectureFields (no append)', async () => {
    const { fn: spawner } = fakeGoldenSpawner();
    const input = buildFakeInput();
    const r1 = await runUxVersionControlArchitect(input, {
      spawner,
      systemPrompt: buildUxVersionControlSystemPrompt(),
      architectName: UX_VERSION_CONTROL_ARCHITECT_NAME
    });
    const r2 = await runUxVersionControlArchitect(input, {
      spawner,
      systemPrompt: buildUxVersionControlSystemPrompt(),
      architectName: UX_VERSION_CONTROL_ARCHITECT_NAME
    });
    expect(Object.keys(r2.architectureFields).sort()).toEqual(
      Object.keys(r1.architectureFields).sort()
    );
    expect(Object.keys(r2.architectureFields).length).toBe(
      UX_VERSION_CONTROL_OWNED_FIELD_KEYS.length
    );
  });
});

describe('runUxVersionControlArchitect — failure modes', () => {
  it('returns status=failed when the spawner fails', async () => {
    const { fn: spawner } = fakeSpawnerReturning('', false);
    const out = await runUxVersionControlArchitect(buildFakeInput(), {
      spawner,
      systemPrompt: buildUxVersionControlSystemPrompt(),
      architectName: UX_VERSION_CONTROL_ARCHITECT_NAME
    });
    expect(out.status).toBe('failed');
    expect(out.failureReason).toBeTruthy();
    expect(Object.keys(out.architectureFields)).toEqual([]);
  });

  it('returns status=partial when validation fails', async () => {
    const { fn: spawner } = fakeSpawnerReturning(
      '{"architectName":"ux-version-control"}'
    );
    const out = await runUxVersionControlArchitect(buildFakeInput(), {
      spawner,
      systemPrompt: buildUxVersionControlSystemPrompt(),
      architectName: UX_VERSION_CONTROL_ARCHITECT_NAME
    });
    expect(out.status).toBe('partial');
    expect(out.failureReason).toBeTruthy();
    expect(out.risks.length).toBeGreaterThan(0);
  });

  it('returns status=partial when the assistant text is not JSON', async () => {
    const { fn: spawner } = fakeSpawnerReturning('not json at all');
    const out = await runUxVersionControlArchitect(buildFakeInput(), {
      spawner,
      systemPrompt: buildUxVersionControlSystemPrompt(),
      architectName: UX_VERSION_CONTROL_ARCHITECT_NAME
    });
    expect(out.status).toBe('partial');
  });
});

describe('runUxVersionControlArchitect — no upstream architect dependencies', () => {
  it('wave-1 architect: upstream.outputs is empty in the canonical fixture', () => {
    const input = buildFakeInput();
    expect(input.upstream.outputs).toEqual({});
  });
});

describe('buildUserPrompt', () => {
  it('serialises the ticket', () => {
    const p = buildUserPrompt(buildFakeInput());
    expect(p).toContain('ticket-pt-015');
  });

  it('serialises the designVersion (the primary input for a wave-1 architect)', () => {
    const p = buildUserPrompt(buildFakeInput());
    expect(p).toContain('design-pt-v3-2026-05-22');
    expect(p).toContain('hero-cta-primary');
    expect(p).toContain('booking-form');
  });

  it('serialises the businessPlan brand voice', () => {
    const p = buildUserPrompt(buildFakeInput());
    expect(p).toContain('warm + grounded');
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
      reviewerFeedback: {
        reason: 'tighten revert idempotency-key shape',
        severity: 'P1' as const
      }
    };
    const p = buildUserPrompt(withFeedback);
    expect(p).toContain('tighten revert idempotency-key shape');
  });
});

describe('UxVersionControlArchitect — class-level integration', () => {
  it('uses the architect class with a fake spawner', async () => {
    const { fn: spawner } = fakeGoldenSpawner();
    const a = new UxVersionControlArchitect({ spawner });
    const out = await a.run(buildFakeInput());
    expect(out.architectName).toBe('ux-version-control');
    expect(out.status).toBe('ok');
  });
});
