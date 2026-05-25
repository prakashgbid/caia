import { describe, expect, it } from 'vitest';
import { renderReport, writeScanReport } from '../src/reporter.js';
import { makeMemoryFsAdapter } from '../src/fs-adapter.js';
import type { ScanReport } from '../src/types.js';

const base: ScanReport = {
  runAt: '2026-05-25T10:00:00.000Z',
  sourcesScanned: 3,
  itemsFound: 10,
  itemsJudged: 10,
  itemsRelevant: 2,
  candidateAdrs: [],
  inboxEntries: 0,
  reportPath: null,
  errors: [],
  dryRun: false,
};

describe('renderReport', () => {
  it('renders summary with counts', () => {
    const out = renderReport(base, '2026-05-25');
    expect(out).toContain('# AI-First daily upgrade scan — 2026-05-25');
    expect(out).toContain('Sources scanned: 3');
    expect(out).toContain('Items relevant');
  });

  it('lists candidate ADRs', () => {
    const out = renderReport({ ...base, candidateAdrs: [{ slug: 'a', filePath: '/d/c.md', content: '' }] }, '2026-05-25');
    expect(out).toContain('/d/c.md');
  });

  it('lists errors', () => {
    const out = renderReport({ ...base, errors: [{ kind: 'judge-error', itemUrl: 'http://x', message: 'boom' }] }, '2026-05-25');
    expect(out).toContain('[judge-error]');
    expect(out).toContain('boom');
  });
});

describe('writeScanReport', () => {
  it('writes to reports root', () => {
    const fs = makeMemoryFsAdapter({});
    const p = writeScanReport(base, { reportsRoot: '/r', fs, now: new Date('2026-05-25T10:00:00Z') });
    expect(p).toContain('daily_upgrade_scan_2026-05-25.md');
    expect(fs.exists(p)).toBe(true);
  });
});
