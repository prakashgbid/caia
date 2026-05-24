/**
 * Golden test — the canonical known-good Feature-Flagging-architect
 * artifact for a known prakash-tiwari Story ticket.
 *
 * This test serves three purposes:
 *
 *   1. Lock the architect's output shape against drift. Any change to
 *      the contract or run() must update this snapshot.
 *
 *   2. Demonstrate the architect produces a complete, validating output
 *      end-to-end given a realistic input (with upstream FE+BE).
 *
 *   3. Verify the depends-on plumbing: upstream Frontend + Backend
 *      output flows into the user prompt unmodified.
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

import { FeatureFlaggingArchitect } from '../../src/architect.js';
import { FEATURE_FLAGGING_OWNED_FIELD_KEYS } from '../../src/contract.js';
import { FEATURE_FLAGGING_INVARIANTS } from '../../src/invariants.js';
import { validateArchitectOutput } from '../../src/validation.js';
import {
  buildFakeInput,
  fakeGoldenSpawner,
  goldenAssistantText,
  goldenExpectedOutput
} from '../helpers/fakes.js';

const __dirname = dirname(fileURLToPath(import.meta.url));

describe('golden — prakash-tiwari new-booking-flow Story ticket', () => {
  it('input-ticket.json fixture loads and matches buildFakeInput()', () => {
    const raw = JSON.parse(
      readFileSync(resolve(__dirname, 'input-ticket.json'), 'utf-8')
    );
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

  it('input-upstream-frontend.json fixture loads and matches the upstream FE output', () => {
    const raw = JSON.parse(
      readFileSync(resolve(__dirname, 'input-upstream-frontend.json'), 'utf-8')
    );
    const fixture = buildFakeInput().upstream.outputs?.frontend;
    expect(raw).toEqual(fixture);
  });

  it('input-upstream-backend.json fixture loads and matches the upstream BE output', () => {
    const raw = JSON.parse(
      readFileSync(resolve(__dirname, 'input-upstream-backend.json'), 'utf-8')
    );
    const fixture = buildFakeInput().upstream.outputs?.backend;
    expect(raw).toEqual(fixture);
  });

  it('assistant text validates cleanly', () => {
    const result = validateArchitectOutput(
      goldenAssistantText(),
      FEATURE_FLAGGING_OWNED_FIELD_KEYS
    );
    expect(result.ok).toBe(true);
  });

  it('end-to-end produces the canonical ArchitectOutput', async () => {
    const { fn: spawner } = fakeGoldenSpawner();
    const arch = new FeatureFlaggingArchitect({ spawner });
    const out = await arch.run(buildFakeInput());

    // Architect name, status, top-level shape
    expect(out.architectName).toBe('featureFlagging');
    expect(out.status).toBe('ok');
    expect(out.confidence).toBeGreaterThan(0.5);

    // Every owned field present
    for (const k of FEATURE_FLAGGING_OWNED_FIELD_KEYS) {
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

  it('output passes every Feature Flagging invariant', async () => {
    const { fn: spawner } = fakeGoldenSpawner();
    const arch = new FeatureFlaggingArchitect({ spawner });
    const out = await arch.run(buildFakeInput());

    for (const inv of FEATURE_FLAGGING_INVARIANTS) {
      const ok = inv.detect(out.architectureFields);
      expect(ok, `invariant ${inv.id} should pass on the golden output`).toBe(true);
    }
  });

  it('idempotent — running twice yields equivalent ArchitectOutput', async () => {
    const { fn: spawner } = fakeGoldenSpawner();
    const arch = new FeatureFlaggingArchitect({ spawner });
    const a = await arch.run(buildFakeInput());
    const b = await arch.run(buildFakeInput());
    expect(a).toEqual(b);
  });

  it('golden output contains a kill switch with blastRadius=payments', () => {
    const switches = (goldenExpectedOutput().architectureFields[
      'featureFlags.killSwitches'
    ] ?? []) as Array<{ blastRadius: string }>;
    expect(switches.length).toBeGreaterThan(0);
    expect(switches.some(s => s.blastRadius === 'payments')).toBe(true);
  });

  it('golden output forward-references A/B Testing via experimentationLinkage', () => {
    const linkage = (goldenExpectedOutput().architectureFields[
      'featureFlags.experimentationLinkage'
    ] ?? []) as Array<{ abTestId: string }>;
    expect(linkage.length).toBeGreaterThan(0);
    for (const entry of linkage) {
      expect(entry.abTestId).toBeTruthy();
    }
  });

  it('golden output declares per-environment defaults (dev/staging/production) for every flag', () => {
    const schema = (goldenExpectedOutput().architectureFields[
      'featureFlags.flagsSchema'
    ] ?? []) as Array<{ defaults: Record<string, unknown> }>;
    for (const flag of schema) {
      expect(flag.defaults).toHaveProperty('dev');
      expect(flag.defaults).toHaveProperty('staging');
      expect(flag.defaults).toHaveProperty('production');
    }
  });
});
