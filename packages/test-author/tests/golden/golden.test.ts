/**
 * Golden test — the canonical known-good Test Author artifact for the
 * prakash-tiwari Contact-form Story ticket (`ticket-pt-test-001`).
 *
 * The input fixtures (`input-ticket.json`, `input-architecture.json`)
 * mirror those used by `@caia/testing-architect`'s golden suite so the
 * Stage-9 strategy and the Stage-10 cases exercise the same EA-approved
 * canonical inputs.
 *
 * "Pyramid realism" check ensures the deterministic golden output isn't
 * the 100%-unit / 0%-e2e LLM anti-pattern. Required by the task brief.
 */

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

import { TestAuthorAgent } from '../../src/agent.js';
import { authorTests } from '../../src/api.js';
import { InMemoryTicketStore } from '../../src/persistence.js';
import {
  buildFakeArchitecture,
  buildFakeInput,
  buildFakeTicket,
  fakeGoldenSpawner,
  goldenExpectedOutput,
  RecordingStateMachine
} from '../helpers/fakes.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const FIXED_NOW = 1_716_624_000_000;

describe('golden — prakash-tiwari contact-form Story', () => {
  it('input-ticket.json fixture loads and matches buildFakeTicket()', () => {
    const raw = JSON.parse(readFileSync(resolve(__dirname, 'input-ticket.json'), 'utf-8'));
    const fixture = buildFakeTicket();
    expect(raw).toEqual(fixture);
  });

  it('input-architecture.json fixture loads and matches buildFakeArchitecture()', () => {
    const raw = JSON.parse(readFileSync(resolve(__dirname, 'input-architecture.json'), 'utf-8'));
    const fixture = buildFakeArchitecture();
    expect(raw).toEqual(fixture);
  });

  it('TestAuthorAgent.design produces the canonical AuthorOutput', async () => {
    const { fn: spawner } = fakeGoldenSpawner(FIXED_NOW);
    const agent = new TestAuthorAgent({ spawner, clock: () => FIXED_NOW });
    const out = await agent.design(buildFakeInput());

    const expected = goldenExpectedOutput(FIXED_NOW);
    expect(out.agentName).toBe('test-author');
    expect(out.status).toBe('ok');
    expect(out.testCases.length).toBe(expected.testCases.length);
    expect(out.testDesign).toEqual(expected.testDesign);
    expect(out.confidence).toBe(expected.confidence);
    expect(out.notes).toBe(expected.notes);
    expect(out.testCases).toEqual(expected.testCases);
  });

  it('pyramid realism — emits at least one e2e case (not the 100% unit anti-pattern)', async () => {
    const { fn: spawner } = fakeGoldenSpawner(FIXED_NOW);
    const agent = new TestAuthorAgent({ spawner, clock: () => FIXED_NOW });
    const out = await agent.design(buildFakeInput());
    const layers = new Set(out.testCases.map(tc => tc.layer));
    expect(layers.has('e2e')).toBe(true);
    expect(layers.has('unit')).toBe(true);
    expect(out.testDesign.layerCounts.unit).toBeLessThan(out.testCases.length);
  });

  it('every acceptance criterion is referenced by at least one case', async () => {
    const { fn: spawner } = fakeGoldenSpawner(FIXED_NOW);
    const agent = new TestAuthorAgent({ spawner, clock: () => FIXED_NOW });
    const out = await agent.design(buildFakeInput());
    const referenced = new Set<number>();
    for (const tc of out.testCases) {
      if (typeof tc.linkedAcceptanceCriterionIndex === 'number') {
        referenced.add(tc.linkedAcceptanceCriterionIndex);
      }
    }
    for (let i = 0; i < (buildFakeTicket().acceptance_criteria?.length ?? 0); i++) {
      expect(referenced.has(i), `AC ${i} unreferenced`).toBe(true);
    }
  });

  it('embeds the Lighthouse delta threshold from architecture.testing.perfRegressionBudgets', async () => {
    const { fn: spawner } = fakeGoldenSpawner(FIXED_NOW);
    const agent = new TestAuthorAgent({ spawner, clock: () => FIXED_NOW });
    const out = await agent.design(buildFakeInput());
    const perfCase = out.testCases.find(tc => tc.category === 'performance');
    expect(perfCase).toBeDefined();
    expect(perfCase?.then).toContain('Lighthouse');
    expect(perfCase?.then).toContain('LCP');
    expect(perfCase?.then).toContain('CLS');
  });

  it('emits an axe wcag2aa accessibility case when a11y.wcagLevel = AA', async () => {
    const { fn: spawner } = fakeGoldenSpawner(FIXED_NOW);
    const agent = new TestAuthorAgent({ spawner, clock: () => FIXED_NOW });
    const out = await agent.design(buildFakeInput());
    const a11y = out.testCases.find(tc => tc.category === 'accessibility');
    expect(a11y).toBeDefined();
    expect(a11y?.layer).toBe('accessibility');
    expect(a11y?.then).toContain('wcag2aa');
  });

  it('emits at least one error case for every entry in backend.errorEnvelope.mapping', async () => {
    const { fn: spawner } = fakeGoldenSpawner(FIXED_NOW);
    const agent = new TestAuthorAgent({ spawner, clock: () => FIXED_NOW });
    const out = await agent.design(buildFakeInput());
    const errorCount = out.testCases.filter(tc => tc.category === 'error').length;
    expect(errorCount).toBeGreaterThanOrEqual(1);
  });

  it('every selectorHint is a stable test-id / role selector (no nth-child)', async () => {
    const { fn: spawner } = fakeGoldenSpawner(FIXED_NOW);
    const agent = new TestAuthorAgent({ spawner, clock: () => FIXED_NOW });
    const out = await agent.design(buildFakeInput());
    for (const tc of out.testCases) {
      for (const hint of tc.selectorHints) {
        expect(hint).not.toMatch(/nth-child/);
        expect(hint).not.toMatch(/:contains/);
      }
    }
  });

  it('end-to-end via authorTests writes the canonical output to the store and emits the pass transition', async () => {
    const store = new InMemoryTicketStore();
    const t = buildFakeTicket();
    (t as Record<string, unknown>)['architecture'] = buildFakeArchitecture();
    store.setTicket(t);
    const sm = new RecordingStateMachine();
    const agent = new TestAuthorAgent({
      spawner: fakeGoldenSpawner(FIXED_NOW).fn,
      clock: () => FIXED_NOW
    });

    const outcome = await authorTests('ticket-pt-test-001', { store, stateMachine: sm, agent });

    expect(outcome.output.testCases.length).toBe(15);
    expect(outcome.emittedTransitions).toEqual([
      { from: 'ea-complete', to: 'tests-authored', intermediate: false }
    ]);
    const stored = store.readTicket('ticket-pt-test-001');
    expect((stored?.['testCases'] as unknown[]).length).toBe(15);
  });
});
