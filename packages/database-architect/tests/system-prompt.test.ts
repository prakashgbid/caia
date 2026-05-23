/**
 * System-prompt tests — verifies the briefing satisfies spec §11(b):
 *
 *   - Parses cleanly as text (non-empty, no obvious corruption).
 *   - References every declared owned field at least once.
 *   - Contains the standard architect-output JSON schema instruction.
 *   - Under a reasonable size (token budget proxy).
 *   - Idempotent (pure function).
 */

import { describe, it, expect } from 'vitest';

import { DATABASE_OWNED_FIELD_KEYS } from '../src/contract.js';
import { buildDatabaseSystemPrompt } from '../src/system-prompt.js';

describe('buildDatabaseSystemPrompt', () => {
  it('returns a non-empty string', () => {
    const p = buildDatabaseSystemPrompt();
    expect(typeof p).toBe('string');
    expect(p.length).toBeGreaterThan(500);
  });

  it('is deterministic across calls', () => {
    const p1 = buildDatabaseSystemPrompt();
    const p2 = buildDatabaseSystemPrompt();
    expect(p1).toBe(p2);
  });

  it('contains the Role section', () => {
    const p = buildDatabaseSystemPrompt();
    expect(p).toContain('## Role');
    expect(p).toContain("CAIA's Database Architect");
  });

  it('contains the Locked stack section with Postgres + Drizzle + per-tenant isolation', () => {
    const p = buildDatabaseSystemPrompt();
    expect(p).toContain('## Locked stack');
    expect(p).toContain('Postgres');
    expect(p).toContain('Drizzle');
    expect(p).toContain('schema-per-tenant');
    expect(p).toContain('GIN');
    expect(p).toContain('RLS');
  });

  it('contains the Output JSON schema section', () => {
    const p = buildDatabaseSystemPrompt();
    expect(p).toContain('## Output JSON schema');
    expect(p).toContain('architectName');
    expect(p).toContain('architectureFields');
    expect(p).toContain('confidence');
    expect(p).toContain('notes');
    expect(p).toContain('risks');
    expect(p).toContain('status');
  });

  it('references every declared owned field at least once', () => {
    const p = buildDatabaseSystemPrompt();
    for (const key of DATABASE_OWNED_FIELD_KEYS) {
      expect(p).toContain(key);
    }
  });

  it('contains the Decision heuristics section', () => {
    const p = buildDatabaseSystemPrompt();
    expect(p).toContain('## Decision heuristics');
    expect(p).toContain('JSONB');
    expect(p).toContain('GIN');
  });

  it('contains a Refusal patterns section that rejects out-of-namespace writes', () => {
    const p = buildDatabaseSystemPrompt();
    expect(p).toContain('## Refusal patterns');
    expect(p).toContain('database.*');
  });

  it('contains a Self-check section', () => {
    const p = buildDatabaseSystemPrompt();
    expect(p).toContain('## Self-check');
  });

  it('contains an Examples section pointing at golden fixture', () => {
    const p = buildDatabaseSystemPrompt();
    expect(p).toContain('## Examples');
    expect(p).toContain('tests/golden');
  });

  it('mentions reading Backend\'s upstream output (Database\'s primary input)', () => {
    const p = buildDatabaseSystemPrompt();
    expect(p).toContain('Backend');
    expect(p).toContain('apiEndpoints');
  });

  it('does not refer to fields outside the `database.*` namespace', () => {
    const p = buildDatabaseSystemPrompt();
    // Reject other architects' fields appearing — they are someone
    // else's territory. (Allow casual mentions of "Backend" the role,
    // but not e.g. backend.apiShape which would imply Database is
    // emitting that field.)
    const foreignFields = [
      'frontend.componentTree',
      'frontend.tokens',
      'security.cspPolicy',
      'analytics.eventTaxonomy',
      'observability.logShape',
      'a11y.wcagLevel'
    ];
    for (const field of foreignFields) {
      expect(p).not.toContain(field);
    }
  });

  it('size is bounded (token-budget proxy: < 16k chars)', () => {
    const p = buildDatabaseSystemPrompt();
    expect(p.length).toBeLessThan(16_000);
  });
});
