import { describe, expect, it } from 'vitest';
import { runConsolidation } from '../src/run.js';
import { makeMemoryFsAdapter } from '../src/fs-adapter.js';

const clock = () => new Date('2026-05-25T10:00:00Z');

describe('runConsolidation', () => {
  it('runs end-to-end and writes report', async () => {
    const fs = makeMemoryFsAdapter({
      '/m/MEMORY.md': '- [[a]]\n- [[b]]\n',
      '/m/a.md': '# A\nsee [[c]]',
      '/m/b.md': '# B',
    });
    const r = await runConsolidation({ corpusRoot: '/m', inboxPath: '/i/INBOX.md', reportsRoot: '/r', fs, clock });
    expect(r.filesScanned).toBe(3);
    expect(r.findings.length).toBeGreaterThan(0);
    expect(r.reportPath).toContain('memory_consolidation_2026-05-25.md');
  });

  it('dryRun skips INBOX + report writes', async () => {
    const fs = makeMemoryFsAdapter({
      '/m/a.md': 'see [[bogus]]',
    });
    const r = await runConsolidation({ corpusRoot: '/m', inboxPath: '/i/INBOX.md', reportsRoot: '/r', fs, clock, dryRun: true });
    expect(r.dryRun).toBe(true);
    expect(r.newInboxEntries).toBe(0);
    expect(r.reportPath).toBeNull();
    expect(fs.exists('/i/INBOX.md')).toBe(false);
    expect(fs.exists('/r/memory_consolidation_2026-05-25.md')).toBe(false);
  });

  it('clean tree produces zero findings', async () => {
    const fs = makeMemoryFsAdapter({
      '/m/MEMORY.md': '- [[a]]\n',
      '/m/a.md': '# A',
    });
    const r = await runConsolidation({ corpusRoot: '/m', inboxPath: '/i/INBOX.md', reportsRoot: '/r', fs, clock });
    expect(r.findings).toEqual([]);
  });

  it('defaults inboxPath to corpusRoot/INBOX.md when omitted', async () => {
    const fs = makeMemoryFsAdapter({
      '/m/a.md': 'see [[bogus]]',
    });
    const r = await runConsolidation({ corpusRoot: '/m', reportsRoot: '/r', fs, clock });
    expect(fs.exists('/m/INBOX.md')).toBe(true);
    expect(r.newInboxEntries).toBeGreaterThan(0);
  });
});
