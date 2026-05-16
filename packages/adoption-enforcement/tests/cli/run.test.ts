import { describe, expect, it } from 'vitest';

import { dispatch } from '../../src/cli/run.js';

describe('dispatch — top-level subcommand router', () => {
  it('shows top-level help on --help (exit 0)', () => {
    const result = dispatch(['--help']);
    expect(result.exitCode).toBe(0);
    expect(result.stdout).toContain('caia-adoption-run');
    expect(result.stdout).toContain('xref');
  });

  it('prints top-level help to stderr (exit 2) when no subcommand is given', () => {
    const result = dispatch([]);
    expect(result.exitCode).toBe(2);
    expect(result.stderr).toContain('caia-adoption-run');
  });

  it('returns exit 2 for an unknown subcommand', () => {
    const result = dispatch(['hypothetical-future-thing']);
    expect(result.exitCode).toBe(2);
    expect(result.stderr).toContain('unknown subcommand');
  });

  it('delegates to xref subcommand', () => {
    const result = dispatch(['xref', '--help']);
    expect(result.exitCode).toBe(0);
    expect(result.stdout).toContain('caia-adoption-run xref');
  });
});
