/**
 * Golden test — the canonical known-good API-Gateway-architect artifact
 * for a known prakash-tiwari Form Story ticket (POST /v1/contacts).
 */

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

import { ApiGatewayArchitect } from '../../src/architect.js';
import { API_GATEWAY_OWNED_FIELD_KEYS } from '../../src/contract.js';
import { API_GATEWAY_INVARIANTS } from '../../src/invariants.js';
import { validateArchitectOutput } from '../../src/validation.js';
import {
  buildFakeInput,
  fakeGoldenSpawner,
  goldenAssistantText,
  goldenExpectedOutput
} from '../helpers/fakes.js';

const __dirname = dirname(fileURLToPath(import.meta.url));

describe('golden — prakash-tiwari contact-form Form Story ticket', () => {
  it('input-ticket.json fixture loads and matches buildFakeInput()', () => {
    const raw = JSON.parse(readFileSync(resolve(__dirname, 'input-ticket.json'), 'utf-8'));
    const fixture = buildFakeInput().ticket;
    expect(raw).toEqual(fixture);
  });

  it('input-businessplan.json fixture loads and matches buildFakeInput()', () => {
    const raw = JSON.parse(
      readFileSync(resolve(__dirname, 'input-businessplan.json'), 'utf-8')
    );
    const fixture = buildFakeInput().businessPlan;
    expect(raw).toEqual(fixture);
  });

  it('input-upstream.json fixture loads and matches buildFakeInput()', () => {
    const raw = JSON.parse(readFileSync(resolve(__dirname, 'input-upstream.json'), 'utf-8'));
    const fixture = buildFakeInput().upstream;
    expect(raw).toEqual(fixture);
  });

  it('assistant text validates cleanly', () => {
    const result = validateArchitectOutput(goldenAssistantText(), API_GATEWAY_OWNED_FIELD_KEYS);
    expect(result.ok).toBe(true);
  });

  it('end-to-end produces the canonical ArchitectOutput', async () => {
    const { fn: spawner } = fakeGoldenSpawner();
    const arch = new ApiGatewayArchitect({ spawner });
    const out = await arch.run(buildFakeInput());

    expect(out.architectName).toBe('apiGateway');
    expect(out.status).toBe('ok');
    expect(out.confidence).toBeGreaterThan(0.5);

    for (const k of API_GATEWAY_OWNED_FIELD_KEYS) {
      expect(out.architectureFields).toHaveProperty(k);
    }

    const expected = goldenExpectedOutput();
    expect(out.architectureFields).toEqual(expected.architectureFields);
    expect(out.confidence).toBe(expected.confidence);
    expect(out.notes).toBe(expected.notes);
    expect(out.risks).toEqual(expected.risks);
    expect(out.dependencies).toContain('backend');
    expect(out.dependencies).toContain('security');
  });

  it('output passes every API Gateway invariant', async () => {
    const { fn: spawner } = fakeGoldenSpawner();
    const arch = new ApiGatewayArchitect({ spawner });
    const out = await arch.run(buildFakeInput());

    for (const inv of API_GATEWAY_INVARIANTS) {
      const ok = inv.detect(out.architectureFields);
      expect(ok, `invariant ${inv.id} should pass on the golden output`).toBe(true);
    }
  });

  it('idempotent — running twice yields equivalent ArchitectOutput', async () => {
    const { fn: spawner } = fakeGoldenSpawner();
    const arch = new ApiGatewayArchitect({ spawner });
    const a = await arch.run(buildFakeInput());
    const b = await arch.run(buildFakeInput());
    expect(a).toEqual(b);
  });

  it('every Backend route has a matching authGates entry', async () => {
    const { fn: spawner } = fakeGoldenSpawner();
    const arch = new ApiGatewayArchitect({ spawner });
    const out = await arch.run(buildFakeInput());

    const backendEndpoints = buildFakeInput().upstream.outputs.backend.architectureFields[
      'backend.apiEndpoints'
    ] as Array<{ method: string; path: string }>;
    const authGates = out.architectureFields['apiGateway.authGates'] as Record<string, unknown>;
    for (const ep of backendEndpoints) {
      const key = `${ep.method} ${ep.path}`;
      expect(authGates).toHaveProperty(key);
    }
  });

  it('every Backend route has a matching rateLimits.perRoute entry', async () => {
    const { fn: spawner } = fakeGoldenSpawner();
    const arch = new ApiGatewayArchitect({ spawner });
    const out = await arch.run(buildFakeInput());

    const backendEndpoints = buildFakeInput().upstream.outputs.backend.architectureFields[
      'backend.apiEndpoints'
    ] as Array<{ method: string; path: string }>;
    const perRoute = (out.architectureFields['apiGateway.rateLimits'] as {
      perRoute: Record<string, unknown>;
    }).perRoute;
    for (const ep of backendEndpoints) {
      const key = `${ep.method} ${ep.path}`;
      expect(perRoute).toHaveProperty(key);
    }
  });

  it('errorEnvelope extends (does not replace) Backend\'s errorEnvelope', async () => {
    const { fn: spawner } = fakeGoldenSpawner();
    const arch = new ApiGatewayArchitect({ spawner });
    const out = await arch.run(buildFakeInput());
    const env = out.architectureFields['apiGateway.errorEnvelope'] as {
      extends: string;
      addedFields: Record<string, unknown>;
    };
    expect(env.extends).toBe('backend.errorEnvelope');
    expect(env.addedFields).toHaveProperty('requestId');
    expect(env.addedFields).toHaveProperty('gatewayCode');
    expect(env.addedFields).toHaveProperty('retryable');
  });
});
