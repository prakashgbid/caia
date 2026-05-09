import { describe, it, expect, beforeEach, afterEach } from 'vitest';

import { resolveConfig, expandHome } from '../src/config.js';

describe('config', () => {
  const savedEnv: Record<string, string | undefined> = {};
  const ENV_KEYS = [
    'CAIA_MEMORY_ROOT',
    'SURFACE_GH_REPO',
    'SURFACE_MEMORY_GIT_REPO',
    'SURFACE_TRANSCRIPT_ROOT',
    'CAIA_REPORTS_ROOT',
    'SURFACE_MAX_BYTES',
    'SURFACE_MIN_IMPORTANCE',
    'SURFACE_MAX_FINDINGS'
  ] as const;

  beforeEach(() => {
    for (const k of ENV_KEYS) {
      savedEnv[k] = process.env[k];
      delete process.env[k];
    }
  });
  afterEach(() => {
    for (const k of ENV_KEYS) {
      if (savedEnv[k] === undefined) delete process.env[k];
      else process.env[k] = savedEnv[k];
    }
  });

  it('expands ~/ to home', () => {
    const home = process.env['HOME'] ?? '';
    expect(expandHome('~/foo')).toBe(`${home}/foo`);
  });

  it('returns absolute paths untouched', () => {
    expect(expandHome('/abs/x')).toBe('/abs/x');
  });

  it('uses CAIA defaults when no input or env', () => {
    const c = resolveConfig({});
    expect(c.ghRepo).toBe('prakashgbid/caia');
    expect(c.maxBytes).toBe(50_000);
    expect(c.minImportance).toBeCloseTo(0.35, 5);
    expect(c.maxFindings).toBe(100);
    expect(c.corpusRoot).toContain('agent-memory');
  });

  it('honours constructor input over env', () => {
    process.env['SURFACE_GH_REPO'] = 'env/repo';
    const c = resolveConfig({ ghRepo: 'arg/repo' });
    expect(c.ghRepo).toBe('arg/repo');
  });

  it('honours env over default', () => {
    process.env['SURFACE_GH_REPO'] = 'env/repo';
    const c = resolveConfig({});
    expect(c.ghRepo).toBe('env/repo');
  });

  it('parses numeric env vars', () => {
    process.env['SURFACE_MAX_BYTES'] = '12345';
    process.env['SURFACE_MIN_IMPORTANCE'] = '0.7';
    process.env['SURFACE_MAX_FINDINGS'] = '42';
    const c = resolveConfig({});
    expect(c.maxBytes).toBe(12345);
    expect(c.minImportance).toBeCloseTo(0.7, 5);
    expect(c.maxFindings).toBe(42);
  });

  it('falls back to defaults on unparseable numeric env', () => {
    process.env['SURFACE_MAX_BYTES'] = 'not-a-number';
    const c = resolveConfig({});
    expect(c.maxBytes).toBe(50_000);
  });

  it('expands ~/ in path inputs', () => {
    const c = resolveConfig({ corpusRoot: '~/foo/bar' });
    expect(c.corpusRoot.startsWith('/')).toBe(true);
    expect(c.corpusRoot.endsWith('/foo/bar')).toBe(true);
  });

  it('preserves all CAIA-default literals as constructor parameters (Option E shape)', () => {
    // Re-assert: every CAIA-specific path is overridable via input.
    const c = resolveConfig({
      corpusRoot: '/x/agent-memory',
      ghRepo: 'x/y',
      memoryGitRepo: '/x/agent-memory',
      transcriptRoot: '/x/transcripts',
      reportsRoot: '/x/reports',
      maxBytes: 1,
      minImportance: 0.99,
      maxFindings: 1
    });
    expect(c).toEqual({
      corpusRoot: '/x/agent-memory',
      ghRepo: 'x/y',
      memoryGitRepo: '/x/agent-memory',
      transcriptRoot: '/x/transcripts',
      reportsRoot: '/x/reports',
      maxBytes: 1,
      minImportance: 0.99,
      maxFindings: 1
    });
  });

  it('treats `~` (no trailing slash) as home', () => {
    const home = process.env['HOME'] ?? '';
    expect(expandHome('~')).toBe(home);
  });
});
