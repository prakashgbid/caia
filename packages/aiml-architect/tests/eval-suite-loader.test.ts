import { describe, it, expect } from 'vitest';

import {
  loadCanonicalSuite,
  SuiteLoadError
} from '../src/eval-suite-loader.js';
import { buildFakeFs } from './helpers/fakes.js';

describe('loadCanonicalSuite', () => {
  it('parses a minimal valid YAML', () => {
    const yaml =
      'description: minimal\n' +
      'version: 1\n' +
      'tests:\n' +
      "  - description: 'a: simple'\n" +
      "    vars: { taskCategory: a, prompt: 'hi' }\n";
    const fs = buildFakeFs({
      files: { '/p/canonical.yaml': { content: yaml } }
    });
    const suite = loadCanonicalSuite('/p/canonical.yaml', fs);
    expect(suite.tests).toHaveLength(1);
    expect(suite.tests[0]!.description).toMatch(/simple/);
  });

  it('throws SuiteLoadError when file missing', () => {
    const fs = buildFakeFs({});
    expect(() => loadCanonicalSuite('/p/missing.yaml', fs)).toThrow(
      SuiteLoadError
    );
  });

  it('throws SuiteLoadError on malformed YAML', () => {
    const fs = buildFakeFs({
      files: { '/p/bad.yaml': { content: 'not: valid:\n   indent' } }
    });
    expect(() => loadCanonicalSuite('/p/bad.yaml', fs)).toThrow(SuiteLoadError);
  });

  it('preserves maintainer and defaultTest when present', () => {
    const yaml =
      'description: with-extras\n' +
      'version: 1\n' +
      'maintainer: aiml-architect\n' +
      'defaultTest:\n' +
      '  assert:\n' +
      '    - type: contains\n' +
      "      value: 'foo'\n" +
      'tests: []\n';
    const fs = buildFakeFs({
      files: { '/p/c.yaml': { content: yaml } }
    });
    const suite = loadCanonicalSuite('/p/c.yaml', fs);
    expect(suite.maintainer).toBe('aiml-architect');
    expect(suite.defaultTest?.assert).toBeDefined();
  });
});
