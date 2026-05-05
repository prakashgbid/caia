/**
 * Tests for the Curator Phase-2 industry-briefing emitter.
 */

import { existsSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { beforeEach, describe, expect, it } from 'vitest';

import {
  defaultIndustryBriefingsDir,
  renderIndustryBriefingMarkdown,
  writeIndustryBriefings
} from '../../src/actions/industry-briefing-emitter.js';
import type { IndustryBriefingAction } from '../../src/actions/types.js';

function fixture(
  overrides: Partial<IndustryBriefingAction> = {}
): IndustryBriefingAction {
  return {
    kind: 'industry-briefing',
    slug: 'industry-briefing-sample',
    title: 'Sample release one-pager',
    summary: 'Today the X framework released v2.',
    evidence: ['ev-1', 'ev-2'],
    recommendation: 'Pilot v2 in our dashboard.',
    detectedAt: '2026-05-05T22:50:00.000Z',
    sourceFindings: [],
    topic: 'sample-release',
    ...overrides
  };
}

describe('renderIndustryBriefingMarkdown', () => {
  it('renders frontmatter with topic + slug + detectedAt', () => {
    const md = renderIndustryBriefingMarkdown(fixture());
    expect(md).toContain('type: curator-industry-briefing');
    expect(md).toContain('topic: sample-release');
    expect(md).toContain('slug: industry-briefing-sample');
    expect(md).toContain('detectedAt: 2026-05-05T22:50:00.000Z');
  });

  it('includes sourceUrl in frontmatter when provided', () => {
    const md = renderIndustryBriefingMarkdown(
      fixture({ sourceUrl: 'https://example.com/release' })
    );
    expect(md).toContain('sourceUrl: https://example.com/release');
  });

  it('omits sourceUrl line when not provided', () => {
    const md = renderIndustryBriefingMarkdown(fixture());
    expect(md).not.toContain('sourceUrl:');
  });

  it('renders title as H1', () => {
    const md = renderIndustryBriefingMarkdown(fixture());
    expect(md).toContain('# Sample release one-pager');
  });

  it('renders What it is + What it would change for us / Recommended action sections', () => {
    const md = renderIndustryBriefingMarkdown(fixture());
    expect(md).toContain('## What it is');
    expect(md).toContain('Today the X framework released v2.');
    expect(md).toContain("## What it'd change for us / Recommended action");
    expect(md).toContain('Pilot v2 in our dashboard.');
  });

  it('renders Source section when sourceUrl is set', () => {
    const md = renderIndustryBriefingMarkdown(
      fixture({ sourceUrl: 'https://x.com/y' })
    );
    expect(md).toContain('## Source');
    expect(md).toContain('- https://x.com/y');
  });

  it('omits Source section when sourceUrl is missing', () => {
    const md = renderIndustryBriefingMarkdown(fixture());
    expect(md).not.toContain('## Source');
  });

  it('renders Evidence bullets when evidence is non-empty', () => {
    const md = renderIndustryBriefingMarkdown(fixture());
    expect(md).toContain('## Evidence');
    expect(md).toContain('- ev-1');
    expect(md).toContain('- ev-2');
  });

  it('omits Evidence section when empty', () => {
    const md = renderIndustryBriefingMarkdown(fixture({ evidence: [] }));
    expect(md).not.toContain('## Evidence');
  });
});

describe('defaultIndustryBriefingsDir', () => {
  it('joins reportsDir + curator + industry-briefings', () => {
    expect(defaultIndustryBriefingsDir('/tmp/r')).toBe(
      '/tmp/r/curator/industry-briefings'
    );
  });
});

describe('writeIndustryBriefings', () => {
  let tmp: string;
  beforeEach(() => {
    tmp = mkdtempSync(join(tmpdir(), 'curator-ib-emitter-'));
  });

  it('writes one .md per action to the explicit outDir', () => {
    const a = fixture({ slug: 'one' });
    const b = fixture({ slug: 'two', title: 'Two' });
    const r = writeIndustryBriefings([a, b], { outDir: tmp });
    expect(r.outputDir).toBe(tmp);
    expect(r.writtenCount).toBe(2);
    expect(r.skippedCount).toBe(0);
    expect(existsSync(join(tmp, 'one.md'))).toBe(true);
    expect(existsSync(join(tmp, 'two.md'))).toBe(true);
  });

  it('uses defaultIndustryBriefingsDir when only reportsDir is passed', () => {
    const r = writeIndustryBriefings([fixture({ slug: 'rd' })], { reportsDir: tmp });
    expect(r.outputDir).toBe(join(tmp, 'curator', 'industry-briefings'));
  });

  it('throws when neither outDir nor reportsDir is provided', () => {
    expect(() => writeIndustryBriefings([fixture()], {})).toThrow(/outDir.*reportsDir/);
  });

  it('is idempotent — second run skips existing files', () => {
    const a = fixture({ slug: 'idem' });
    writeIndustryBriefings([a], { outDir: tmp });
    const r = writeIndustryBriefings([a], { outDir: tmp });
    expect(r.writtenCount).toBe(0);
    expect(r.skippedCount).toBe(1);
  });

  it('preserves operator edits without force', () => {
    const a = fixture({ slug: 'edit' });
    writeIndustryBriefings([a], { outDir: tmp });
    const path = join(tmp, 'edit.md');
    writeFileSync(path, 'EDIT\n');
    writeIndustryBriefings([a], { outDir: tmp });
    expect(readFileSync(path, 'utf-8')).toBe('EDIT\n');
  });

  it('overwrites with force: true', () => {
    const a = fixture({ slug: 'force' });
    writeIndustryBriefings([a], { outDir: tmp });
    writeFileSync(join(tmp, 'force.md'), 'STALE\n');
    const r = writeIndustryBriefings([a], { outDir: tmp, force: true });
    expect(r.writtenCount).toBe(1);
    expect(readFileSync(join(tmp, 'force.md'), 'utf-8')).not.toBe('STALE\n');
  });

  it('skips force-rewrite when content unchanged', () => {
    const a = fixture({ slug: 'noop' });
    writeIndustryBriefings([a], { outDir: tmp });
    const r = writeIndustryBriefings([a], { outDir: tmp, force: true });
    expect(r.writtenCount).toBe(0);
    expect(r.skippedCount).toBe(1);
  });

  it('all written refs use kind: industry-briefing', () => {
    const r = writeIndustryBriefings(
      [fixture({ slug: 'a' }), fixture({ slug: 'b' })],
      { outDir: tmp }
    );
    for (const w of r.written) expect(w.kind).toBe('industry-briefing');
  });

  it('returns empty result when called with no actions', () => {
    const r = writeIndustryBriefings([], { outDir: tmp });
    expect(r.writtenCount).toBe(0);
    expect(r.skippedCount).toBe(0);
  });
});
