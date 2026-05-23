/**
 * Golden test — the canonical known-good AI/ML-architect artifact for
 * a known prakash-tiwari Story ticket (auto-tag incoming inquiry emails).
 *
 * This test serves three purposes:
 *
 *   1. Lock the architect's output shape against drift. Any change to
 *      the contract or run() must update this snapshot.
 *
 *   2. Demonstrate the architect produces a complete, validating output
 *      end-to-end given a realistic AI-touching input.
 *
 *   3. Serve as the canonical fixture for downstream conformance work
 *      (EA Reviewer invariants, dispatcher integration tests).
 *
 * Note: this test uses a deterministic fake spawner. It does NOT call
 * the real claude binary. The "golden" here is the expected
 * deterministic projection of the input through the run() pipeline,
 * given a fixed assistant text.
 */

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

import { AIMLArchitect } from '../../src/architect.js';
import { AIML_OWNED_FIELD_KEYS } from '../../src/contract.js';
import { AIML_INVARIANTS } from '../../src/invariants.js';
import { validateArchitectOutput } from '../../src/validation.js';
import {
  buildFakeInput,
  fakeGoldenSpawner,
  goldenAssistantText,
  goldenExpectedOutput
} from '../helpers/fakes.js';

const __dirname = dirname(fileURLToPath(import.meta.url));

describe('golden — prakash-tiwari auto-tag inquiry Story ticket', () => {
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

  it('input-designversion.json fixture loads and matches buildFakeInput()', () => {
    const raw = JSON.parse(
      readFileSync(resolve(__dirname, 'input-designversion.json'), 'utf-8')
    );
    const fixture = buildFakeInput().designVersion;
    expect(raw).toEqual(fixture);
  });

  it('assistant text validates cleanly', () => {
    const result = validateArchitectOutput(goldenAssistantText(), AIML_OWNED_FIELD_KEYS);
    expect(result.ok).toBe(true);
  });

  it('end-to-end produces the canonical ArchitectOutput', async () => {
    const { fn: spawner } = fakeGoldenSpawner();
    const arch = new AIMLArchitect({ spawner });
    const out = await arch.run(buildFakeInput());

    // Architect name, status, top-level shape
    expect(out.architectName).toBe('ai-ml');
    expect(out.status).toBe('ok');
    expect(out.confidence).toBeGreaterThan(0.5);

    // Every owned field present
    for (const k of AIML_OWNED_FIELD_KEYS) {
      expect(out.architectureFields).toHaveProperty(k);
    }

    // Field values match the known-good expectation (except spend, which
    // the run pipeline overwrites).
    const expected = goldenExpectedOutput();
    expect(out.architectureFields).toEqual(expected.architectureFields);
    expect(out.confidence).toBe(expected.confidence);
    expect(out.notes).toBe(expected.notes);
    expect(out.dependencies).toEqual(expected.dependencies);
    expect(out.risks).toEqual(expected.risks);
  });

  it('output passes every AI/ML invariant', async () => {
    const { fn: spawner } = fakeGoldenSpawner();
    const arch = new AIMLArchitect({ spawner });
    const out = await arch.run(buildFakeInput());

    for (const inv of AIML_INVARIANTS) {
      const ok = inv.detect(out.architectureFields);
      expect(ok, `invariant ${inv.id} should pass on the golden output`).toBe(true);
    }
  });

  it('idempotent — running twice yields equivalent ArchitectOutput', async () => {
    const { fn: spawner } = fakeGoldenSpawner();
    const arch = new AIMLArchitect({ spawner });
    const a = await arch.run(buildFakeInput());
    const b = await arch.run(buildFakeInput());
    expect(a).toEqual(b);
  });

  it('applies predicate accepts the golden ticket', async () => {
    const input = buildFakeInput();
    // The architect's appliesPredicate is independent of the run() flow.
    const mod = await import('../../src/contract.js');
    expect(mod.aimlArchitectAppliesPredicate(input.ticket)).toBe(true);
  });
});
