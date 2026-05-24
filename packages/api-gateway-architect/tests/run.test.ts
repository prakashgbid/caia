/**
 * `run()` tests.
 */

import { describe, it, expect } from 'vitest';

import { API_GATEWAY_ARCHITECT_NAME, ApiGatewayArchitect } from '../src/architect.js';
import { API_GATEWAY_OWNED_FIELD_KEYS } from '../src/contract.js';
import { buildUserPrompt, runApiGatewayArchitect } from '../src/run.js';
import { buildApiGatewaySystemPrompt } from '../src/system-prompt.js';
import {
  buildFakeInput,
  fakeGoldenSpawner,
  fakeSpawnerReturning,
  goldenAssistantText
} from './helpers/fakes.js';

describe('runApiGatewayArchitect — happy path', () => {
  it('produces an ArchitectOutput with the right architectName', async () => {
    const { fn: spawner } = fakeGoldenSpawner();
    const out = await runApiGatewayArchitect(buildFakeInput(), {
      spawner,
      systemPrompt: buildApiGatewaySystemPrompt(),
      architectName: API_GATEWAY_ARCHITECT_NAME
    });
    expect(out.architectName).toBe('apiGateway');
  });

  it('output covers every owned field key', async () => {
    const { fn: spawner } = fakeGoldenSpawner();
    const out = await runApiGatewayArchitect(buildFakeInput(), {
      spawner,
      systemPrompt: buildApiGatewaySystemPrompt(),
      architectName: API_GATEWAY_ARCHITECT_NAME
    });
    for (const k of API_GATEWAY_OWNED_FIELD_KEYS) {
      expect(out.architectureFields).toHaveProperty(k);
    }
  });

  it('output status is `ok` on the canonical golden text', async () => {
    const { fn: spawner } = fakeGoldenSpawner();
    const out = await runApiGatewayArchitect(buildFakeInput(), {
      spawner,
      systemPrompt: buildApiGatewaySystemPrompt(),
      architectName: API_GATEWAY_ARCHITECT_NAME
    });
    expect(out.status).toBe('ok');
  });

  it('spend telemetry comes from the spawner, not the assistant', async () => {
    const { fn: spawner } = fakeSpawnerReturning(goldenAssistantText());
    const out = await runApiGatewayArchitect(buildFakeInput(), {
      spawner,
      systemPrompt: buildApiGatewaySystemPrompt(),
      architectName: API_GATEWAY_ARCHITECT_NAME
    });
    expect(out.spend.inputTokens).toBe(1000);
    expect(out.spend.outputTokens).toBe(500);
    expect(out.spend.usdCost).toBe(0.01);
    expect(out.spend.wallClockMs).toBe(1234);
    expect(out.spend.model).toBe('sonnet');
  });

  it('passes the system prompt to the spawner', async () => {
    const { fn: spawner, calls } = fakeGoldenSpawner();
    await runApiGatewayArchitect(buildFakeInput(), {
      spawner,
      systemPrompt: buildApiGatewaySystemPrompt(),
      architectName: API_GATEWAY_ARCHITECT_NAME
    });
    expect(calls[0]?.systemPrompt).toBe(buildApiGatewaySystemPrompt());
  });

  it('passes the projected user prompt to the spawner', async () => {
    const input = buildFakeInput();
    const { fn: spawner, calls } = fakeGoldenSpawner();
    await runApiGatewayArchitect(input, {
      spawner,
      systemPrompt: buildApiGatewaySystemPrompt(),
      architectName: API_GATEWAY_ARCHITECT_NAME
    });
    expect(calls[0]?.userPrompt).toBe(buildUserPrompt(input));
  });

  it('passes the budget through to the spawner', async () => {
    const input = buildFakeInput();
    const { fn: spawner, calls } = fakeGoldenSpawner();
    await runApiGatewayArchitect(input, {
      spawner,
      systemPrompt: buildApiGatewaySystemPrompt(),
      architectName: API_GATEWAY_ARCHITECT_NAME
    });
    expect(calls[0]?.budget).toEqual(input.budget);
  });
});

describe('runApiGatewayArchitect — idempotency', () => {
  it('same input → same output (deterministic spawner)', async () => {
    const { fn: spawner } = fakeGoldenSpawner();
    const input = buildFakeInput();
    const a = await runApiGatewayArchitect(input, {
      spawner,
      systemPrompt: buildApiGatewaySystemPrompt(),
      architectName: API_GATEWAY_ARCHITECT_NAME
    });
    const b = await runApiGatewayArchitect(input, {
      spawner,
      systemPrompt: buildApiGatewaySystemPrompt(),
      architectName: API_GATEWAY_ARCHITECT_NAME
    });
    expect(a).toEqual(b);
  });

  it('re-run REPLACES the architectureFields (no append)', async () => {
    const { fn: spawner } = fakeGoldenSpawner();
    const input = buildFakeInput();
    const r1 = await runApiGatewayArchitect(input, {
      spawner,
      systemPrompt: buildApiGatewaySystemPrompt(),
      architectName: API_GATEWAY_ARCHITECT_NAME
    });
    const r2 = await runApiGatewayArchitect(input, {
      spawner,
      systemPrompt: buildApiGatewaySystemPrompt(),
      architectName: API_GATEWAY_ARCHITECT_NAME
    });
    expect(Object.keys(r2.architectureFields).sort()).toEqual(
      Object.keys(r1.architectureFields).sort()
    );
    expect(Object.keys(r2.architectureFields).length).toBe(API_GATEWAY_OWNED_FIELD_KEYS.length);
  });
});

describe('runApiGatewayArchitect — failure modes', () => {
  it('returns status=failed when the spawner fails', async () => {
    const { fn: spawner } = fakeSpawnerReturning('', false);
    const out = await runApiGatewayArchitect(buildFakeInput(), {
      spawner,
      systemPrompt: buildApiGatewaySystemPrompt(),
      architectName: API_GATEWAY_ARCHITECT_NAME
    });
    expect(out.status).toBe('failed');
    expect(out.failureReason).toBeTruthy();
    expect(Object.keys(out.architectureFields)).toEqual([]);
    expect(out.dependencies).toContain('backend');
    expect(out.dependencies).toContain('security');
  });

  it('returns status=partial when validation fails', async () => {
    const { fn: spawner } = fakeSpawnerReturning('{"architectName":"apiGateway"}');
    const out = await runApiGatewayArchitect(buildFakeInput(), {
      spawner,
      systemPrompt: buildApiGatewaySystemPrompt(),
      architectName: API_GATEWAY_ARCHITECT_NAME
    });
    expect(out.status).toBe('partial');
    expect(out.failureReason).toBeTruthy();
    expect(out.risks.length).toBeGreaterThan(0);
    expect(out.dependencies).toContain('backend');
    expect(out.dependencies).toContain('security');
  });

  it('returns status=partial when the assistant text is not JSON', async () => {
    const { fn: spawner } = fakeSpawnerReturning('not json at all');
    const out = await runApiGatewayArchitect(buildFakeInput(), {
      spawner,
      systemPrompt: buildApiGatewaySystemPrompt(),
      architectName: API_GATEWAY_ARCHITECT_NAME
    });
    expect(out.status).toBe('partial');
  });
});

describe('runApiGatewayArchitect — dependency declaration', () => {
  it('API Gateway is wave-2; ensures backend + security in dependencies', async () => {
    const { fn: spawner } = fakeGoldenSpawner();
    const out = await runApiGatewayArchitect(buildFakeInput(), {
      spawner,
      systemPrompt: buildApiGatewaySystemPrompt(),
      architectName: API_GATEWAY_ARCHITECT_NAME
    });
    expect(out.dependencies).toContain('backend');
    expect(out.dependencies).toContain('security');
  });

  it('preserves sibling ticket IDs the model emitted alongside the canonical deps', async () => {
    const fakeWithSiblings = {
      ...JSON.parse(goldenAssistantText()),
      dependencies: ['ticket-other-1', 'backend']
    };
    const { fn: spawner } = fakeSpawnerReturning(JSON.stringify(fakeWithSiblings));
    const out = await runApiGatewayArchitect(buildFakeInput(), {
      spawner,
      systemPrompt: buildApiGatewaySystemPrompt(),
      architectName: API_GATEWAY_ARCHITECT_NAME
    });
    expect(out.dependencies).toContain('ticket-other-1');
    expect(out.dependencies).toContain('backend');
    expect(out.dependencies).toContain('security');
    expect(out.dependencies.filter(d => d === 'backend').length).toBe(1);
  });
});

describe('buildUserPrompt', () => {
  it('serialises the ticket', () => {
    const p = buildUserPrompt(buildFakeInput());
    expect(p).toContain('ticket-pt-api-001');
  });

  it('serialises the upstream Backend output (apiEndpoints)', () => {
    const p = buildUserPrompt(buildFakeInput());
    expect(p).toContain('backend.apiEndpoints');
    expect(p).toContain('/v1/contacts');
  });

  it('serialises the upstream Security output (authenticationStrategy)', () => {
    const p = buildUserPrompt(buildFakeInput());
    expect(p).toContain('security.authenticationStrategy');
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

  it('includes the tenant billingPosture for tier resolution', () => {
    const p = buildUserPrompt(buildFakeInput());
    expect(p).toContain('subscription');
  });

  it('passes through reviewer feedback when present', () => {
    const input = buildFakeInput();
    const withFeedback = {
      ...input,
      reviewerFeedback: { reason: 'fix the rate limit', severity: 'P1' as const }
    };
    const p = buildUserPrompt(withFeedback);
    expect(p).toContain('fix the rate limit');
  });
});

describe('ApiGatewayArchitect — class-level integration', () => {
  it('uses the architect class with a fake spawner', async () => {
    const { fn: spawner } = fakeGoldenSpawner();
    const a = new ApiGatewayArchitect({ spawner });
    const out = await a.run(buildFakeInput());
    expect(out.architectName).toBe('apiGateway');
    expect(out.status).toBe('ok');
  });
});
