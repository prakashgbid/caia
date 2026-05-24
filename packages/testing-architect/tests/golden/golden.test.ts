/**
 * Golden test — the canonical known-good Testing-architect artifact for
 * a known prakash-tiwari contact-form Story ticket.
 *
 * Includes a "pyramid realism" check that ensures the mix is not 100%
 * unit / 0% e2e (the classic LLM anti-pattern) — required by the task
 * brief.
 */

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

import { TestingArchitect } from '../../src/architect.js';
import { TESTING_OWNED_FIELD_KEYS } from '../../src/contract.js';
import { TESTING_INVARIANTS } from '../../src/invariants.js';
import { validateArchitectOutput } from '../../src/validation.js';
import {
  buildFakeInput,
  fakeGoldenSpawner,
  goldenAssistantText,
  goldenExpectedOutput
} from '../helpers/fakes.js';

const __dirname = dirname(fileURLToPath(import.meta.url));

describe('golden — prakash-tiwari contact-form Story ticket', () => {
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
    const result = validateArchitectOutput(goldenAssistantText(), TESTING_OWNED_FIELD_KEYS);
    expect(result.ok).toBe(true);
  });

  it('end-to-end produces the canonical ArchitectOutput', async () => {
    const { fn: spawner } = fakeGoldenSpawner();
    const arch = new TestingArchitect({ spawner });
    const out = await arch.run(buildFakeInput());

    expect(out.architectName).toBe('testing');
    expect(out.status).toBe('ok');
    expect(out.confidence).toBeGreaterThan(0.5);

    for (const k of TESTING_OWNED_FIELD_KEYS) {
      expect(out.architectureFields).toHaveProperty(k);
    }

    const expected = goldenExpectedOutput();
    expect(out.architectureFields).toEqual(expected.architectureFields);
    expect(out.confidence).toBe(expected.confidence);
    expect(out.notes).toBe(expected.notes);
    expect(out.risks).toEqual(expected.risks);
    expect(out.dependencies).toContain('frontend');
    expect(out.dependencies).toContain('backend');
    expect(out.dependencies).toContain('database');
  });

  it('output passes every Testing invariant', async () => {
    const { fn: spawner } = fakeGoldenSpawner();
    const arch = new TestingArchitect({ spawner });
    const out = await arch.run(buildFakeInput());

    for (const inv of TESTING_INVARIANTS) {
      const ok = inv.detect(out.architectureFields);
      expect(ok, `invariant ${inv.id} should pass on the golden output`).toBe(true);
    }
  });

  it('idempotent — running twice yields equivalent ArchitectOutput', async () => {
    const { fn: spawner } = fakeGoldenSpawner();
    const arch = new TestingArchitect({ spawner });
    const a = await arch.run(buildFakeInput());
    const b = await arch.run(buildFakeInput());
    expect(a).toEqual(b);
  });
});

describe('golden — pyramid realism', () => {
  /**
   * The headline check the task brief asks for: verify the golden
   * pyramid is realistic. Specifically:
   *   - no 100% unit / 0% e2e degenerate case
   *   - every ticket type has both integration AND e2e share > 0
   *   - e2e share does not exceed 50%
   *   - unit share is at least 30%
   *   - mix sums to exactly 100 per ticket type
   *   - all six required test types are present
   */
  const golden = goldenExpectedOutput();
  const mix = golden.architectureFields['testing.testTypeMixPercentages'] as Record<
    string,
    Record<string, number>
  >;

  it('declares mix for at least one ticket type', () => {
    expect(Object.keys(mix).length).toBeGreaterThan(0);
  });

  it('every ticket type has non-zero e2e share', () => {
    for (const [ticketType, perType] of Object.entries(mix)) {
      expect(perType.e2e, `${ticketType} must have non-zero e2e share`).toBeGreaterThan(0);
    }
  });

  it('every ticket type has non-zero integration share', () => {
    for (const [ticketType, perType] of Object.entries(mix)) {
      expect(
        perType.integration,
        `${ticketType} must have non-zero integration share`
      ).toBeGreaterThan(0);
    }
  });

  it('no ticket type has 100% unit (the classic LLM anti-pattern)', () => {
    for (const [ticketType, perType] of Object.entries(mix)) {
      expect(perType.unit, `${ticketType} must not be 100% unit`).toBeLessThan(100);
    }
  });

  it('e2e share never exceeds 50% (unmaintainable threshold)', () => {
    for (const [ticketType, perType] of Object.entries(mix)) {
      expect(perType.e2e, `${ticketType} e2e share must be <= 50%`).toBeLessThanOrEqual(50);
    }
  });

  it('unit share is at least 30% (broad-base pyramid floor)', () => {
    for (const [ticketType, perType] of Object.entries(mix)) {
      expect(
        perType.unit,
        `${ticketType} unit share must be >= 30% (broad-base floor)`
      ).toBeGreaterThanOrEqual(30);
    }
  });

  it('every ticket type sums to exactly 100', () => {
    for (const [ticketType, perType] of Object.entries(mix)) {
      const sum = Object.values(perType).reduce((acc, v) => acc + v, 0);
      expect(sum, `${ticketType} mix must sum to exactly 100`).toBe(100);
    }
  });

  it('every ticket type declares all six required test types', () => {
    const required = ['unit', 'integration', 'e2e', 'visual', 'a11y', 'perf'];
    for (const [ticketType, perType] of Object.entries(mix)) {
      for (const t of required) {
        expect(perType, `${ticketType} must declare ${t}`).toHaveProperty(t);
      }
    }
  });

  it('pyramid shape is broad-base (V1 default)', () => {
    const strategy = golden.architectureFields['testing.testingStrategy'] as Record<string, unknown>;
    expect(strategy.pyramidShape).toBe('broad-base');
  });
});
