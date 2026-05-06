import { describe, expect, it } from 'vitest';

import { applyDefaults, loadSuites, parseSuiteYaml } from '../src/suite-loader.js';
import { InMemoryFs } from './helpers/fakes.js';

describe('parseSuiteYaml', () => {
  it('parses a minimal suite with a single test', () => {
    const yaml = `description: 'a suite'
tests:
  - description: 'one'
    vars:
      prompt: 'hello'
    assert:
      - type: contains
        value: foo
`;
    const suite = parseSuiteYaml(yaml, '/x.yaml', 'x');
    expect(suite.id).toBe('x');
    expect(suite.tests).toHaveLength(1);
    expect(suite.tests[0]!.assert).toHaveLength(1);
    expect(suite.tests[0]!.id).toBe('one');
  });

  it('honours explicit test ids', () => {
    const yaml = `description: 'a'
tests:
  - id: my-id
    description: 'd'
    vars: { prompt: p }
    assert: []
`;
    const suite = parseSuiteYaml(yaml, '/x.yaml', 'x');
    expect(suite.tests[0]!.id).toBe('my-id');
  });

  it('parses every supported assertion type', () => {
    const yaml = `description: 'all asserts'
tests:
  - description: 'd'
    vars: { prompt: p }
    assert:
      - type: contains
        value: a
      - type: not-contains
        value: b
      - type: regex
        value: 'c+'
      - type: equals
        value: x
      - type: javascript
        value: 'output.length > 0'
      - type: semantic-similarity
        value: x
        threshold: 0.5
`;
    const suite = parseSuiteYaml(yaml, '/x.yaml', 'x');
    expect(suite.tests[0]!.assert.map((a) => a.type)).toEqual([
      'contains',
      'not-contains',
      'regex',
      'equals',
      'javascript',
      'semantic-similarity'
    ]);
  });

  it('rejects malformed top-level', () => {
    expect(() => parseSuiteYaml('foo: bar', '/x.yaml', 'x')).toThrow(/description required/);
    expect(() => parseSuiteYaml('description: ok\ntests: []', '/x.yaml', 'x')).toThrow(
      /tests must be a non-empty array/
    );
  });

  it('rejects malformed test cases', () => {
    const noPrompt = `description: 'a'
tests:
  - description: 'one'
    vars: {}
    assert: []
`;
    expect(() => parseSuiteYaml(noPrompt, '/x.yaml', 'x')).toThrow(/vars.prompt required/);

    const badAssert = `description: 'a'
tests:
  - description: 'one'
    vars: { prompt: p }
    assert:
      - type: bogus
        value: x
`;
    expect(() => parseSuiteYaml(badAssert, '/x.yaml', 'x')).toThrow(/invalid assertion type/);
  });

  it('rejects duplicate test ids', () => {
    const yaml = `description: 'a'
tests:
  - id: dup
    description: 'one'
    vars: { prompt: p }
    assert: []
  - id: dup
    description: 'two'
    vars: { prompt: q }
    assert: []
`;
    expect(() => parseSuiteYaml(yaml, '/x.yaml', 'x')).toThrow(/duplicate test id dup/);
  });
});

describe('applyDefaults', () => {
  it('merges defaultTest vars + assertions into each test', () => {
    const yaml = `description: 'a'
defaultTest:
  vars: { agent: x }
  assert:
    - type: contains
      value: ALWAYS
tests:
  - description: 'one'
    vars: { prompt: p }
    assert:
      - type: contains
        value: per-test
`;
    const suite = parseSuiteYaml(yaml, '/x.yaml', 'x');
    const merged = applyDefaults(suite);
    expect(merged.tests[0]!.vars['agent']).toBe('x');
    expect(merged.tests[0]!.assert.map((a) => (a as { value: string }).value)).toEqual([
      'ALWAYS',
      'per-test'
    ]);
  });

  it('returns the original suite when no defaultTest present', () => {
    const yaml = `description: 'a'
tests:
  - description: 'd'
    vars: { prompt: p }
    assert: []
`;
    const suite = parseSuiteYaml(yaml, '/x.yaml', 'x');
    expect(applyDefaults(suite)).toBe(suite);
  });
});

describe('loadSuites', () => {
  it('loads every YAML under suiteRoot, filtered by `only`', async () => {
    const fs = new InMemoryFs();
    const yaml = `description: 's'
tests:
  - description: 't'
    vars: { prompt: p }
    assert: []
`;
    fs.dirs.add('/suites');
    await fs.writeFile('/suites/a.yaml', yaml);
    await fs.writeFile('/suites/b.yaml', yaml);
    await fs.writeFile('/suites/_skip.yaml', yaml);
    const all = await loadSuites({ suiteRoot: '/suites', fs });
    expect(all.map((s) => s.id).sort()).toEqual(['a', 'b']);
    const filtered = await loadSuites({ suiteRoot: '/suites', fs, only: ['a'] });
    expect(filtered.map((s) => s.id)).toEqual(['a']);
  });

  it('throws when suiteRoot does not exist', async () => {
    const fs = new InMemoryFs();
    await expect(loadSuites({ suiteRoot: '/nope', fs })).rejects.toThrow(/suiteRoot not found/);
  });
});
