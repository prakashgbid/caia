import { describe, it, expect, beforeEach } from 'vitest';
import { mkdtempSync, existsSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  baselinePath,
  loadBaseline,
  writeBaseline,
  diffAgainstBaseline
} from '../src/baseline.js';
import type { AgentEvalResult } from '../src/types.js';

let tmpDir: string;

beforeEach(() => {
  tmpDir = mkdtempSync(join(tmpdir(), 'caia-prompt-evals-baseline-'));
});

function makeResult(overrides: Partial<AgentEvalResult> = {}): AgentEvalResult {
  return {
    agent: 'caia-po',
    evalPath: '/dev/null',
    totalTests: 8,
    passedTests: 8,
    failedTests: 0,
    passRate: 1,
    results: [],
    ...overrides
  };
}

describe('baseline', () => {
  it('returns null when no baseline file exists', () => {
    expect(loadBaseline('caia-po', tmpDir)).toBeNull();
  });

  it('writes a baseline JSON with the expected fields', () => {
    const baseline = writeBaseline(makeResult({ passRate: 0.875 }), tmpDir);
    expect(baseline.agent).toBe('caia-po');
    expect(baseline.passRate).toBe(0.875);
    expect(baseline.totalTests).toBe(8);
    expect(baseline.regressionTolerance).toBe(0.05);
    expect(baseline.recordedAt).toMatch(/^\d{4}-\d{2}-\d{2}T/);
    expect(existsSync(baselinePath('caia-po', tmpDir))).toBe(true);
  });

  it('round-trips through loadBaseline', () => {
    writeBaseline(makeResult({ passRate: 0.875 }), tmpDir);
    const loaded = loadBaseline('caia-po', tmpDir);
    expect(loaded?.passRate).toBe(0.875);
    expect(loaded?.agent).toBe('caia-po');
  });

  it('writes a stable JSON file (deterministic shape)', () => {
    writeBaseline(makeResult({ passRate: 0.5 }), tmpDir);
    const raw = readFileSync(baselinePath('caia-po', tmpDir), 'utf-8');
    const parsed = JSON.parse(raw);
    expect(Object.keys(parsed).sort()).toEqual([
      'agent',
      'passRate',
      'recordedAt',
      'regressionTolerance',
      'totalTests'
    ]);
  });

  it('diffAgainstBaseline returns no-baseline when none exists', () => {
    const diff = diffAgainstBaseline(makeResult(), tmpDir);
    expect(diff.status).toBe('no-baseline');
    expect(diff.delta).toBe(0);
    expect(diff.baseline).toBeNull();
  });

  it('diffAgainstBaseline returns within-tolerance for unchanged pass-rate', () => {
    writeBaseline(makeResult({ passRate: 0.8 }), tmpDir);
    const diff = diffAgainstBaseline(makeResult({ passRate: 0.8 }), tmpDir);
    expect(diff.status).toBe('within-tolerance');
    expect(Math.abs(diff.delta)).toBeLessThan(1e-10);
  });

  it('diffAgainstBaseline returns improved when current >> baseline', () => {
    writeBaseline(makeResult({ passRate: 0.5 }), tmpDir);
    const diff = diffAgainstBaseline(makeResult({ passRate: 0.9 }), tmpDir);
    expect(diff.status).toBe('improved');
    expect(diff.delta).toBeCloseTo(0.4, 5);
  });

  it('diffAgainstBaseline returns regression when current << baseline beyond tolerance', () => {
    writeBaseline(makeResult({ passRate: 0.9 }), tmpDir);
    const diff = diffAgainstBaseline(makeResult({ passRate: 0.7 }), tmpDir);
    expect(diff.status).toBe('regression');
    expect(diff.delta).toBeCloseTo(-0.2, 5);
  });

  it('diffAgainstBaseline accepts a 5pp drift as within-tolerance (default)', () => {
    writeBaseline(makeResult({ passRate: 1 }), tmpDir);
    const diff = diffAgainstBaseline(makeResult({ passRate: 0.96 }), tmpDir);
    expect(diff.status).toBe('within-tolerance');
  });
});
