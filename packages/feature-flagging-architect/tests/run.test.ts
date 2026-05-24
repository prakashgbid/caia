/**
 * `run()` tests — verifies the runtime pipeline:
 *
 *   - happy path returns a well-formed ArchitectOutput
 *   - idempotency: same input → equivalent output
 *   - re-runs REPLACE owned fields (do not append)
 *   - upstream FE+BE output is plumbed into the user prompt
 *   - failure modes (spawn failure, validation failure)
 *   - reviewer feedback is plumbed through
 *   - spend telemetry comes from the spawner, not the assistant
 */

import { describe, it, expect } from 'vitest';

import { FEATURE_FLAGGING_ARCHITECT_NAME, FeatureFlaggingArchitect } from '../src/architect.js';
import { FEATURE_FLAGGING_OWNED_FIELD_KEYS } from '../src/contract.js';
import { buildUserPrompt, runFeatureFlaggingArchitect } from '../src/run.js';
import { buildFeatureFlaggingSystemPrompt } from '../src/system-prompt.js';
import {
  buildFakeInput,
  fakeGoldenSpawner,
  fakeSpawnerReturning,
  goldenAssistantText
} from './helpers/fakes.js';

describe('runFeatureFlaggingArchitect — happy path', () => {
  it('produces an ArchitectOutput with the right architectName', async () => {
    const { fn: spawner } = fakeGoldenSpawner();
    const out = await runFeatureFlaggingArchitect(buildFakeInput(), {
      spawner,
      systemPrompt: buildFeatureFlaggingSystemPrompt(),
      architectName: FEATURE_FLAGGING_ARCHITECT_NAME
    });
    expect(out.architectName).toBe('featureFlagging');
  });

  it('output covers every owned field key', async () => {
    const { fn: spawner } = fakeGoldenSpawner();
    const out = await runFeatureFlaggingArchitect(buildFakeInput(), {
      spawner,
      systemPrompt: buildFeatureFlaggingSystemPrompt(),
      architectName: FEATURE_FLAGGING_ARCHITECT_NAME
    });
    for (const k of FEATURE_FLAGGING_OWNED_FIELD_KEYS) {
      expect(out.architectureFields).toHaveProperty(k);
    }
  });

  it('output status is `ok` on the canonical golden text', async () => {
    const { fn: spawner } = fakeGoldenSpawner();
    const out = await runFeatureFlaggingArchitect(buildFakeInput(), {
      spawner,
      systemPrompt: buildFeatureFlaggingSystemPrompt(),
      architectName: FEATURE_FLAGGING_ARCHITECT_NAME
    });
    expect(out.status).toBe('ok');
  });

  it('spend telemetry comes from the spawner, not the assistant', async () => {
    const { fn: spawner } = fakeSpawnerReturning(goldenAssistantText());
    const out = await runFeatureFlaggingArchitect(buildFakeInput(), {
      spawner,
      systemPrompt: buildFeatureFlaggingSystemPrompt(),
      architectName: FEATURE_FLAGGING_ARCHITECT_NAME
    });
    expect(out.spend.inputTokens).toBe(1000);
    expect(out.spend.outputTokens).toBe(500);
    expect(out.spend.usdCost).toBe(0.01);
    expect(out.spend.wallClockMs).toBe(1234);
    expect(out.spend.model).toBe('sonnet');
  });

  it('passes the system prompt to the spawner', async () => {
    const { fn: spawner, calls } = fakeGoldenSpawner();
    await runFeatureFlaggingArchitect(buildFakeInput(), {
      spawner,
      systemPrompt: buildFeatureFlaggingSystemPrompt(),
      architectName: FEATURE_FLAGGING_ARCHITECT_NAME
    });
    expect(calls[0]?.systemPrompt).toBe(buildFeatureFlaggingSystemPrompt());
  });

  it('passes the projected user prompt to the spawner', async () => {
    const input = buildFakeInput();
    const { fn: spawner, calls } = fakeGoldenSpawner();
    await runFeatureFlaggingArchitect(input, {
      spawner,
      systemPrompt: buildFeatureFlaggingSystemPrompt(),
      architectName: FEATURE_FLAGGING_ARCHITECT_NAME
    });
    expect(calls[0]?.userPrompt).toBe(buildUserPrompt(input));
  });

  it('passes the budget through to the spawner', async () => {
    const input = buildFakeInput();
    const { fn: spawner, calls } = fakeGoldenSpawner();
    await runFeatureFlaggingArchitect(input, {
      spawner,
      systemPrompt: buildFeatureFlaggingSystemPrompt(),
      architectName: FEATURE_FLAGGING_ARCHITECT_NAME
    });
    expect(calls[0]?.budget).toEqual(input.budget);
  });
});

describe('runFeatureFlaggingArchitect — idempotency', () => {
  it('same input → same output (deterministic spawner)', async () => {
    const { fn: spawner } = fakeGoldenSpawner();
    const input = buildFakeInput();
    const a = await runFeatureFlaggingArchitect(input, {
      spawner,
      systemPrompt: buildFeatureFlaggingSystemPrompt(),
      architectName: FEATURE_FLAGGING_ARCHITECT_NAME
    });
    const b = await runFeatureFlaggingArchitect(input, {
      spawner,
      systemPrompt: buildFeatureFlaggingSystemPrompt(),
      architectName: FEATURE_FLAGGING_ARCHITECT_NAME
    });
    expect(a).toEqual(b);
  });

  it('re-run REPLACES the architectureFields (no append)', async () => {
    const { fn: spawner } = fakeGoldenSpawner();
    const input = buildFakeInput();
    const r1 = await runFeatureFlaggingArchitect(input, {
      spawner,
      systemPrompt: buildFeatureFlaggingSystemPrompt(),
      architectName: FEATURE_FLAGGING_ARCHITECT_NAME
    });
    const r2 = await runFeatureFlaggingArchitect(input, {
      spawner,
      systemPrompt: buildFeatureFlaggingSystemPrompt(),
      architectName: FEATURE_FLAGGING_ARCHITECT_NAME
    });
    expect(Object.keys(r2.architectureFields).sort()).toEqual(
      Object.keys(r1.architectureFields).sort()
    );
    expect(Object.keys(r2.architectureFields).length).toBe(
      FEATURE_FLAGGING_OWNED_FIELD_KEYS.length
    );
  });
});

describe('runFeatureFlaggingArchitect — failure modes', () => {
  it('returns status=failed when the spawner fails', async () => {
    const { fn: spawner } = fakeSpawnerReturning('', false);
    const out = await runFeatureFlaggingArchitect(buildFakeInput(), {
      spawner,
      systemPrompt: buildFeatureFlaggingSystemPrompt(),
      architectName: FEATURE_FLAGGING_ARCHITECT_NAME
    });
    expect(out.status).toBe('failed');
    expect(out.failureReason).toBeTruthy();
    expect(Object.keys(out.architectureFields)).toEqual([]);
  });

  it('returns status=partial when validation fails (missing owned fields)', async () => {
    const { fn: spawner } = fakeSpawnerReturning(
      '{"architectName":"featureFlagging"}'
    );
    const out = await runFeatureFlaggingArchitect(buildFakeInput(), {
      spawner,
      systemPrompt: buildFeatureFlaggingSystemPrompt(),
      architectName: FEATURE_FLAGGING_ARCHITECT_NAME
    });
    expect(out.status).toBe('partial');
    expect(out.failureReason).toBeTruthy();
    expect(out.risks.length).toBeGreaterThan(0);
  });

  it('returns status=partial when the assistant text is not JSON', async () => {
    const { fn: spawner } = fakeSpawnerReturning('not json at all');
    const out = await runFeatureFlaggingArchitect(buildFakeInput(), {
      spawner,
      systemPrompt: buildFeatureFlaggingSystemPrompt(),
      architectName: FEATURE_FLAGGING_ARCHITECT_NAME
    });
    expect(out.status).toBe('partial');
  });
});

describe('runFeatureFlaggingArchitect — depends-on plumbing', () => {
  it('user prompt includes upstream Frontend componentTree (depends-on signal)', () => {
    const p = buildUserPrompt(buildFakeInput());
    expect(p).toContain('booking-shell');
    expect(p).toContain('booking-submit');
  });

  it('user prompt includes upstream Backend apiEndpoints (depends-on signal)', () => {
    const p = buildUserPrompt(buildFakeInput());
    expect(p).toContain('/api/v1/bookings');
    expect(p).toContain('POST');
  });
});

describe('buildUserPrompt', () => {
  it('serialises the ticket', () => {
    const p = buildUserPrompt(buildFakeInput());
    expect(p).toContain('ticket-pt-042');
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
      reviewerFeedback: { reason: 'add a payments kill switch', severity: 'P1' as const }
    };
    const p = buildUserPrompt(withFeedback);
    expect(p).toContain('add a payments kill switch');
  });
});

describe('FeatureFlaggingArchitect — class-level integration', () => {
  it('uses the architect class with a fake spawner', async () => {
    const { fn: spawner } = fakeGoldenSpawner();
    const a = new FeatureFlaggingArchitect({ spawner });
    const out = await a.run(buildFakeInput());
    expect(out.architectName).toBe('featureFlagging');
    expect(out.status).toBe('ok');
  });
});
