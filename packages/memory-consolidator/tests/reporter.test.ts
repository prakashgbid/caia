import { describe, expect, it } from 'vitest';
import { renderReport, writeReport } from '../src/reporter.js';
import { makeMemoryFsAdapter } from '../src/fs-adapter.js';
import type { ConsolidationReport } from '../src/types.js';

const base: ConsolidationReport = {
  runAt: '2026-05-25T10:00:00.000Z',
  filesScanned: 5,
  findings: [],
  newInboxEntries: 0,
  reportPath: null,
  dryRun: false,
};

describe('renderReport', () => {
  it('renders no-drift summary', () => {
    const out = renderReport(base, '2026-05-25');
    expect(out).toContain('# Memory consolidation — 2026-05-25');
    expect(out).toContain('Files scanned: 5');
    expect(out).toContain('No drift detected.');
  });

  it('groups findings by kind', () => {
    const out = renderReport({
      ...base,
      findings: [
        { kind: 'broken-wikilink', sourceRelPath: 'a.md', detail: 'bad', severity: 'warn' },
        { kind: 'broken-mdlink', sourceRelPath: 'b.md', detail: 'bad', severity: 'warn' },
        { kind: 'broken-wikilink', sourceRelPath: 'c.md', detail: 'bad', severity: 'warn' },
      ],
    }, '2026-05-25');
    expect(out).toContain('## broken-mdlink (1)');
    expect(out).toContain('## broken-wikilink (2)');
  });

  it('marks DRY-RUN when set', () => {
    const out = renderReport({ ...base, dryRun: true }, '2026-05-25');
    expect(out).toContain('Mode: DRY-RUN');
  });
});

describe('writeReport', () => {
  it('writes to reports root', () => {
    const fs = makeMemoryFsAdapter({});
    const p = writeReport(base, { reportsRoot: '/r', fs, now: new Date('2026-05-25T10:00:00Z') });
    expect(p).toContain('memory_consolidation_2026-05-25.md');
    expect(fs.exists(p)).toBe(true);
  });
});
