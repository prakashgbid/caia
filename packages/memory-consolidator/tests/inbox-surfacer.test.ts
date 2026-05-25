import { describe, expect, it } from 'vitest';
import { dedupKey, surfaceToInbox } from '../src/inbox-surfacer.js';
import { makeMemoryFsAdapter } from '../src/fs-adapter.js';
import type { Finding } from '../src/types.js';

function f(kind: Finding['kind'], src: string, detail: string): Finding {
  return { kind, sourceRelPath: src, detail, severity: 'warn' };
}

describe('dedupKey', () => {
  it('combines kind, source, detail', () => {
    expect(dedupKey(f('broken-wikilink', 'a.md', 'something'))).toBe('broken-wikilink|a.md|something');
  });

  it('truncates detail to 200 chars', () => {
    const long = 'x'.repeat(300);
    const k = dedupKey(f('broken-wikilink', 'a.md', long));
    expect(k.length).toBeLessThanOrEqual('broken-wikilink|a.md|'.length + 200);
  });
});

describe('surfaceToInbox', () => {
  const now = new Date('2026-05-25T10:00:00Z');

  it('returns zero entries for empty findings', () => {
    const fs = makeMemoryFsAdapter({});
    const r = surfaceToInbox([], { inboxPath: '/i/INBOX.md', fs, now, dedupeWindowDays: 7 });
    expect(r.newEntries).toBe(0);
  });

  it('writes new INBOX file when none exists', () => {
    const fs = makeMemoryFsAdapter({});
    const r = surfaceToInbox([f('broken-wikilink', 'a.md', 'bad')], { inboxPath: '/i/INBOX.md', fs, now, dedupeWindowDays: 7 });
    expect(r.newEntries).toBe(1);
    expect(fs.exists('/i/INBOX.md')).toBe(true);
    const c = fs.readFile('/i/INBOX.md');
    expect(c).toContain('## 2026-05-25 — memory drift');
    expect(c).toContain('[broken-wikilink]');
    expect(c).toContain('a.md');
  });

  it('appends to existing INBOX', () => {
    const fs = makeMemoryFsAdapter({ '/i/INBOX.md': '# Operator INBOX\n\nSome existing notes.\n' });
    surfaceToInbox([f('broken-wikilink', 'a.md', 'bad')], { inboxPath: '/i/INBOX.md', fs, now, dedupeWindowDays: 7 });
    const c = fs.readFile('/i/INBOX.md');
    expect(c).toContain('Some existing notes.');
    expect(c).toContain('## 2026-05-25 — memory drift');
  });

  it('dedups identical finding seen within window', () => {
    const fs = makeMemoryFsAdapter({
      '/i/INBOX.md': '## 2026-05-24 — memory drift\n\n- [broken-wikilink] `a.md` — bad\n\n',
    });
    const r = surfaceToInbox([f('broken-wikilink', 'a.md', 'bad')], { inboxPath: '/i/INBOX.md', fs, now, dedupeWindowDays: 7 });
    expect(r.newEntries).toBe(0);
    expect(r.dedupedEntries).toBe(1);
  });

  it('does NOT dedup findings outside the window', () => {
    const fs = makeMemoryFsAdapter({
      '/i/INBOX.md': '## 2025-01-01 — memory drift\n\n- [broken-wikilink] `a.md` — bad\n\n',
    });
    const r = surfaceToInbox([f('broken-wikilink', 'a.md', 'bad')], { inboxPath: '/i/INBOX.md', fs, now, dedupeWindowDays: 7 });
    expect(r.newEntries).toBe(1);
  });

  it('dedups within same surfacing call', () => {
    const fs = makeMemoryFsAdapter({});
    const r = surfaceToInbox([
      f('broken-wikilink', 'a.md', 'bad'),
      f('broken-wikilink', 'a.md', 'bad'),
      f('broken-wikilink', 'b.md', 'bad'),
    ], { inboxPath: '/i/INBOX.md', fs, now, dedupeWindowDays: 7 });
    expect(r.newEntries).toBe(2);
    expect(r.dedupedEntries).toBe(1);
  });

  it('survives malformed date headings', () => {
    const fs = makeMemoryFsAdapter({
      '/i/INBOX.md': '## not-a-date — memory drift\n\n- [broken-wikilink] `a.md` — bad\n\n',
    });
    const r = surfaceToInbox([f('broken-wikilink', 'a.md', 'bad')], { inboxPath: '/i/INBOX.md', fs, now, dedupeWindowDays: 7 });
    // Malformed header is not parsed; new entry surfaces.
    expect(r.newEntries).toBe(1);
  });

  it('treats kind differences as distinct keys', () => {
    const fs = makeMemoryFsAdapter({
      '/i/INBOX.md': '## 2026-05-24 — memory drift\n\n- [broken-wikilink] `a.md` — bad\n\n',
    });
    const r = surfaceToInbox([f('broken-mdlink', 'a.md', 'bad')], { inboxPath: '/i/INBOX.md', fs, now, dedupeWindowDays: 7 });
    expect(r.newEntries).toBe(1);
  });
});
