/**
 * Tests for the Curator Phase-2 backlog-directive emitter.
 */

import { existsSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { beforeEach, describe, expect, it } from 'vitest';

import {
  defaultBacklogDirectivesDir,
  renderBacklogDirectiveMarkdown,
  writeBacklogDirectives
} from '../../src/actions/backlog-directive-emitter.js';
import type { BacklogDirectiveAction } from '../../src/actions/types.js';

function fixture(overrides: Partial<BacklogDirectiveAction> = {}): BacklogDirectiveAction {
  return {
    kind: 'backlog-directive',
    slug: 'sample-directive-slug',
    title: 'Adopt new framework X',
    summary: 'Mandate paragraph.\n\nMore detail on the second line.',
    evidence: ['ev-a', 'ev-b'],
    recommendation: 'Pilot framework X behind a feature flag.',
    detectedAt: '2026-05-05T22:50:00.000Z',
    sourceFindings: ['framework-survey'],
    dimension: 'Intelligence & Autonomy',
    effortEstimate: 'large',
    ...overrides
  };
}

describe('renderBacklogDirectiveMarkdown', () => {
  it('renders memory-directive-shaped frontmatter', () => {
    const md = renderBacklogDirectiveMarkdown(fixture());
    // Mirrors existing memory directive frontmatter structure (name + description + type).
    expect(md).toContain('name: Adopt new framework X');
    expect(md).toContain('description: Mandate paragraph.');
    expect(md).toContain('type: curator-backlog-directive');
    expect(md).toContain('dimension: ');
    expect(md).toContain('effortEstimate: large');
    expect(md).toContain('slug: sample-directive-slug');
    expect(md).toContain('detectedAt: 2026-05-05T22:50:00.000Z');
    expect(md).toContain('sourceFindings: ["framework-survey"]');
  });

  it('uses first line of summary for description', () => {
    const md = renderBacklogDirectiveMarkdown(fixture());
    // Description value should NOT include the second line.
    expect(md).toContain('description: Mandate paragraph.');
    expect(md).not.toContain('description: Mandate paragraph.\n\nMore detail');
  });

  it('falls back to title for description when summary is empty', () => {
    const md = renderBacklogDirectiveMarkdown(fixture({ summary: '' }));
    expect(md).toContain('description: Adopt new framework X');
  });

  it('quote-escapes dimension with special chars', () => {
    const md = renderBacklogDirectiveMarkdown(
      fixture({ dimension: 'Spend: weekly trend' })
    );
    expect(md).toMatch(/dimension: '[^']*'/);
  });

  it('renders BACKLOG status header', () => {
    const md = renderBacklogDirectiveMarkdown(fixture());
    expect(md).toContain('**Status**: BACKLOG');
    expect(md).toContain('Curator (Phase-2 PR-2)');
  });

  it('renders Mandate, Evidence, Recommended action, Promotion checklist sections', () => {
    const md = renderBacklogDirectiveMarkdown(fixture());
    expect(md).toContain('## Mandate');
    expect(md).toContain('Mandate paragraph.');
    expect(md).toContain('## Evidence');
    expect(md).toContain('- ev-a');
    expect(md).toContain('## Recommended action');
    expect(md).toContain('Pilot framework X');
    expect(md).toContain('## Promotion checklist');
  });

  it('promotion checklist mentions effort + mandate-compliance + mv to agent/memory', () => {
    const md = renderBacklogDirectiveMarkdown(fixture());
    expect(md).toContain('current: `large`');
    expect(md).toContain('subscription-only');
    expect(md).toContain('agent/memory/<slug>.md');
  });

  it('omits Evidence section when empty', () => {
    const md = renderBacklogDirectiveMarkdown(fixture({ evidence: [] }));
    expect(md).not.toContain('## Evidence');
  });
});

describe('defaultBacklogDirectivesDir', () => {
  it('joins reportsDir + curator + backlog-directives', () => {
    expect(defaultBacklogDirectivesDir('/tmp/reports')).toBe(
      '/tmp/reports/curator/backlog-directives'
    );
  });
});

describe('writeBacklogDirectives', () => {
  let tmp: string;
  beforeEach(() => {
    tmp = mkdtempSync(join(tmpdir(), 'curator-bd-emitter-'));
  });

  it('writes one .md per action to the explicit outDir', () => {
    const a = fixture({ slug: 'one' });
    const b = fixture({ slug: 'two', title: 'Two' });
    const r = writeBacklogDirectives([a, b], { outDir: tmp });
    expect(r.outputDir).toBe(tmp);
    expect(r.writtenCount).toBe(2);
    expect(r.skippedCount).toBe(0);
    expect(existsSync(join(tmp, 'one.md'))).toBe(true);
    expect(existsSync(join(tmp, 'two.md'))).toBe(true);
  });

  it('uses defaultBacklogDirectivesDir when only reportsDir is passed', () => {
    const r = writeBacklogDirectives([fixture({ slug: 'rd' })], { reportsDir: tmp });
    expect(r.outputDir).toBe(join(tmp, 'curator', 'backlog-directives'));
  });

  it('throws when neither outDir nor reportsDir is provided', () => {
    expect(() => writeBacklogDirectives([fixture()], {})).toThrow(/outDir.*reportsDir/);
  });

  it('is idempotent — second run skips existing files', () => {
    const a = fixture({ slug: 'idem' });
    const r1 = writeBacklogDirectives([a], { outDir: tmp });
    expect(r1.writtenCount).toBe(1);
    const r2 = writeBacklogDirectives([a], { outDir: tmp });
    expect(r2.writtenCount).toBe(0);
    expect(r2.skippedCount).toBe(1);
  });

  it('preserves operator edits without force', () => {
    const a = fixture({ slug: 'edit' });
    writeBacklogDirectives([a], { outDir: tmp });
    const path = join(tmp, 'edit.md');
    writeFileSync(path, 'EDIT\n');
    writeBacklogDirectives([a], { outDir: tmp });
    expect(readFileSync(path, 'utf-8')).toBe('EDIT\n');
  });

  it('overwrites with force: true', () => {
    const a = fixture({ slug: 'f' });
    writeBacklogDirectives([a], { outDir: tmp });
    writeFileSync(join(tmp, 'f.md'), 'STALE\n');
    const r = writeBacklogDirectives([a], { outDir: tmp, force: true });
    expect(r.writtenCount).toBe(1);
    expect(readFileSync(join(tmp, 'f.md'), 'utf-8')).not.toBe('STALE\n');
  });

  it('skips force-rewrite when content unchanged', () => {
    const a = fixture({ slug: 'noop' });
    writeBacklogDirectives([a], { outDir: tmp });
    const r = writeBacklogDirectives([a], { outDir: tmp, force: true });
    expect(r.writtenCount).toBe(0);
    expect(r.skippedCount).toBe(1);
  });

  it('returns empty result when called with no actions', () => {
    const r = writeBacklogDirectives([], { outDir: tmp });
    expect(r.writtenCount).toBe(0);
    expect(r.skippedCount).toBe(0);
    expect(r.written).toEqual([]);
  });

  it('all written refs use kind: backlog-directive', () => {
    const r = writeBacklogDirectives(
      [fixture({ slug: 'a' }), fixture({ slug: 'b' })],
      { outDir: tmp }
    );
    for (const w of r.written) expect(w.kind).toBe('backlog-directive');
  });
});
