import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { evalsDir } from '../src/paths.js';

describe('evals/*.yaml integrity', () => {
  const dir = evalsDir();
  const yamls = readdirSync(dir)
    .filter((f) => f.endsWith('.yaml') && !f.startsWith('_'))
    .sort();

  it('ships at least 10 agent eval suites', () => {
    expect(yamls.length).toBeGreaterThanOrEqual(10);
  });

  it('every YAML references the local provider', () => {
    for (const f of yamls) {
      const text = readFileSync(join(dir, f), 'utf-8');
      expect(text, `${f} missing local-provider reference`).toContain(
        '_lib/local-provider.mjs'
      );
    }
  });

  it('every YAML has a `description:` line', () => {
    for (const f of yamls) {
      const text = readFileSync(join(dir, f), 'utf-8');
      expect(text, `${f} missing description`).toMatch(/^description:/m);
    }
  });

  it('every YAML pins agent via defaultTest.vars.agent', () => {
    for (const f of yamls) {
      const text = readFileSync(join(dir, f), 'utf-8');
      const expected = `agent: ${f.replace(/\.yaml$/, '')}`;
      expect(text, `${f} missing ${expected}`).toContain(expected);
    }
  });

  it('total test-case count across all suites is >= 50', () => {
    let total = 0;
    for (const f of yamls) {
      const text = readFileSync(join(dir, f), 'utf-8');
      // Each test starts with "  - description:" indented 2 spaces.
      const matches = text.match(/^\s{2}- description:/gm);
      total += matches?.length ?? 0;
    }
    expect(total).toBeGreaterThanOrEqual(50);
  });

  it('every YAML has at least one `assert:` block', () => {
    for (const f of yamls) {
      const text = readFileSync(join(dir, f), 'utf-8');
      expect(text, `${f} missing assert block`).toContain('assert:');
    }
  });

  it('expected agent set is present', () => {
    const present = yamls.map((f) => f.replace(/\.yaml$/, ''));
    const expected = [
      'caia-ba',
      'caia-coding',
      'caia-curator',
      'caia-ea',
      'caia-fix-it',
      'caia-mentor',
      'caia-po',
      'caia-steward',
      'caia-test-design',
      'caia-validator'
    ];
    for (const e of expected) {
      expect(present, `missing ${e}`).toContain(e);
    }
  });
});
