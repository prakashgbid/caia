/**
 * System-prompt tests — verifies the briefing satisfies spec §11(b).
 */

import { describe, it, expect } from 'vitest';

import { OBSERVABILITY_OWNED_FIELD_KEYS } from '../src/contract.js';
import { buildObservabilitySystemPrompt } from '../src/system-prompt.js';

describe('buildObservabilitySystemPrompt', () => {
  it('returns a non-empty string', () => {
    const p = buildObservabilitySystemPrompt();
    expect(typeof p).toBe('string');
    expect(p.length).toBeGreaterThan(500);
  });

  it('is deterministic across calls', () => {
    const p1 = buildObservabilitySystemPrompt();
    const p2 = buildObservabilitySystemPrompt();
    expect(p1).toBe(p2);
  });

  it('contains the Role section', () => {
    const p = buildObservabilitySystemPrompt();
    expect(p).toContain('## Role');
    expect(p).toContain("CAIA's Observability Architect");
  });

  it('contains the Locked tooling section', () => {
    const p = buildObservabilitySystemPrompt();
    expect(p).toContain('## Locked tooling');
    expect(p).toContain('@chiefaia/logger');
    expect(p).toContain('@chiefaia/tracing');
    expect(p).toContain('@chiefaia/metrics');
    expect(p).toContain('OpenTelemetry');
    expect(p).toContain('Prometheus');
  });

  it('contains the Output JSON schema section', () => {
    const p = buildObservabilitySystemPrompt();
    expect(p).toContain('## Output JSON schema');
    expect(p).toContain('architectName');
    expect(p).toContain('architectureFields');
    expect(p).toContain('confidence');
    expect(p).toContain('notes');
    expect(p).toContain('risks');
    expect(p).toContain('status');
  });

  it('references every declared owned field at least once', () => {
    const p = buildObservabilitySystemPrompt();
    for (const key of OBSERVABILITY_OWNED_FIELD_KEYS) {
      expect(p).toContain(key);
    }
  });

  it('contains the Decision heuristics section', () => {
    const p = buildObservabilitySystemPrompt();
    expect(p).toContain('## Decision heuristics');
    expect(p).toContain('SLO');
  });

  it('contains a Refusal patterns section that rejects out-of-namespace writes', () => {
    const p = buildObservabilitySystemPrompt();
    expect(p).toContain('## Refusal patterns');
    expect(p).toContain('observability.*');
  });

  it('contains a Self-check section', () => {
    const p = buildObservabilitySystemPrompt();
    expect(p).toContain('## Self-check');
  });

  it('contains an Examples section pointing at golden fixture', () => {
    const p = buildObservabilitySystemPrompt();
    expect(p).toContain('## Examples');
    expect(p).toContain('tests/golden');
  });

  it('cites the Backend upstream dependency (apiEndpoints, errorEnvelope)', () => {
    const p = buildObservabilitySystemPrompt();
    expect(p).toContain('backend.apiEndpoints');
    expect(p).toContain('backend.errorEnvelope');
  });

  it('declares the severity ladder (P0/P1/P2)', () => {
    const p = buildObservabilitySystemPrompt();
    expect(p).toMatch(/P0/);
    expect(p).toMatch(/P1/);
    expect(p).toMatch(/P2/);
  });

  it('does not declare foreign architect fields in the owned-table slice', () => {
    const p = buildObservabilitySystemPrompt();
    const foreignOwnedDeclarations = [
      'frontend.componentTree',
      'database.schemaDDL',
      'security.cspPolicy',
      'a11y.wcagLevel'
    ];
    const ownedTableSlice = p.split('## Output JSON schema')[1]?.split('## Decision heuristics')[0] ?? '';
    for (const foreign of foreignOwnedDeclarations) {
      expect(ownedTableSlice).not.toContain(foreign);
    }
  });

  it('size is bounded (token-budget proxy: < 20k chars)', () => {
    const p = buildObservabilitySystemPrompt();
    expect(p.length).toBeLessThan(20_000);
  });
});
