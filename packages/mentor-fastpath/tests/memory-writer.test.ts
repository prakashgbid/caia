/**
 * Unit + integration tests for the memory-writer.
 *
 * Uses a fresh tmpdir per test for full isolation. Tests cover:
 *   - Filename format: timestamp prefix + slug
 *   - Directory auto-creation
 *   - Idempotent re-write (same slug, same content → no new file)
 *   - Collision avoidance (same slug, different content → numeric suffix)
 *   - Atomic-ish write (no .tmp file left behind on success)
 *   - Filename safety guard rejects traversal attempts
 *   - listProposals returns paths sorted by mtime
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { existsSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import {
  buildFilename,
  formatTimestampPrefix,
  listProposals,
  PROPOSALS_SUBDIR,
  writeProposal
} from '../src/memory-writer.js';
import type { SynthesizedLesson } from '../src/synthesizer.js';

let tmp: string;

beforeEach(() => {
  tmp = mkdtempSync(join(tmpdir(), 'mentor-memwriter-'));
});

afterEach(() => {
  rmSync(tmp, { recursive: true, force: true });
});

function mkLesson(
  overrides: Partial<SynthesizedLesson> = {}
): SynthesizedLesson {
  return {
    slug: 'relitigation-we-already-decided',
    title: 'ReLitigation — we already decided this',
    frontmatter: {
      name: 'ReLitigation — we already decided this',
      type: 'feedback-proposal',
      classifiedAs: 'ReLitigation'
    },
    markdown: '---\nname: test\n---\n\n# test\n\n## Why\n\nbody',
    ...overrides
  };
}

describe('formatTimestampPrefix', () => {
  it('formats UTC date as YYYYMMDD-HHMMSS', () => {
    const d = new Date('2026-05-05T01:23:45.000Z');
    expect(formatTimestampPrefix(d)).toBe('20260505-012345');
  });

  it('zero-pads single-digit month/day/hour/minute/second', () => {
    const d = new Date('2026-01-02T03:04:05.000Z');
    expect(formatTimestampPrefix(d)).toBe('20260102-030405');
  });
});

describe('buildFilename', () => {
  it('joins timestamp + slug + .md', () => {
    const d = new Date('2026-05-05T01:23:45.000Z');
    expect(buildFilename('my-slug', d)).toBe('20260505-012345-my-slug.md');
  });
});

describe('writeProposal', () => {
  it('creates the proposals subdirectory if missing', () => {
    const lesson = mkLesson();
    const result = writeProposal(lesson, { memoryDir: tmp });
    expect(existsSync(join(tmp, PROPOSALS_SUBDIR))).toBe(true);
    expect(result.created).toBe(true);
    expect(existsSync(result.path)).toBe(true);
  });

  it('writes the proposal markdown verbatim', () => {
    const lesson = mkLesson({ markdown: '---\nname: hello\n---\n\n# hello' });
    const result = writeProposal(lesson, { memoryDir: tmp });
    expect(readFileSync(result.path, 'utf-8')).toBe('---\nname: hello\n---\n\n# hello');
  });

  it('produces a filename with the timestamp prefix and slug', () => {
    const lesson = mkLesson({ slug: 'my-test-slug' });
    const fixed = new Date('2026-05-05T07:08:09.000Z');
    const result = writeProposal(lesson, { memoryDir: tmp, now: fixed });
    expect(result.filename).toBe('20260505-070809-my-test-slug.md');
  });

  it('is idempotent: same slug + same content + same timestamp → no rewrite', () => {
    const lesson = mkLesson();
    const fixed = new Date('2026-05-05T07:08:09.000Z');
    const r1 = writeProposal(lesson, { memoryDir: tmp, now: fixed });
    expect(r1.created).toBe(true);
    const r2 = writeProposal(lesson, { memoryDir: tmp, now: fixed });
    expect(r2.created).toBe(false);
    expect(r2.path).toBe(r1.path);
  });

  it('produces a numeric-suffix filename when content differs at same timestamp+slug', () => {
    const fixed = new Date('2026-05-05T07:08:09.000Z');
    const r1 = writeProposal(mkLesson({ markdown: 'first body' }), {
      memoryDir: tmp,
      now: fixed
    });
    const r2 = writeProposal(mkLesson({ markdown: 'second body' }), {
      memoryDir: tmp,
      now: fixed
    });
    expect(r1.created).toBe(true);
    expect(r2.created).toBe(true);
    expect(r2.filename).toMatch(/-2\.md$/);
    expect(readFileSync(r2.path, 'utf-8')).toBe('second body');
  });

  it('does not leave a .tmp file behind after a successful write', () => {
    const lesson = mkLesson();
    const result = writeProposal(lesson, { memoryDir: tmp });
    const proposalsDir = join(tmp, PROPOSALS_SUBDIR);
    const entries = readdirSync(proposalsDir);
    expect(entries).toContain(result.filename);
    expect(entries.find((e) => e.endsWith('.tmp'))).toBeUndefined();
  });

  it('rejects an unsafe slug at write time (defence-in-depth)', () => {
    const lesson = mkLesson({ slug: '../../../etc/passwd' });
    expect(() => writeProposal(lesson, { memoryDir: tmp })).toThrow(/unsafe/);
  });

  it('different slugs produce different filenames at same timestamp', () => {
    const fixed = new Date('2026-05-05T07:08:09.000Z');
    const r1 = writeProposal(mkLesson({ slug: 'slug-a' }), {
      memoryDir: tmp,
      now: fixed
    });
    const r2 = writeProposal(mkLesson({ slug: 'slug-b' }), {
      memoryDir: tmp,
      now: fixed
    });
    expect(r1.path).not.toBe(r2.path);
    expect(r1.filename).toContain('slug-a');
    expect(r2.filename).toContain('slug-b');
  });
});

describe('listProposals', () => {
  it('returns [] when the proposals dir does not exist', () => {
    expect(listProposals(tmp)).toEqual([]);
  });

  it('returns [] when the proposals dir is empty', () => {
    const lesson = mkLesson();
    writeProposal(lesson, { memoryDir: tmp });
    // Now delete its content to simulate empty dir
    const proposalsDir = join(tmp, PROPOSALS_SUBDIR);
    for (const f of readdirSync(proposalsDir)) rmSync(join(proposalsDir, f));
    expect(listProposals(tmp)).toEqual([]);
  });

  it('returns proposals sorted by mtime ascending (oldest first)', async () => {
    const proposalsDir = join(tmp, PROPOSALS_SUBDIR);
    writeProposal(
      mkLesson({ slug: 'first', markdown: 'first' }),
      { memoryDir: tmp, now: new Date('2026-05-05T01:00:00Z') }
    );
    // wait briefly so mtime differs
    await new Promise((resolve) => setTimeout(resolve, 30));
    writeProposal(
      mkLesson({ slug: 'second', markdown: 'second' }),
      { memoryDir: tmp, now: new Date('2026-05-05T02:00:00Z') }
    );
    const list = listProposals(tmp);
    expect(list.length).toBe(2);
    expect(list[0]).toContain('first.md');
    expect(list[1]).toContain('second.md');
    // Belt-and-braces: confirm they are inside the proposals dir
    expect(list[0]).toContain(proposalsDir);
  });

  it('ignores non-.md files', () => {
    const proposalsDir = join(tmp, PROPOSALS_SUBDIR);
    writeProposal(mkLesson({ slug: 'a' }), {
      memoryDir: tmp,
      now: new Date('2026-05-05T01:00:00Z')
    });
    writeFileSync(join(proposalsDir, 'something.txt'), 'noise');
    writeFileSync(join(proposalsDir, '.DS_Store'), 'mac noise');
    const list = listProposals(tmp);
    expect(list.length).toBe(1);
    expect(list[0]).toContain('-a.md');
  });
});
