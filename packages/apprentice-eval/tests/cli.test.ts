import { describe, expect, it } from 'vitest';

import { __TEST_ONLY } from '../src/cli.js';

describe('cli — parseArgs', () => {
  it('returns help on no args', () => {
    const a = __TEST_ONLY.parseArgs([]);
    expect(a.command).toBe('help');
  });
  it('parses run with --only', () => {
    const a = __TEST_ONLY.parseArgs(['run', '--only', 'a,b']);
    expect(a.command).toBe('run');
    expect(a.only).toEqual(['a', 'b']);
  });
  it('parses --adapter, --dry-run, --pairs', () => {
    const a = __TEST_ONLY.parseArgs(['run', '--adapter', 'foo', '--dry-run', '--pairs', '5']);
    expect(a.adapter).toBe('foo');
    expect(a.dryRun).toBe(true);
    expect(a.pairs).toBe(5);
  });
  it('parses baseline --update', () => {
    const a = __TEST_ONLY.parseArgs(['baseline', '--update']);
    expect(a.command).toBe('baseline');
    expect(a.update).toBe(true);
  });
  it('parses ab --pairs', () => {
    const a = __TEST_ONLY.parseArgs(['ab', '--only', 'directive', '--pairs', '20']);
    expect(a.command).toBe('ab');
    expect(a.only).toEqual(['directive']);
  });
  it('falls back to help on unknown command', () => {
    expect(__TEST_ONLY.parseArgs(['nope']).command).toBe('help');
  });
  it('treats --help as help', () => {
    expect(__TEST_ONLY.parseArgs(['--help']).command).toBe('help');
    expect(__TEST_ONLY.parseArgs(['-h']).command).toBe('help');
  });
  it('parses --output-root', () => {
    const a = __TEST_ONLY.parseArgs(['run', '--output-root', '/tmp/out']);
    expect(a.outputRoot).toBe('/tmp/out');
  });
});

describe('cli — HELP_TEXT', () => {
  it('mentions every subcommand', () => {
    expect(__TEST_ONLY.HELP_TEXT).toContain('run');
    expect(__TEST_ONLY.HELP_TEXT).toContain('baseline');
    expect(__TEST_ONLY.HELP_TEXT).toContain('ab');
  });
});
