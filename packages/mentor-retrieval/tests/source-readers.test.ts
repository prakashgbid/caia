/**
 * Tests for the source-file discovery layer.
 */

import { mkdirSync, writeFileSync } from 'node:fs';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import {
  defaultFsReader,
  isFeedbackFile,
  isProposalFile,
  pathToSlug
} from '../src/source-readers.js';

describe('isFeedbackFile', () => {
  it('accepts feedback_*.md', () => {
    expect(isFeedbackFile('feedback_pat_topic.md')).toBe(true);
    expect(isFeedbackFile('feedback_no_api_key_billing.md')).toBe(true);
  });
  it('rejects bak files', () => {
    expect(isFeedbackFile('feedback_pat_topic.md.bak-2026-05-03')).toBe(false);
  });
  it('rejects non-feedback files', () => {
    expect(isFeedbackFile('mentor_agent_directive.md')).toBe(false);
    expect(isFeedbackFile('MEMORY.md')).toBe(false);
  });
  it('rejects non-md', () => {
    expect(isFeedbackFile('feedback_x.txt')).toBe(false);
  });
});

describe('isProposalFile', () => {
  it('accepts md files', () => {
    expect(isProposalFile('20260505-051149-unclassified-leg-4-stage-6-verify-test.md')).toBe(true);
  });
  it('rejects dotfiles', () => {
    expect(isProposalFile('.hidden.md')).toBe(false);
  });
  it('rejects non-md', () => {
    expect(isProposalFile('foo.txt')).toBe(false);
  });
});

describe('pathToSlug', () => {
  it('extracts basename and strips extension', () => {
    expect(pathToSlug('/x/y/feedback_pat_topic.md')).toBe('feedback_pat_topic');
  });
  it('lowercases', () => {
    expect(pathToSlug('/x/FOO.md')).toBe('foo');
  });
  it('collapses unsafe chars', () => {
    expect(pathToSlug('/x/foo bar baz.md')).toBe('foo-bar-baz');
  });
});

describe('defaultFsReader.readDir', () => {
  let memoryDir: string;
  beforeEach(() => {
    memoryDir = mkdtempSync(join(tmpdir(), 'mentor-retrieval-srcs-'));
  });
  afterEach(() => {
    // mkdtempSync is in /tmp which is auto-cleaned; no-op.
  });

  it('returns empty array for non-existent dir', () => {
    expect(defaultFsReader.readDir(join(memoryDir, 'no-such-place'))).toEqual([]);
  });

  it('picks up feedback_*.md files at root', () => {
    writeFileSync(join(memoryDir, 'feedback_a.md'), 'a');
    writeFileSync(join(memoryDir, 'feedback_b.md'), 'b');
    writeFileSync(join(memoryDir, 'unrelated.md'), 'x');
    writeFileSync(join(memoryDir, 'feedback_a.md.bak'), 'old');
    const files = defaultFsReader.readDir(memoryDir);
    expect(files.map((f) => f.path).sort()).toEqual([
      join(memoryDir, 'feedback_a.md'),
      join(memoryDir, 'feedback_b.md')
    ]);
    for (const f of files) {
      expect(f.kind).toBe('feedback');
      expect(f.size).toBeGreaterThan(0);
      expect(f.mtimeMs).toBeGreaterThan(0);
    }
  });

  it('picks up proposals/*.md files', () => {
    mkdirSync(join(memoryDir, 'proposals'));
    writeFileSync(join(memoryDir, 'proposals', '20260505-x.md'), 'p');
    writeFileSync(join(memoryDir, 'proposals', '20260505-y.md'), 'q');
    const files = defaultFsReader.readDir(memoryDir);
    expect(files.map((f) => f.path).sort()).toEqual([
      join(memoryDir, 'proposals', '20260505-x.md'),
      join(memoryDir, 'proposals', '20260505-y.md')
    ]);
    for (const f of files) {
      expect(f.kind).toBe('proposal');
    }
  });

  it('combines feedback + proposals + sorts by path', () => {
    writeFileSync(join(memoryDir, 'feedback_z.md'), 'z');
    writeFileSync(join(memoryDir, 'feedback_a.md'), 'a');
    mkdirSync(join(memoryDir, 'proposals'));
    writeFileSync(join(memoryDir, 'proposals', 'p1.md'), 'x');
    const files = defaultFsReader.readDir(memoryDir);
    expect(files.map((f) => f.kind)).toEqual(['feedback', 'feedback', 'proposal']);
    // feedback_a comes before feedback_z
    expect(files[0]!.path).toContain('feedback_a.md');
    expect(files[1]!.path).toContain('feedback_z.md');
  });
});

describe('defaultFsReader.readFile', () => {
  it('reads file content as utf-8', () => {
    const dir = mkdtempSync(join(tmpdir(), 'mentor-retrieval-rf-'));
    const p = join(dir, 'x.md');
    writeFileSync(p, 'hello');
    expect(defaultFsReader.readFile(p)).toBe('hello');
  });
});
