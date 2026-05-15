import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { existsSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  DEFAULT_RETENTION_DAYS,
  parseInbox,
  pruneInbox,
} from '../src/inbox-retention.js';

// H-40 tests (chain-runner-battle-harden phase 11, 2026-05-14).

describe('H-40 INBOX retention', () => {
  let dir: string;
  let inboxPath: string;
  let archiveDir: string;
  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'caia-inbox-'));
    inboxPath = join(dir, 'INBOX.md');
    archiveDir = join(dir, 'INBOX_archive');
  });
  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  it('parseInbox separates preamble from H2 alert blocks', () => {
    const text = `# Chain-Watchdog INBOX\n\n## 2026-05-13T10:00:00Z — alert one\n- chain: x\n\n## 2026-05-14T11:00:00Z — alert two\n- chain: y\n`;
    const { preamble, blocks } = parseInbox(text);
    expect(preamble.startsWith('# Chain-Watchdog INBOX')).toBe(true);
    expect(blocks.length).toBe(2);
    expect(blocks[0]!.ts?.toISOString()).toBe('2026-05-13T10:00:00.000Z');
    expect(blocks[0]!.body).toContain('alert one');
    expect(blocks[1]!.ts?.toISOString()).toBe('2026-05-14T11:00:00.000Z');
  });

  it('parseInbox handles bracketed timestamps and milliseconds', () => {
    const text = `## [2026-05-13T10:00:00.123Z] cron_stall_detected — chain-x\n- detail: foo\n`;
    const { blocks } = parseInbox(text);
    expect(blocks.length).toBe(1);
    expect(blocks[0]!.ts?.toISOString()).toBe('2026-05-13T10:00:00.123Z');
  });

  it('pruneInbox is a no-op on a missing INBOX', () => {
    const r = pruneInbox({ inboxPath, days: 7 });
    expect(r.scanned).toBe(0);
    expect(r.kept).toBe(0);
    expect(r.rewrote_inbox).toBe(false);
  });

  it('pruneInbox is a no-op when nothing is past retention', () => {
    const now = new Date('2026-05-14T12:00:00Z');
    const recent = new Date(now.getTime() - 86400 * 1000)
      .toISOString()
      .replace(/\.\d+Z$/, 'Z');
    const text = `# INBOX\n\n## ${recent} — recent alert\n- detail: hi\n`;
    writeFileSync(inboxPath, text);
    const r = pruneInbox({ inboxPath, days: 7, now });
    expect(r.scanned).toBe(1);
    expect(r.kept).toBe(1);
    expect(r.rewrote_inbox).toBe(false);
    expect(existsSync(archiveDir)).toBe(false);
  });

  it('pruneInbox archives old alerts to <yyyy-mm>.md and rewrites INBOX', () => {
    const now = new Date('2026-05-14T12:00:00Z');
    const old1 = '2026-04-01T00:00:00Z';
    const old2 = '2026-04-15T00:00:00Z';
    const new1 = '2026-05-13T00:00:00Z';
    const text =
      `# INBOX\n\n` +
      `## ${old1} — april alert one\n- chain: a\n\n` +
      `## ${old2} — april alert two\n- chain: b\n\n` +
      `## ${new1} — may recent alert\n- chain: c\n`;
    writeFileSync(inboxPath, text);
    const r = pruneInbox({ inboxPath, days: 7, now });
    expect(r.scanned).toBe(3);
    expect(r.kept).toBe(1);
    expect(r.archived['2026-04.md']).toBe(2);
    expect(r.rewrote_inbox).toBe(true);
    // Archive file exists with both april alerts.
    const aprilPath = join(archiveDir, '2026-04.md');
    expect(existsSync(aprilPath)).toBe(true);
    const archive = readFileSync(aprilPath, 'utf8');
    expect(archive).toContain('april alert one');
    expect(archive).toContain('april alert two');
    // INBOX retains preamble + may alert only.
    const newInbox = readFileSync(inboxPath, 'utf8');
    expect(newInbox).toContain('# INBOX');
    expect(newInbox).toContain('may recent alert');
    expect(newInbox).not.toContain('april alert one');
  });

  it('pruneInbox appends to an existing archive file (idempotent across runs)', () => {
    const now = new Date('2026-05-14T12:00:00Z');
    const old = '2026-04-01T00:00:00Z';
    writeFileSync(
      inboxPath,
      `# INBOX\n\n## ${old} — first old alert\n- chain: a\n`,
    );
    const r1 = pruneInbox({ inboxPath, days: 7, now });
    expect(r1.kept).toBe(0);
    // Re-add another old alert and prune again.
    writeFileSync(
      inboxPath,
      `# INBOX\n\n## ${old} — second old alert\n- chain: b\n`,
    );
    const r2 = pruneInbox({ inboxPath, days: 7, now });
    expect(r2.kept).toBe(0);
    const archive = readFileSync(join(archiveDir, '2026-04.md'), 'utf8');
    expect(archive).toContain('first old alert');
    expect(archive).toContain('second old alert');
    // No duplicate header.
    const headerCount = (archive.match(/^# INBOX archive — 2026-04$/m) ?? []).length;
    expect(headerCount).toBe(1);
  });

  it('pruneInbox preserves blocks with unparseable timestamps', () => {
    const now = new Date('2026-05-14T12:00:00Z');
    const text =
      `# INBOX\n\n` +
      `## not-a-timestamp — weird block\n- chain: ?\n\n` +
      `## 2026-04-01T00:00:00Z — old alert\n- chain: a\n`;
    writeFileSync(inboxPath, text);
    const r = pruneInbox({ inboxPath, days: 7, now });
    expect(r.kept).toBe(1); // the unparseable one survives
    const newInbox = readFileSync(inboxPath, 'utf8');
    expect(newInbox).toContain('weird block');
    expect(newInbox).not.toContain('old alert');
  });

  it('uses DEFAULT_RETENTION_DAYS=7 by default', () => {
    expect(DEFAULT_RETENTION_DAYS).toBe(7);
  });

  it('groups archived alerts spanning multiple months', () => {
    const now = new Date('2026-05-14T12:00:00Z');
    const text =
      `## 2026-03-15T00:00:00Z — march alert\n- chain: a\n\n` +
      `## 2026-04-15T00:00:00Z — april alert\n- chain: b\n\n` +
      `## 2026-05-13T00:00:00Z — may alert\n- chain: c\n`;
    writeFileSync(inboxPath, text);
    const r = pruneInbox({ inboxPath, days: 7, now });
    expect(Object.keys(r.archived).sort()).toEqual([
      '2026-03.md',
      '2026-04.md',
    ]);
    expect(readdirSync(archiveDir).sort()).toEqual([
      '2026-03.md',
      '2026-04.md',
    ]);
  });
});
