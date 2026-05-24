import { describe, it, expect } from 'vitest';

import {
  TESTING_OWNED_FIELD_KEYS,
  REQUIRED_TEST_TYPES,
  ALLOWED_PYRAMID_SHAPES,
  ALLOWED_MUTATION_TOOLS,
  ALLOWED_E2E_RUNNERS
} from '../src/contract.js';
import { buildTestingSystemPrompt } from '../src/system-prompt.js';

describe('buildTestingSystemPrompt', () => {
  it('returns a non-empty string', () => {
    const p = buildTestingSystemPrompt();
    expect(typeof p).toBe('string');
    expect(p.length).toBeGreaterThan(500);
  });

  it('is deterministic across calls', () => {
    expect(buildTestingSystemPrompt()).toBe(buildTestingSystemPrompt());
  });

  it('contains the Role section', () => {
    const p = buildTestingSystemPrompt();
    expect(p).toContain('## Role');
    expect(p).toContain("CAIA's Testing Architect");
  });

  it('distinguishes itself from Test Author Agent + Test Reviewer Agent', () => {
    const p = buildTestingSystemPrompt();
    expect(p).toContain('Test Author Agent');
    expect(p).toContain('Test Reviewer Agent');
    expect(p).toContain('STRATEGY');
  });

  it('contains the Locked stack section', () => {
    const p = buildTestingSystemPrompt();
    expect(p).toContain('## Locked stack');
    expect(p).toContain('Playwright');
    expect(p).toContain('Stryker');
    expect(p).toContain('broad-base');
  });

  it('contains the Output JSON schema section', () => {
    const p = buildTestingSystemPrompt();
    expect(p).toContain('## Output JSON schema');
    expect(p).toContain('architectName');
    expect(p).toContain('architectureFields');
    expect(p).toContain('confidence');
    expect(p).toContain('notes');
    expect(p).toContain('risks');
    expect(p).toContain('status');
  });

  it('references every declared owned field at least once', () => {
    const p = buildTestingSystemPrompt();
    for (const key of TESTING_OWNED_FIELD_KEYS) {
      expect(p).toContain(key);
    }
  });

  it('references every required test type at least once', () => {
    const p = buildTestingSystemPrompt();
    for (const t of REQUIRED_TEST_TYPES) {
      expect(p).toContain(t);
    }
  });

  it('references every allowed pyramid shape at least once', () => {
    const p = buildTestingSystemPrompt();
    for (const shape of ALLOWED_PYRAMID_SHAPES) {
      expect(p).toContain(shape);
    }
  });

  it('references every allowed mutation tool at least once', () => {
    const p = buildTestingSystemPrompt();
    for (const tool of ALLOWED_MUTATION_TOOLS) {
      expect(p).toContain(tool);
    }
  });

  it('references every allowed e2e runner at least once', () => {
    const p = buildTestingSystemPrompt();
    for (const runner of ALLOWED_E2E_RUNNERS) {
      expect(p).toContain(runner);
    }
  });

  it('contains the Decision heuristics section', () => {
    const p = buildTestingSystemPrompt();
    expect(p).toContain('## Decision heuristics');
  });

  it('contains a Refusal patterns section', () => {
    const p = buildTestingSystemPrompt();
    expect(p).toContain('## Refusal patterns');
    expect(p).toContain('testing.*');
  });

  it('contains a Self-check section', () => {
    expect(buildTestingSystemPrompt()).toContain('## Self-check');
  });

  it('contains an Examples section pointing at golden fixture', () => {
    const p = buildTestingSystemPrompt();
    expect(p).toContain('## Examples');
    expect(p).toContain('tests/golden');
  });

  it('size is bounded (< 22k chars)', () => {
    expect(buildTestingSystemPrompt().length).toBeLessThan(22_000);
  });

  it('declares the upstream Frontend + Backend + Database inputs', () => {
    const p = buildTestingSystemPrompt();
    expect(p).toContain('frontend.componentTree');
    expect(p).toContain('backend.apiEndpoints');
    expect(p).toContain('database.schemaDDL');
  });

  it('asserts page-object pattern is mandatory', () => {
    expect(buildTestingSystemPrompt().toLowerCase()).toContain('page-object');
  });

  it('asserts the determinism mandate (clockMock + RNG)', () => {
    const p = buildTestingSystemPrompt();
    expect(p).toContain('clockMock');
    expect(p.toLowerCase()).toContain('rng');
  });
});
