import { describe, expect, it } from 'vitest';
import { formatAnnotation, renderGithubActionsStep } from '../src/ci-action.js';
import { buildReport, buildResult } from '../src/report.js';
import type { Policy } from '../src/types.js';

const polA: Pick<Policy, 'id' | 'description' | 'defaultMode'> = {
  id: 'a',
  description: 'a',
  defaultMode: 'hard-fail'
};

describe('renderGithubActionsStep', () => {
  it('produces a YAML block with required keys', () => {
    const yaml = renderGithubActionsStep();
    expect(yaml).toMatch(/^- name: /m);
    expect(yaml).toMatch(/working-directory: /);
    expect(yaml).toMatch(/run: \|/);
    expect(yaml).toMatch(/caia-policy-lint/);
  });

  it('uses opts.briefPath when provided', () => {
    const yaml = renderGithubActionsStep({ briefPath: '.github/foo.md' });
    expect(yaml).toMatch(/\.github\/foo\.md/);
  });

  it('includes a build step when buildBeforeRun=true', () => {
    const yaml = renderGithubActionsStep({ buildBeforeRun: true });
    expect(yaml).toMatch(/pnpm --filter @caia\/policy-linter build/);
  });

  it('expands multiple target-repos into repeated CLI flags', () => {
    const yaml = renderGithubActionsStep({ targetRepos: ['a', 'b'] });
    expect(yaml.match(/--target-repo /g)?.length).toBe(2);
  });
});

describe('formatAnnotation', () => {
  it('emits an ::error annotation for hard-fails', () => {
    const r = buildReport('agent', [
      buildResult(polA, { ok: false, mode: 'hard-fail', reason: 'bad' }, 0)
    ]);
    expect(formatAnnotation(r)).toMatch(/^::error title=a::bad/);
  });
  it('emits an ::warning annotation for soft-fails', () => {
    const r = buildReport('agent', [
      buildResult(polA, { ok: false, mode: 'soft-fail', reason: 'meh' }, 0)
    ]);
    expect(formatAnnotation(r)).toMatch(/^::warning title=a::meh/);
  });
  it('emits nothing for clean reports', () => {
    const r = buildReport('agent', [buildResult(polA, { ok: true }, 0)]);
    expect(formatAnnotation(r)).toBe('');
  });
});
