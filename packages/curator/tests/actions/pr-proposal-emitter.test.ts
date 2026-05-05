/**
 * Tests for the Curator Phase-2 PR-proposal emitter.
 */

import { existsSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { beforeEach, describe, expect, it } from 'vitest';

import {
  defaultPrProposalsDir,
  renderPrProposalMarkdown,
  writePrProposals
} from '../../src/actions/pr-proposal-emitter.js';
import type { PrProposalAction } from '../../src/actions/types.js';

function fixture(overrides: Partial<PrProposalAction> = {}): PrProposalAction {
  return {
    kind: 'pr-proposal',
    slug: 'sample-pr-slug',
    title: 'Bump foo to 1.2.3',
    summary: 'Summary paragraph.',
    evidence: ['ev-1', 'ev-2'],
    recommendation: 'Apply the bump.',
    detectedAt: '2026-05-05T22:50:00.000Z',
    sourceFindings: ['dep-bump-scanner'],
    branchSuffix: 'sample-pr-slug',
    affectedPaths: ['package.json', 'pnpm-lock.yaml'],
    ...overrides
  };
}

describe('renderPrProposalMarkdown', () => {
  it('renders frontmatter with all 6 keys + affectedPaths array', () => {
    const md = renderPrProposalMarkdown(fixture());
    expect(md).toContain('type: curator-pr-proposal');
    expect(md).toContain('slug: sample-pr-slug');
    expect(md).toContain('branchSuffix: sample-pr-slug');
    expect(md).toContain('detectedAt: 2026-05-05T22:50:00.000Z');
    expect(md).toContain('sourceFindings: ["dep-bump-scanner"]');
    expect(md).toContain('affectedPaths: ["package.json", "pnpm-lock.yaml"]');
  });

  it('renders title as H1 + summary section', () => {
    const md = renderPrProposalMarkdown(fixture());
    expect(md).toContain('# Bump foo to 1.2.3');
    expect(md).toContain('## Summary');
    expect(md).toContain('Summary paragraph.');
  });

  it('renders evidence section with bullet list', () => {
    const md = renderPrProposalMarkdown(fixture());
    expect(md).toContain('## Evidence');
    expect(md).toContain('- ev-1');
    expect(md).toContain('- ev-2');
  });

  it('omits evidence section when there is no evidence', () => {
    const md = renderPrProposalMarkdown(fixture({ evidence: [] }));
    expect(md).not.toContain('## Evidence');
  });

  it('renders branch + affected paths section', () => {
    const md = renderPrProposalMarkdown(fixture());
    expect(md).toContain('Branch: `chore/curator-sample-pr-slug`');
    expect(md).toContain('- `package.json`');
    expect(md).toContain('- `pnpm-lock.yaml`');
  });

  it('falls back to TBD note when affectedPaths is empty', () => {
    const md = renderPrProposalMarkdown(fixture({ affectedPaths: [] }));
    expect(md).toContain('Affected paths: _TBD');
  });

  it('renders the operator-review checklist with 5 items', () => {
    const md = renderPrProposalMarkdown(fixture());
    expect(md).toContain('## Operator-review checklist');
    const checkboxLines = md.split('\n').filter((l) => l.startsWith('- [ ]'));
    expect(checkboxLines.length).toBe(5);
  });

  it('mentions Evidence Gate + subscription-bucket compliance in checklist', () => {
    const md = renderPrProposalMarkdown(fixture());
    expect(md).toContain('Evidence Gate');
    expect(md).toContain('subscription-bucket');
  });
});

describe('defaultPrProposalsDir', () => {
  it('joins reportsDir + curator + pr-proposals', () => {
    expect(defaultPrProposalsDir('/tmp/reports')).toBe('/tmp/reports/curator/pr-proposals');
  });
});

describe('writePrProposals', () => {
  let tmp: string;
  beforeEach(() => {
    tmp = mkdtempSync(join(tmpdir(), 'curator-pr-proposal-emitter-'));
  });

  it('writes one .md per action to the explicit outDir', () => {
    const a = fixture({ slug: 'one' });
    const b = fixture({ slug: 'two', title: 'Bump bar' });
    const r = writePrProposals([a, b], { outDir: tmp });
    expect(r.outputDir).toBe(tmp);
    expect(r.writtenCount).toBe(2);
    expect(r.skippedCount).toBe(0);
    expect(existsSync(join(tmp, 'one.md'))).toBe(true);
    expect(existsSync(join(tmp, 'two.md'))).toBe(true);
  });

  it('uses defaultPrProposalsDir when only reportsDir is passed', () => {
    const r = writePrProposals([fixture({ slug: 'rd' })], { reportsDir: tmp });
    expect(r.outputDir).toBe(join(tmp, 'curator', 'pr-proposals'));
  });

  it('throws when neither outDir nor reportsDir is provided', () => {
    expect(() => writePrProposals([fixture()], {})).toThrow(/outDir.*reportsDir/);
  });

  it('is idempotent — second run skips existing files', () => {
    const a = fixture({ slug: 'idem' });
    const r1 = writePrProposals([a], { outDir: tmp });
    expect(r1.writtenCount).toBe(1);
    const r2 = writePrProposals([a], { outDir: tmp });
    expect(r2.writtenCount).toBe(0);
    expect(r2.skippedCount).toBe(1);
  });

  it('preserves operator edits when force is not set', () => {
    const a = fixture({ slug: 'edit' });
    writePrProposals([a], { outDir: tmp });
    const path = join(tmp, 'edit.md');
    writeFileSync(path, 'OPERATOR\n');
    writePrProposals([a], { outDir: tmp });
    expect(readFileSync(path, 'utf-8')).toBe('OPERATOR\n');
  });

  it('overwrites with force: true', () => {
    const a = fixture({ slug: 'force' });
    writePrProposals([a], { outDir: tmp });
    const path = join(tmp, 'force.md');
    writeFileSync(path, 'STALE\n');
    const r = writePrProposals([a], { outDir: tmp, force: true });
    expect(r.writtenCount).toBe(1);
    expect(readFileSync(path, 'utf-8')).not.toBe('STALE\n');
  });

  it('skips force-rewrite when content unchanged', () => {
    const a = fixture({ slug: 'noop' });
    writePrProposals([a], { outDir: tmp });
    const r = writePrProposals([a], { outDir: tmp, force: true });
    expect(r.writtenCount).toBe(0);
    expect(r.skippedCount).toBe(1);
  });

  it('returns empty result when called with no actions', () => {
    const r = writePrProposals([], { outDir: tmp });
    expect(r.writtenCount).toBe(0);
    expect(r.skippedCount).toBe(0);
    expect(r.written).toEqual([]);
    expect(r.skipped).toEqual([]);
  });

  it('all written refs use kind: pr-proposal', () => {
    const r = writePrProposals(
      [fixture({ slug: 'k1' }), fixture({ slug: 'k2' })],
      { outDir: tmp }
    );
    for (const w of r.written) expect(w.kind).toBe('pr-proposal');
  });
});
