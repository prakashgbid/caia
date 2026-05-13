import { describe, it, expect } from 'vitest';
import { isNonSubstantive } from '../src/pr-merge/index.js';

describe('pr-merge: isNonSubstantive classifier', () => {
  it('classifies common dev-quality failures as non-substantive', () => {
    const cases = [
      { name: 'lint', context: null, state: 'FAILURE' },
      { name: 'eslint', context: null, state: 'FAILURE' },
      { name: 'prettier', context: null, state: 'FAILURE' },
      { name: 'format', context: null, state: 'FAILURE' },
      { name: 'semgrep', context: null, state: 'FAILURE' },
      { name: 'axe', context: null, state: 'FAILURE' },
      { name: 'visual', context: null, state: 'FAILURE' },
      { name: 'lighthouse', context: null, state: 'FAILURE' },
      { name: 'bundle-size', context: null, state: 'FAILURE' },
      { name: 'gitleaks', context: null, state: 'FAILURE' },
      { name: 'docs-only', context: null, state: 'FAILURE' },
      { name: 'Code Reviewer (blocking)', context: null, state: 'FAILURE' },
      { name: null, context: 'CodeRabbit', state: 'FAILURE' },
    ];
    for (const c of cases) {
      expect(isNonSubstantive(c), `${c.name ?? c.context}`).toBe(true);
    }
  });

  it('classifies real test/build failures as substantive', () => {
    const cases = [
      { name: 'Build · Test · Lint · Typecheck', context: null, state: 'FAILURE' },
      { name: 'Pipeline E2E (tests/e2e/pipeline)', context: null, state: 'FAILURE' },
      { name: 'Per-agent regression (tests/e2e/agents)', context: null, state: 'FAILURE' },
      { name: 'typecheck', context: null, state: 'FAILURE' },
      { name: 'gitflow-conformance', context: null, state: 'FAILURE' },
      { name: 'Secret detection gate', context: null, state: 'FAILURE' },
      { name: 'steward-gatekeeper-migration-numbering', context: null, state: 'FAILURE' },
    ];
    for (const c of cases) {
      expect(isNonSubstantive(c), `${c.name}`).toBe(false);
    }
  });

  it('substring-matches case-insensitively', () => {
    expect(isNonSubstantive({ name: 'ESLint', context: null, state: 'FAILURE' })).toBe(true);
    expect(isNonSubstantive({ name: 'Semgrep (security tier-warn)', context: null, state: 'FAILURE' })).toBe(true);
    // "Build · Test · Lint · Typecheck" contains "lint" but our substantive
    // override wins (the failure could be a real test/build failure), so this
    // returns false. Operators must explicitly admin-bypass that one manually.
    expect(isNonSubstantive({ name: 'Build · Test · Lint · Typecheck', context: null, state: 'FAILURE' })).toBe(false);
  });

  it('treats empty names as substantive (cannot classify)', () => {
    expect(isNonSubstantive({ name: '', context: null, state: 'FAILURE' })).toBe(false);
    expect(isNonSubstantive({ name: null, context: null, state: 'FAILURE' })).toBe(false);
  });
});
