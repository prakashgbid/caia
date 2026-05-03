import { describe, expect, it } from 'vitest';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import YAML from 'yaml';
import { ProcessSchema, type Process } from '../src/process-graph.js';
import { evaluateProcess } from '../src/evaluate.js';
import {
  POSITIVE_CASES,
  NEGATIVE_CASES,
  ADVERSARIAL_CASES,
} from './fixtures/post-release-back-merge.adversarial.js';

const __dirname = dirname(fileURLToPath(import.meta.url));

async function loadBackMergeProcess(): Promise<Process> {
  const path = resolve(__dirname, '../processes/post-release-back-merge.yaml');
  const raw = await readFile(path, 'utf8');
  const parsed = YAML.parse(raw) as unknown;
  return ProcessSchema.parse(parsed);
}

describe('evaluateProcess — post-release-back-merge', () => {
  it('loads the YAML file successfully (schema-validates the production rule)', async () => {
    const process = await loadBackMergeProcess();
    expect(process.id).toBe('post-release-back-merge');
    expect(process.transitions.length).toBeGreaterThan(0);
  });

  describe('POSITIVE cases (drift expected)', () => {
    POSITIVE_CASES.forEach((c) => {
      it(c.name, async () => {
        const process = await loadBackMergeProcess();
        const drifts = evaluateProcess(process, c.events, { now: c.cycleAt });
        expect(drifts.length).toBe(c.expectedDriftCount);
        if (drifts.length > 0) {
          expect(drifts[0]!.processId).toBe('post-release-back-merge');
          expect(['medium', 'high']).toContain(drifts[0]!.severity);
        }
      });
    });
  });

  describe('NEGATIVE cases (no drift)', () => {
    NEGATIVE_CASES.forEach((c) => {
      it(c.name, async () => {
        const process = await loadBackMergeProcess();
        const drifts = evaluateProcess(process, c.events, { now: c.cycleAt });
        expect(drifts.length).toBe(0);
      });
    });
  });

  describe('ADVERSARIAL cases', () => {
    ADVERSARIAL_CASES.forEach((c) => {
      it(c.name, async () => {
        const process = await loadBackMergeProcess();
        const drifts = evaluateProcess(process, c.events, { now: c.cycleAt });
        expect(drifts.length).toBe(c.expectedDriftCount);
      });
    });
  });

  it('returns no drifts when the process is disabled', async () => {
    const process = await loadBackMergeProcess();
    const disabled: Process = { ...process, enabled: false };
    const drifts = evaluateProcess(disabled, POSITIVE_CASES[0]!.events, {
      now: POSITIVE_CASES[0]!.cycleAt,
    });
    expect(drifts).toEqual([]);
  });
});

describe('evaluateProcess — drift payload shape', () => {
  it('emits a drift with the expected fields for the back-merge case', async () => {
    const process = await loadBackMergeProcess();
    const drifts = evaluateProcess(process, POSITIVE_CASES[0]!.events, {
      now: POSITIVE_CASES[0]!.cycleAt,
    });
    expect(drifts.length).toBe(1);
    const d = drifts[0]!;
    expect(d.processId).toBe('post-release-back-merge');
    expect(d.processVersion).toBe(1);
    expect(d.fromEventType).toBe('release_landed');
    expect(d.expectedNext).toBe('back_merge_opened');
    expect(d.deadlineMin).toBe(30);
    expect(d.severity).toBe('medium');
    expect(d.recoveryKind).toBe('open-back-merge-pr');
    expect(d.detectedAt).toBeGreaterThanOrEqual(d.fromObservedAt + 30 * 60_000);
    expect(d.recoveryPayload).toBeDefined();
  });
});
