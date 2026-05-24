/**
 * System-prompt tests — verifies the briefing satisfies spec §11(b).
 */

import { describe, it, expect } from 'vitest';

import {
  API_GATEWAY_OWNED_FIELD_KEYS,
  REQUIRED_GATEWAY_CODES,
  REQUIRED_QUOTA_TIERS
} from '../src/contract.js';
import { buildApiGatewaySystemPrompt } from '../src/system-prompt.js';

describe('buildApiGatewaySystemPrompt', () => {
  it('returns a non-empty string', () => {
    const p = buildApiGatewaySystemPrompt();
    expect(typeof p).toBe('string');
    expect(p.length).toBeGreaterThan(500);
  });

  it('is deterministic across calls', () => {
    const p1 = buildApiGatewaySystemPrompt();
    const p2 = buildApiGatewaySystemPrompt();
    expect(p1).toBe(p2);
  });

  it('contains the Role section', () => {
    const p = buildApiGatewaySystemPrompt();
    expect(p).toContain('## Role');
    expect(p).toContain("CAIA's API Gateway Architect");
  });

  it('contains the Locked stack section', () => {
    const p = buildApiGatewaySystemPrompt();
    expect(p).toContain('## Locked stack');
    expect(p).toContain('Cloudflare');
    expect(p).toContain('HMAC-SHA256');
    expect(p).toContain('X-Request-Id');
  });

  it('contains the Output JSON schema section', () => {
    const p = buildApiGatewaySystemPrompt();
    expect(p).toContain('## Output JSON schema');
    expect(p).toContain('architectName');
    expect(p).toContain('architectureFields');
    expect(p).toContain('confidence');
    expect(p).toContain('notes');
    expect(p).toContain('risks');
    expect(p).toContain('status');
  });

  it('references every declared owned field at least once', () => {
    const p = buildApiGatewaySystemPrompt();
    for (const key of API_GATEWAY_OWNED_FIELD_KEYS) {
      expect(p).toContain(key);
    }
  });

  it('references every required gateway code at least once', () => {
    const p = buildApiGatewaySystemPrompt();
    for (const code of REQUIRED_GATEWAY_CODES) {
      expect(p).toContain(code);
    }
  });

  it('references every required quota tier at least once', () => {
    const p = buildApiGatewaySystemPrompt();
    for (const tier of REQUIRED_QUOTA_TIERS) {
      expect(p).toContain(tier);
    }
  });

  it('contains the Decision heuristics section', () => {
    const p = buildApiGatewaySystemPrompt();
    expect(p).toContain('## Decision heuristics');
  });

  it('contains a Refusal patterns section that rejects out-of-namespace writes', () => {
    const p = buildApiGatewaySystemPrompt();
    expect(p).toContain('## Refusal patterns');
    expect(p).toContain('apiGateway.*');
  });

  it('contains a Self-check section', () => {
    const p = buildApiGatewaySystemPrompt();
    expect(p).toContain('## Self-check');
  });

  it('contains an Examples section pointing at golden fixture', () => {
    const p = buildApiGatewaySystemPrompt();
    expect(p).toContain('## Examples');
    expect(p).toContain('tests/golden');
  });

  it('does not refer to fields outside the `apiGateway.*` namespace', () => {
    const p = buildApiGatewaySystemPrompt();
    const foreignPrefixes = [
      'frontend.componentTree',
      'database.schemaDDL',
      'security.cspPolicy',
      'analytics.eventTaxonomy',
      'observability.logShape'
    ];
    for (const prefix of foreignPrefixes) {
      expect(p).not.toContain(prefix);
    }
  });

  it('size is bounded (token-budget proxy: < 22k chars)', () => {
    const p = buildApiGatewaySystemPrompt();
    expect(p.length).toBeLessThan(22_000);
  });

  it('declares the upstream Backend + Security inputs', () => {
    const p = buildApiGatewaySystemPrompt();
    expect(p).toContain('backend.apiEndpoints');
    expect(p).toContain('security.authenticationStrategy');
  });
});
