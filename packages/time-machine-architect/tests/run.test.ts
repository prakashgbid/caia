/**
 * `run()` tests — verifies the runtime pipeline.
 */

import { describe, it, expect } from 'vitest';

import {
  TIME_MACHINE_ARCHITECT_NAME,
  TimeMachineArchitect
} from '../src/architect.js';
import { TIME_MACHINE_OWNED_FIELD_KEYS } from '../src/contract.js';
import { buildUserPrompt, runTimeMachineArchitect } from '../src/run.js';
import { buildTimeMachineSystemPrompt } from '../src/system-prompt.js';
import {
  buildFakeInput,
  fakeGoldenSpawner,
  fakeSpawnerReturning,
  goldenAssistantText
} from './helpers/fakes.js';

describe('runTimeMachineArchitect — happy path', () => {
  it('produces an ArchitectOutput with the right architectName', async () => {
    const { fn: spawner } = fakeGoldenSpawner();
    const out = await runTimeMachineArchitect(buildFakeInput(), {
      spawner,
      systemPrompt: buildTimeMachineSystemPrompt(),
      architectName: TIME_MACHINE_ARCHITECT_NAME
    });
    expect(out.architectName).toBe('time-machine');
  });

  it('output covers every owned field key', async () => {
    const { fn: spawner } = fakeGoldenSpawner();
    const out = await runTimeMachineArchitect(buildFakeInput(), {
      spawner,
      systemPrompt: buildTimeMachineSystemPrompt(),
      architectName: TIME_MACHINE_ARCHITECT_NAME
    });
    for (const k of TIME_MACHINE_OWNED_FIELD_KEYS) {
      expect(out.architectureFields).toHaveProperty(k);
    }
  });

  it('output status is `ok` on the canonical golden text', async () => {
    const { fn: spawner } = fakeGoldenSpawner();
    const out = await runTimeMachineArchitect(buildFakeInput(), {
      spawner,
      systemPrompt: buildTimeMachineSystemPrompt(),
      architectName: TIME_MACHINE_ARCHITECT_NAME
    });
    expect(out.status).toBe('ok');
  });

  it('spend telemetry comes from the spawner, not the assistant', async () => {
    const { fn: spawner } = fakeSpawnerReturning(goldenAssistantText());
    const out = await runTimeMachineArchitect(buildFakeInput(), {
      spawner,
      systemPrompt: buildTimeMachineSystemPrompt(),
      architectName: TIME_MACHINE_ARCHITECT_NAME
    });
    expect(out.spend.inputTokens).toBe(1000);
    expect(out.spend.outputTokens).toBe(500);
    expect(out.spend.usdCost).toBe(0.01);
    expect(out.spend.wallClockMs).toBe(1234);
    expect(out.spend.model).toBe('sonnet');
  });

  it('passes the system prompt to the spawner', async () => {
    const { fn: spawner, calls } = fakeGoldenSpawner();
    await runTimeMachineArchitect(buildFakeInput(), {
      spawner,
      systemPrompt: buildTimeMachineSystemPrompt(),
      architectName: TIME_MACHINE_ARCHITECT_NAME
    });
    expect(calls[0]?.systemPrompt).toBe(buildTimeMachineSystemPrompt());
  });

  it('passes the projected user prompt to the spawner', async () => {
    const input = buildFakeInput();
    const { fn: spawner, calls } = fakeGoldenSpawner();
    await runTimeMachineArchitect(input, {
      spawner,
      systemPrompt: buildTimeMachineSystemPrompt(),
      architectName: TIME_MACHINE_ARCHITECT_NAME
    });
    expect(calls[0]?.userPrompt).toBe(buildUserPrompt(input));
  });

  it('passes the budget through to the spawner', async () => {
    const input = buildFakeInput();
    const { fn: spawner, calls } = fakeGoldenSpawner();
    await runTimeMachineArchitect(input, {
      spawner,
      systemPrompt: buildTimeMachineSystemPrompt(),
      architectName: TIME_MACHINE_ARCHITECT_NAME
    });
    expect(calls[0]?.budget).toEqual(input.budget);
  });
});

describe('runTimeMachineArchitect — idempotency', () => {
  it('same input → same output (deterministic spawner)', async () => {
    const { fn: spawner } = fakeGoldenSpawner();
    const input = buildFakeInput();
    const a = await runTimeMachineArchitect(input, {
      spawner,
      systemPrompt: buildTimeMachineSystemPrompt(),
      architectName: TIME_MACHINE_ARCHITECT_NAME
    });
    const b = await runTimeMachineArchitect(input, {
      spawner,
      systemPrompt: buildTimeMachineSystemPrompt(),
      architectName: TIME_MACHINE_ARCHITECT_NAME
    });
    expect(a).toEqual(b);
  });

  it('re-run REPLACES the architectureFields (no append)', async () => {
    const { fn: spawner } = fakeGoldenSpawner();
    const input = buildFakeInput();
    const r1 = await runTimeMachineArchitect(input, {
      spawner,
      systemPrompt: buildTimeMachineSystemPrompt(),
      architectName: TIME_MACHINE_ARCHITECT_NAME
    });
    const r2 = await runTimeMachineArchitect(input, {
      spawner,
      systemPrompt: buildTimeMachineSystemPrompt(),
      architectName: TIME_MACHINE_ARCHITECT_NAME
    });
    expect(Object.keys(r2.architectureFields).sort()).toEqual(
      Object.keys(r1.architectureFields).sort()
    );
    expect(Object.keys(r2.architectureFields).length).toBe(
      TIME_MACHINE_OWNED_FIELD_KEYS.length
    );
  });
});

describe('runTimeMachineArchitect — failure modes', () => {
  it('returns status=failed when the spawner fails', async () => {
    const { fn: spawner } = fakeSpawnerReturning('', false);
    const out = await runTimeMachineArchitect(buildFakeInput(), {
      spawner,
      systemPrompt: buildTimeMachineSystemPrompt(),
      architectName: TIME_MACHINE_ARCHITECT_NAME
    });
    expect(out.status).toBe('failed');
    expect(out.failureReason).toBeTruthy();
    expect(Object.keys(out.architectureFields)).toEqual([]);
  });

  it('returns status=partial when validation fails', async () => {
    const { fn: spawner } = fakeSpawnerReturning('{"architectName":"time-machine"}');
    const out = await runTimeMachineArchitect(buildFakeInput(), {
      spawner,
      systemPrompt: buildTimeMachineSystemPrompt(),
      architectName: TIME_MACHINE_ARCHITECT_NAME
    });
    expect(out.status).toBe('partial');
    expect(out.failureReason).toBeTruthy();
    expect(out.risks.length).toBeGreaterThan(0);
  });

  it('returns status=partial when the assistant text is not JSON', async () => {
    const { fn: spawner } = fakeSpawnerReturning('not json at all');
    const out = await runTimeMachineArchitect(buildFakeInput(), {
      spawner,
      systemPrompt: buildTimeMachineSystemPrompt(),
      architectName: TIME_MACHINE_ARCHITECT_NAME
    });
    expect(out.status).toBe('partial');
  });
});

describe('runTimeMachineArchitect — dependency declaration', () => {
  it('reads upstream Backend + Database outputs (smoke check)', async () => {
    const input = buildFakeInput();
    const backend = input.upstream.outputs.backend;
    const database = input.upstream.outputs.database;
    expect(backend).toBeDefined();
    expect(database).toBeDefined();
    expect(backend?.architectureFields['backend.endpointEnumeration']).toBeDefined();
    expect(database?.architectureFields['database.dataLifecycle']).toBeDefined();
  });
});

describe('buildUserPrompt', () => {
  it('serialises the ticket', () => {
    const p = buildUserPrompt(buildFakeInput());
    expect(p).toContain('ticket-pt-014');
  });

  it('serialises upstream Backend endpoint enumeration', () => {
    const p = buildUserPrompt(buildFakeInput());
    expect(p).toContain('/api/artists/[slug]/book');
    expect(p).toContain('createBookingRequest');
  });

  it('serialises upstream Database dataLifecycle (for GDPR delete coupling)', () => {
    const p = buildUserPrompt(buildFakeInput());
    expect(p).toContain('database.dataLifecycle');
    expect(p).toContain('booking_requests');
    expect(p).toContain('anonymize');
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
        reason: 'increase audit retention to 10 years',
        severity: 'P1' as const
      }
    };
    const p = buildUserPrompt(withFeedback);
    expect(p).toContain('increase audit retention to 10 years');
  });
});

describe('TimeMachineArchitect — class-level integration', () => {
  it('uses the architect class with a fake spawner', async () => {
    const { fn: spawner } = fakeGoldenSpawner();
    const a = new TimeMachineArchitect({ spawner });
    const out = await a.run(buildFakeInput());
    expect(out.architectName).toBe('time-machine');
    expect(out.status).toBe('ok');
  });
});
