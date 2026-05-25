import { describe, expect, it } from 'vitest';
import {
  buildReport,
  buildResult,
  exitCodeFor,
  toJson,
  toLine,
  toMarkdown
} from '../src/report.js';
import type { Policy, PolicyResult } from '../src/types.js';

const polA: Pick<Policy, 'id' | 'description' | 'defaultMode'> = {
  id: 'a',
  description: 'policy a',
  defaultMode: 'hard-fail'
};

describe('report builders', () => {
  it('buildResult marks pass when verdict.ok=true', () => {
    const r = buildResult(polA, { ok: true }, 1);
    expect(r.effectiveMode).toBe('pass');
  });
  it('buildResult preserves mode when verdict.ok=false', () => {
    const r = buildResult(polA, { ok: false, mode: 'soft-fail', reason: 'r' }, 2);
    expect(r.effectiveMode).toBe('soft-fail');
  });
  it('buildReport resolves worstOutcome to hard-fail when any result is hard-fail', () => {
    const results: PolicyResult[] = [
      buildResult(polA, { ok: true }, 0),
      buildResult(polA, { ok: false, mode: 'hard-fail', reason: 'x' }, 0)
    ];
    const r = buildReport('agent', results);
    expect(r.worstOutcome).toBe('hard-fail');
  });
  it('worstOutcome resolves to advisory when only advisories present', () => {
    const results: PolicyResult[] = [
      buildResult(polA, { ok: false, mode: 'advisory', reason: 'x' }, 0)
    ];
    expect(buildReport('agent', results).worstOutcome).toBe('advisory');
  });
  it('violationCount counts non-pass results', () => {
    const results: PolicyResult[] = [
      buildResult(polA, { ok: true }, 0),
      buildResult(polA, { ok: false, mode: 'advisory', reason: 'x' }, 0),
      buildResult(polA, { ok: false, mode: 'hard-fail', reason: 'y' }, 0)
    ];
    expect(buildReport('agent', results).violationCount).toBe(2);
  });
});

describe('exitCodeFor', () => {
  it('pass -> 0', () => {
    expect(exitCodeFor(buildReport('x', []))).toBe(0);
  });
  it('advisory -> 0', () => {
    const r = buildReport('x', [
      buildResult(polA, { ok: false, mode: 'advisory', reason: 'r' }, 0)
    ]);
    expect(exitCodeFor(r)).toBe(0);
  });
  it('soft-fail -> 1', () => {
    const r = buildReport('x', [
      buildResult(polA, { ok: false, mode: 'soft-fail', reason: 'r' }, 0)
    ]);
    expect(exitCodeFor(r)).toBe(1);
  });
  it('hard-fail -> 2', () => {
    const r = buildReport('x', [
      buildResult(polA, { ok: false, mode: 'hard-fail', reason: 'r' }, 0)
    ]);
    expect(exitCodeFor(r)).toBe(2);
  });
});

describe('renderers', () => {
  const sample = () =>
    buildReport('agent-x', [
      buildResult(polA, { ok: false, mode: 'hard-fail', reason: 'broken', suggestedFix: 'unbreak it' }, 5)
    ]);

  it('toJson produces parseable JSON with the report shape', () => {
    const j = JSON.parse(toJson(sample()));
    expect(j.worstOutcome).toBe('hard-fail');
    expect(j.results).toHaveLength(1);
  });

  it('toLine summarises in a single line', () => {
    const line = toLine(sample());
    expect(line).toMatch(/^\[policy-linter\]/);
    expect(line.split('\n')).toHaveLength(1);
  });

  it('toMarkdown includes the remediation section for violations', () => {
    const md = toMarkdown(sample());
    expect(md).toMatch(/## Remediation/);
    expect(md).toMatch(/unbreak it/);
  });

  it('toMarkdown escapes pipe characters in reasons', () => {
    const r = buildReport('agent-x', [
      buildResult(polA, { ok: false, mode: 'hard-fail', reason: 'a|b|c' }, 0)
    ]);
    const md = toMarkdown(r);
    expect(md).toMatch(/a\\\|b\\\|c/);
  });
});
