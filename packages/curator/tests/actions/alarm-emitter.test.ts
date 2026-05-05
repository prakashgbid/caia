/**
 * Tests for the Curator Phase-2 alarm emitter.
 *
 * Covers:
 *   - Markdown rendering (frontmatter + sections)
 *   - File writing to disk (idempotent, --force overwrite)
 *   - Default + explicit output dir resolution
 *   - Empty-input behaviour
 */

import { mkdtempSync, readFileSync, writeFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import {
  defaultAlarmsDir,
  renderAlarmMarkdown,
  writeAlarms
} from '../../src/actions/alarm-emitter.js';
import type { AlarmAction } from '../../src/actions/types.js';

function fixture(overrides: Partial<AlarmAction> = {}): AlarmAction {
  return {
    kind: 'alarm',
    slug: 'sample-alarm-slug',
    title: 'Sample alarm title',
    summary: 'Summary paragraph.',
    evidence: ['ev-1', 'ev-2'],
    recommendation: 'Investigate immediately.',
    detectedAt: '2026-05-05T22:50:00.000Z',
    sourceFindings: ['test-scanner'],
    severity: 'critical',
    dimension: 'CVE',
    ...overrides
  };
}

describe('renderAlarmMarkdown', () => {
  it('renders YAML frontmatter with all 6 keys', () => {
    const md = renderAlarmMarkdown(fixture());
    expect(md).toContain('type: curator-alarm');
    expect(md).toContain('severity: critical');
    expect(md).toContain('dimension: CVE');
    expect(md).toContain('slug: sample-alarm-slug');
    expect(md).toContain('detectedAt: 2026-05-05T22:50:00.000Z');
    expect(md).toContain('sourceFindings: ["test-scanner"]');
  });

  it('renders the title as an H1', () => {
    const md = renderAlarmMarkdown(fixture({ title: 'My title' }));
    expect(md).toContain('# My title');
  });

  it('renders the severity-and-dimension subtitle line', () => {
    const md = renderAlarmMarkdown(fixture({ severity: 'high', dimension: 'Spend' }));
    expect(md).toContain('**Severity:** HIGH');
    expect(md).toContain('**Dimension:** Spend');
  });

  it('renders Summary, Evidence, and Recommended action sections', () => {
    const md = renderAlarmMarkdown(fixture());
    expect(md).toContain('## Summary');
    expect(md).toContain('Summary paragraph.');
    expect(md).toContain('## Evidence');
    expect(md).toContain('- ev-1');
    expect(md).toContain('- ev-2');
    expect(md).toContain('## Recommended action');
    expect(md).toContain('Investigate immediately.');
  });

  it('omits the Evidence section when there is no evidence', () => {
    const md = renderAlarmMarkdown(fixture({ evidence: [] }));
    expect(md).not.toContain('## Evidence');
  });

  it('quote-escapes a dimension that contains special chars', () => {
    const md = renderAlarmMarkdown(fixture({ dimension: 'Spend trend: +30%' }));
    expect(md).toMatch(/dimension: '[^']*'/);
  });
});

describe('defaultAlarmsDir', () => {
  it('joins reportsDir + curator + alarms', () => {
    expect(defaultAlarmsDir('/tmp/reports')).toBe('/tmp/reports/curator/alarms');
  });
});

describe('writeAlarms', () => {
  let tmp: string;

  beforeEach(() => {
    tmp = mkdtempSync(join(tmpdir(), 'curator-alarm-emitter-'));
  });

  afterEach(() => {
    // Don't clean up — vitest handles tmpdir; tests use unique names anyway.
  });

  it('writes one .md per alarm to the explicit alarmsDir', () => {
    const a1 = fixture({ slug: 'one' });
    const a2 = fixture({ slug: 'two', title: 'Two' });
    const r = writeAlarms([a1, a2], { alarmsDir: tmp });
    expect(r.outputDir).toBe(tmp);
    expect(r.writtenCount).toBe(2);
    expect(r.skippedCount).toBe(0);
    expect(r.written.map((w) => w.slug).sort()).toEqual(['one', 'two']);
    expect(existsSync(join(tmp, 'one.md'))).toBe(true);
    expect(existsSync(join(tmp, 'two.md'))).toBe(true);
  });

  it('uses defaultAlarmsDir when only reportsDir is passed', () => {
    const a1 = fixture({ slug: 'one' });
    const r = writeAlarms([a1], { reportsDir: tmp });
    expect(r.outputDir).toBe(join(tmp, 'curator', 'alarms'));
    expect(existsSync(r.written[0]!.path)).toBe(true);
  });

  it('throws when neither alarmsDir nor reportsDir is provided', () => {
    expect(() => writeAlarms([fixture()], {})).toThrow(/alarmsDir.*reportsDir/);
  });

  it('is idempotent — second run skips existing files', () => {
    const a = fixture({ slug: 'idempotent-test' });
    const r1 = writeAlarms([a], { alarmsDir: tmp });
    expect(r1.writtenCount).toBe(1);
    const r2 = writeAlarms([a], { alarmsDir: tmp });
    expect(r2.writtenCount).toBe(0);
    expect(r2.skippedCount).toBe(1);
    expect(r2.skipped[0]!.path).toBe(r1.written[0]!.path);
  });

  it('preserves operator edits when force is not set', () => {
    const a = fixture({ slug: 'preserve' });
    writeAlarms([a], { alarmsDir: tmp });
    const path = join(tmp, 'preserve.md');
    writeFileSync(path, 'OPERATOR EDITED\n', 'utf-8');
    const r = writeAlarms([a], { alarmsDir: tmp });
    expect(r.writtenCount).toBe(0);
    expect(r.skippedCount).toBe(1);
    expect(readFileSync(path, 'utf-8')).toBe('OPERATOR EDITED\n');
  });

  it('overwrites existing files when force is true', () => {
    const a = fixture({ slug: 'force-test', title: 'Original' });
    writeAlarms([a], { alarmsDir: tmp });
    const path = join(tmp, 'force-test.md');
    writeFileSync(path, 'STALE\n', 'utf-8');
    const r = writeAlarms([a], { alarmsDir: tmp, force: true });
    expect(r.writtenCount).toBe(1);
    expect(r.skippedCount).toBe(0);
    expect(readFileSync(path, 'utf-8')).not.toBe('STALE\n');
    expect(readFileSync(path, 'utf-8')).toContain('# Original');
  });

  it('skips force-rewrite when content is identical (preserves mtime)', () => {
    const a = fixture({ slug: 'noop-force' });
    writeAlarms([a], { alarmsDir: tmp });
    const r = writeAlarms([a], { alarmsDir: tmp, force: true });
    expect(r.writtenCount).toBe(0);
    expect(r.skippedCount).toBe(1);
  });

  it('returns an empty result when called with no actions', () => {
    const r = writeAlarms([], { alarmsDir: tmp });
    expect(r.writtenCount).toBe(0);
    expect(r.skippedCount).toBe(0);
    expect(r.written).toEqual([]);
    expect(r.skipped).toEqual([]);
  });

  it('creates the alarmsDir if it does not exist', () => {
    const nested = join(tmp, 'a', 'b', 'c');
    const a = fixture({ slug: 'nested-test' });
    const r = writeAlarms([a], { alarmsDir: nested });
    expect(r.writtenCount).toBe(1);
    expect(existsSync(join(nested, 'nested-test.md'))).toBe(true);
  });
});
