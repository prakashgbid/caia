/**
 * `run()` tests — verifies the runtime pipeline:
 *
 *   - happy path returns a well-formed ArchitectOutput
 *   - idempotency: same input → output
 *   - re-runs REPLACE owned fields (do not append)
 *   - dependency declaration on output (database depends on backend)
 *   - failure modes (spawn failure, validation failure)
 *   - reviewer feedback is plumbed through
 *   - spend telemetry comes from the spawner, not the assistant
 *   - Backend's upstream output is surfaced in the user prompt
 */

import { describe, it, expect } from 'vitest';

import { DATABASE_ARCHITECT_NAME, DatabaseArchitect } from '../src/architect.js';
import { DATABASE_OWNED_FIELD_KEYS } from '../src/contract.js';
import { buildUserPrompt, runDatabaseArchitect } from '../src/run.js';
import { buildDatabaseSystemPrompt } from '../src/system-prompt.js';
import {
  buildFakeInput,
  fakeGoldenSpawner,
  fakeSpawnerReturning,
  goldenAssistantText
} from './helpers/fakes.js';

describe('runDatabaseArchitect — happy path', () => {
  it('produces an ArchitectOutput with the right architectName', async () => {
    const { fn: spawner } = fakeGoldenSpawner();
    const out = await runDatabaseArchitect(buildFakeInput(), {
      spawner,
      systemPrompt: buildDatabaseSystemPrompt(),
      architectName: DATABASE_ARCHITECT_NAME
    });
    expect(out.architectName).toBe('database');
  });

  it('output covers every owned field key', async () => {
    const { fn: spawner } = fakeGoldenSpawner();
    const out = await runDatabaseArchitect(buildFakeInput(), {
      spawner,
      systemPrompt: buildDatabaseSystemPrompt(),
      architectName: DATABASE_ARCHITECT_NAME
    });
    for (const k of DATABASE_OWNED_FIELD_KEYS) {
      expect(out.architectureFields).toHaveProperty(k);
    }
  });

  it('output status is `ok` on the canonical golden text', async () => {
    const { fn: spawner } = fakeGoldenSpawner();
    const out = await runDatabaseArchitect(buildFakeInput(), {
      spawner,
      systemPrompt: buildDatabaseSystemPrompt(),
      architectName: DATABASE_ARCHITECT_NAME
    });
    expect(out.status).toBe('ok');
  });

  it('spend telemetry comes from the spawner, not the assistant', async () => {
    const { fn: spawner } = fakeSpawnerReturning(goldenAssistantText());
    const out = await runDatabaseArchitect(buildFakeInput(), {
      spawner,
      systemPrompt: buildDatabaseSystemPrompt(),
      architectName: DATABASE_ARCHITECT_NAME
    });
    expect(out.spend.inputTokens).toBe(1000);
    expect(out.spend.outputTokens).toBe(500);
    expect(out.spend.usdCost).toBe(0.01);
    expect(out.spend.wallClockMs).toBe(1234);
    expect(out.spend.model).toBe('sonnet');
  });

  it('passes the system prompt to the spawner', async () => {
    const { fn: spawner, calls } = fakeGoldenSpawner();
    await runDatabaseArchitect(buildFakeInput(), {
      spawner,
      systemPrompt: buildDatabaseSystemPrompt(),
      architectName: DATABASE_ARCHITECT_NAME
    });
    expect(calls[0]?.systemPrompt).toBe(buildDatabaseSystemPrompt());
  });

  it('passes the projected user prompt to the spawner', async () => {
    const input = buildFakeInput();
    const { fn: spawner, calls } = fakeGoldenSpawner();
    await runDatabaseArchitect(input, {
      spawner,
      systemPrompt: buildDatabaseSystemPrompt(),
      architectName: DATABASE_ARCHITECT_NAME
    });
    expect(calls[0]?.userPrompt).toBe(buildUserPrompt(input));
  });

  it('passes the budget through to the spawner', async () => {
    const input = buildFakeInput();
    const { fn: spawner, calls } = fakeGoldenSpawner();
    await runDatabaseArchitect(input, {
      spawner,
      systemPrompt: buildDatabaseSystemPrompt(),
      architectName: DATABASE_ARCHITECT_NAME
    });
    expect(calls[0]?.budget).toEqual(input.budget);
  });
});

describe('runDatabaseArchitect — idempotency', () => {
  it('same input → same output (deterministic spawner)', async () => {
    const { fn: spawner } = fakeGoldenSpawner();
    const input = buildFakeInput();
    const a = await runDatabaseArchitect(input, {
      spawner,
      systemPrompt: buildDatabaseSystemPrompt(),
      architectName: DATABASE_ARCHITECT_NAME
    });
    const b = await runDatabaseArchitect(input, {
      spawner,
      systemPrompt: buildDatabaseSystemPrompt(),
      architectName: DATABASE_ARCHITECT_NAME
    });
    expect(a).toEqual(b);
  });

  it('re-run REPLACES the architectureFields (no append)', async () => {
    const { fn: spawner } = fakeGoldenSpawner();
    const input = buildFakeInput();
    const r1 = await runDatabaseArchitect(input, {
      spawner,
      systemPrompt: buildDatabaseSystemPrompt(),
      architectName: DATABASE_ARCHITECT_NAME
    });
    const r2 = await runDatabaseArchitect(input, {
      spawner,
      systemPrompt: buildDatabaseSystemPrompt(),
      architectName: DATABASE_ARCHITECT_NAME
    });
    expect(Object.keys(r2.architectureFields).sort()).toEqual(
      Object.keys(r1.architectureFields).sort()
    );
    expect(Object.keys(r2.architectureFields).length).toBe(DATABASE_OWNED_FIELD_KEYS.length);
  });
});

describe('runDatabaseArchitect — failure modes', () => {
  it('returns status=failed when the spawner fails', async () => {
    const { fn: spawner } = fakeSpawnerReturning('', false);
    const out = await runDatabaseArchitect(buildFakeInput(), {
      spawner,
      systemPrompt: buildDatabaseSystemPrompt(),
      architectName: DATABASE_ARCHITECT_NAME
    });
    expect(out.status).toBe('failed');
    expect(out.failureReason).toBeTruthy();
    expect(Object.keys(out.architectureFields)).toEqual([]);
  });

  it('returns status=partial when validation fails', async () => {
    const { fn: spawner } = fakeSpawnerReturning('{"architectName":"database"}');
    const out = await runDatabaseArchitect(buildFakeInput(), {
      spawner,
      systemPrompt: buildDatabaseSystemPrompt(),
      architectName: DATABASE_ARCHITECT_NAME
    });
    expect(out.status).toBe('partial');
    expect(out.failureReason).toBeTruthy();
    expect(out.risks.length).toBeGreaterThan(0);
  });

  it('returns status=partial when the assistant text is not JSON', async () => {
    const { fn: spawner } = fakeSpawnerReturning('not json at all');
    const out = await runDatabaseArchitect(buildFakeInput(), {
      spawner,
      systemPrompt: buildDatabaseSystemPrompt(),
      architectName: DATABASE_ARCHITECT_NAME
    });
    expect(out.status).toBe('partial');
  });
});

describe('runDatabaseArchitect — dependency declaration', () => {
  it('database is a wave-2 architect; declares Backend dependency in output', async () => {
    const { fn: spawner } = fakeGoldenSpawner();
    const out = await runDatabaseArchitect(buildFakeInput(), {
      spawner,
      systemPrompt: buildDatabaseSystemPrompt(),
      architectName: DATABASE_ARCHITECT_NAME
    });
    expect(out.dependencies).toEqual(['backend']);
  });
});

describe('buildUserPrompt', () => {
  it('serialises the ticket', () => {
    const p = buildUserPrompt(buildFakeInput());
    expect(p).toContain('ticket-pt-002');
  });

  it('surfaces Backend\'s upstream apiEndpoints (Database\'s primary input)', () => {
    const p = buildUserPrompt(buildFakeInput());
    expect(p).toContain('backend.apiEndpoints');
    expect(p).toContain('/api/contacts');
  });

  it('surfaces Backend\'s upstream endpointEnumeration', () => {
    const p = buildUserPrompt(buildFakeInput());
    expect(p).toContain('backend.endpointEnumeration');
  });

  it('omits privacy-sensitive tenant fields (schemaName, vaultNamespace)', () => {
    const p = buildUserPrompt(buildFakeInput());
    expect(p).not.toContain('"pt_001"');
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
      reviewerFeedback: { reason: 'add GIN index on payload', severity: 'P1' as const }
    };
    const p = buildUserPrompt(withFeedback);
    expect(p).toContain('add GIN index on payload');
  });

  it('renders reviewerFeedback as null when absent', () => {
    const p = buildUserPrompt(buildFakeInput());
    expect(p).toContain('"reviewerFeedback": null');
  });
});

describe('DatabaseArchitect — class-level integration', () => {
  it('uses the architect class with a fake spawner', async () => {
    const { fn: spawner } = fakeGoldenSpawner();
    const a = new DatabaseArchitect({ spawner });
    const out = await a.run(buildFakeInput());
    expect(out.architectName).toBe('database');
    expect(out.status).toBe('ok');
  });

  it('preserves the assistant-declared confidence on success', async () => {
    const { fn: spawner } = fakeGoldenSpawner();
    const a = new DatabaseArchitect({ spawner });
    const out = await a.run(buildFakeInput());
    expect(out.confidence).toBeGreaterThan(0.5);
    expect(out.confidence).toBeLessThanOrEqual(1);
  });
});
