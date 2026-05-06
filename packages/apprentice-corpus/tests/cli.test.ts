import { describe, expect, it } from 'vitest';

import { parseArgs } from '../src/cli.js';

describe('parseArgs', () => {
  it('extracts the command', () => {
    expect(parseArgs(['aggregate'])).toMatchObject({ command: 'aggregate' });
  });

  it('detects --dry-run', () => {
    expect(parseArgs(['aggregate', '--dry-run'])).toMatchObject({ dryRun: true });
  });

  it('parses --memory-root with value', () => {
    const r = parseArgs(['aggregate', '--memory-root', '/x']);
    expect(r.config.memoryRoot).toBe('/x');
  });

  it('parses --no-distill', () => {
    expect(parseArgs(['aggregate', '--no-distill']).config.distillEnabled).toBe(false);
  });

  it('parses numeric flags', () => {
    const r = parseArgs([
      'aggregate',
      '--max-samples',
      '7',
      '--max-age-days',
      '30',
      '--quality-threshold',
      '0.6'
    ]);
    expect(r.config.maxSamples).toBe(7);
    expect(r.config.maxAgeDays).toBe(30);
    expect(r.config.qualityThreshold).toBe(0.6);
  });

  it('returns help command on --help', () => {
    expect(parseArgs(['--help']).command).toBe('help');
    expect(parseArgs(['-h']).command).toBe('help');
  });

  it('ignores unknown flags without crashing', () => {
    expect(() => parseArgs(['aggregate', '--something-unknown'])).not.toThrow();
  });
});
