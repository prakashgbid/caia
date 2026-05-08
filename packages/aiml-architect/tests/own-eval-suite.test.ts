import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { ownEvalSuite } from '../src/own-eval-suite.js';
import { resolveConfig } from '../src/config.js';
import { buildFakeFs, fixedClock } from './helpers/fakes.js';

const fixturePath = '/fixtures/mini-canonical-suite.yaml';

function fixtureBody(): string {
  return readFileSync(
    join(__dirname, '__fixtures__', 'mini-canonical-suite.yaml'),
    'utf-8'
  );
}

describe('ownEvalSuite', () => {
  const cfg = resolveConfig({ canonicalSuitePath: fixturePath });
  const clock = fixedClock('2026-05-06T12:00:00Z');

  it('returns issues when suite is missing', () => {
    const fs = buildFakeFs({});
    const suite = ownEvalSuite({ cfg, fs, clock });
    expect(suite.integrityIssues).toHaveLength(1);
    expect(suite.integrityIssues[0]!.kind).toBe('suite-not-found');
    expect(suite.promptCount).toBe(0);
  });

  it('detects duplicate prompts', () => {
    const dup =
      'description: dup test\n' +
      'version: 1\n' +
      'tests:\n' +
      "  - description: 'a: case 1'\n" +
      "    vars: { taskCategory: a, prompt: 'same prompt' }\n" +
      "  - description: 'a: case 2'\n" +
      "    vars: { taskCategory: a, prompt: 'same prompt' }\n";
    const fs = buildFakeFs({
      files: { [fixturePath]: { content: dup, mtimeMs: clock().getTime() } }
    });
    const suite = ownEvalSuite({
      cfg,
      fs,
      clock,
      routingTaskCategories: ['a']
    });
    const dupIssue = suite.integrityIssues.find(
      (i) => i.kind === 'duplicate-prompt'
    );
    expect(dupIssue).toBeDefined();
  });

  it('flags missing task coverage', () => {
    const fs = buildFakeFs({
      files: {
        [fixturePath]: {
          content: fixtureBody(),
          mtimeMs: clock().getTime()
        }
      }
    });
    const suite = ownEvalSuite({
      cfg,
      fs,
      clock,
      routingTaskCategories: ['domain-classification', 'commit-message', 'never-covered']
    });
    const missing = suite.integrityIssues.find(
      (i) => i.kind === 'missing-task-coverage'
    );
    expect(missing).toBeDefined();
    expect(missing!.detail).toMatch(/never-covered|commit-message/);
  });

  it('flags an unanchored regex assertion', () => {
    const bad =
      'description: bad regex\n' +
      'version: 1\n' +
      'tests:\n' +
      "  - description: 'task: x'\n" +
      "    vars: { taskCategory: task }\n" +
      '    assert:\n' +
      '      - type: regex\n' +
      '        value: "[unbalanced"\n';
    const fs = buildFakeFs({
      files: { [fixturePath]: { content: bad, mtimeMs: clock().getTime() } }
    });
    const suite = ownEvalSuite({
      cfg,
      fs,
      clock,
      routingTaskCategories: ['task']
    });
    const issue = suite.integrityIssues.find(
      (i) => i.kind === 'unanchored-assertion'
    );
    expect(issue).toBeDefined();
  });

  it('flags stale baseline', () => {
    const fs = buildFakeFs({
      files: {
        [fixturePath]: {
          content: fixtureBody(),
          mtimeMs: clock().getTime() - 200 * 24 * 60 * 60 * 1000
        }
      }
    });
    const suite = ownEvalSuite({
      cfg,
      fs,
      clock,
      routingTaskCategories: ['domain-classification']
    });
    const stale = suite.integrityIssues.find(
      (i) => i.kind === 'stale-baseline'
    );
    expect(stale).toBeDefined();
  });

  it('counts assertion-type usage', () => {
    const fs = buildFakeFs({
      files: {
        [fixturePath]: {
          content: fixtureBody(),
          mtimeMs: clock().getTime()
        }
      }
    });
    const suite = ownEvalSuite({
      cfg,
      fs,
      clock,
      routingTaskCategories: ['domain-classification', 'commit-message']
    });
    expect(suite.perAssertionTypeUsage['contains']).toBeGreaterThan(0);
  });
});
