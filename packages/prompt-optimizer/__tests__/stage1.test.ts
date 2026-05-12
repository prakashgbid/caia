import { describe, expect, it } from 'vitest';

import {
  collapseWhitespace,
  dedupeBlocks,
  findProtectedRanges,
  foldLongFileReads,
  isIndexProtected,
  normalizeJson,
  stage1Prepass,
  stripAnsiBomCrlf,
  tagProtectedSpans,
  truncateBase64,
} from '../src/stage1.js';

describe('stage1 — stripAnsiBomCrlf', () => {
  it('strips ANSI color escapes', () => {
    const s = '\x1B[31mred\x1B[0m text';
    expect(stripAnsiBomCrlf(s)).toBe('red text');
  });

  it('converts CRLF to LF', () => {
    expect(stripAnsiBomCrlf('a\r\nb\r\nc')).toBe('a\nb\nc');
  });

  it('strips leading BOM', () => {
    expect(stripAnsiBomCrlf('﻿hello')).toBe('hello');
  });
});

describe('stage1 — collapseWhitespace', () => {
  it('collapses runs of internal spaces to one space', () => {
    expect(collapseWhitespace('foo    bar')).toBe('foo bar');
  });

  it('collapses 3+ newlines to 2', () => {
    expect(collapseWhitespace('a\n\n\n\nb')).toBe('a\n\nb');
  });

  it('strips trailing whitespace', () => {
    expect(collapseWhitespace('hello   ')).toBe('hello');
  });

  it('preserves leading indentation', () => {
    expect(collapseWhitespace('    foo')).toBe('    foo');
  });
});

describe('stage1 — dedupeBlocks', () => {
  it('collapses an identical 3-line block repeated twice', () => {
    const s = 'a\nb\nc\na\nb\nc\nz';
    const out = dedupeBlocks(s);
    expect(out).toContain('(repeated 2×)');
    expect(out).toContain('z');
    expect(out.split('\n').length).toBeLessThan(s.split('\n').length);
  });

  it('leaves non-repeating content alone', () => {
    const s = 'one\ntwo\nthree\nfour';
    expect(dedupeBlocks(s)).toBe(s);
  });

  it('handles 5× repeated block', () => {
    const block = 'x\ny\nz\n';
    const s = block.repeat(5) + 'end';
    const out = dedupeBlocks(s);
    expect(out).toContain('(repeated 5×)');
  });
});

describe('stage1 — foldLongFileReads', () => {
  it('folds files past threshold to head + tail with marker', () => {
    const lines = Array.from({ length: 250 }, (_, i) => `line ${i}`);
    const out = foldLongFileReads(lines.join('\n'), 200, 5, 5);
    const outLines = out.split('\n');
    expect(outLines.length).toBe(5 + 1 + 5);
    expect(outLines[0]).toBe('line 0');
    expect(outLines[outLines.length - 1]).toBe('line 249');
    expect(out).toContain('lines omitted');
  });

  it('leaves short files alone', () => {
    const s = 'a\nb\nc';
    expect(foldLongFileReads(s, 200, 50, 50)).toBe(s);
  });
});

describe('stage1 — truncateBase64', () => {
  it('truncates long base64-shaped lines and emits a stub marker', () => {
    const long = 'A'.repeat(500);
    const out = truncateBase64(long, 200);
    expect(out).toMatch(/^A{40}\.\.\.truncated:[0-9a-f]{12}\.\.\.$/);
  });

  it('leaves short / non-base64 lines alone', () => {
    expect(truncateBase64('hello world', 200)).toBe('hello world');
  });
});

describe('stage1 — normalizeJson', () => {
  it('sorts keys in fenced JSON blocks', () => {
    const s = '```json\n{"z": 1, "a": 2}\n```';
    const out = normalizeJson(s, true);
    const aIdx = out.indexOf('"a"');
    const zIdx = out.indexOf('"z"');
    expect(aIdx).toBeGreaterThan(-1);
    expect(zIdx).toBeGreaterThan(aIdx);
  });

  it('drops empty values when configured', () => {
    const s = '```json\n{"a": 1, "b": "", "c": null}\n```';
    const out = normalizeJson(s, true);
    expect(out).not.toContain('"b"');
    expect(out).not.toContain('"c"');
    expect(out).toContain('"a"');
  });

  it('leaves invalid JSON blocks untouched', () => {
    const s = '```json\nnot really json\n```';
    expect(normalizeJson(s, true)).toBe(s);
  });
});

describe('stage1 — tagProtectedSpans', () => {
  it('tags file paths', () => {
    const out = tagProtectedSpans('open /tmp/foo.txt now');
    expect(out.text).toContain('«protected:path:/tmp/foo.txt»');
    expect(out.count).toBe(1);
  });

  it('tags email addresses', () => {
    const out = tagProtectedSpans('mail alice@example.com please');
    expect(out.text).toContain('«protected:email:alice@example.com»');
  });

  it('tags hex SHAs ≥ 7 chars', () => {
    const out = tagProtectedSpans('commit deadbeef12345');
    expect(out.text).toContain('«protected:sha:deadbeef12345»');
  });

  it('tags @chiefaia/* package names', () => {
    const out = tagProtectedSpans('use @chiefaia/prompt-optimizer');
    expect(out.text).toContain('«protected:pkg:@chiefaia/prompt-optimizer»');
  });

  it('tags ISO dates', () => {
    const out = tagProtectedSpans('on 2026-05-12 we shipped');
    expect(out.text).toContain('«protected:date:2026-05-12»');
  });

  it('tags backtick-quoted identifiers', () => {
    const out = tagProtectedSpans('rename `Foo_bar` to baz');
    expect(out.text).toContain('«protected:ident:`Foo_bar`»');
  });

  it('does not double-tag already-protected content', () => {
    const out = tagProtectedSpans('the file /a/b.txt and /a/b.txt');
    // Count of opening markers should match count of distinct match insertions.
    const opens = (out.text.match(/«protected:/g) ?? []).length;
    expect(opens).toBe(2);
    expect(out.count).toBe(2);
  });
});

describe('stage1 — findProtectedRanges & isIndexProtected', () => {
  it('finds ranges and answers index membership', () => {
    const text = 'pre «protected:foo:bar» post';
    const ranges = findProtectedRanges(text);
    expect(ranges.length).toBe(1);
    const [start, end] = ranges[0];
    expect(isIndexProtected(start, ranges)).toBe(true);
    expect(isIndexProtected(end - 1, ranges)).toBe(true);
    expect(isIndexProtected(end, ranges)).toBe(false);
    expect(isIndexProtected(0, ranges)).toBe(false);
  });
});

describe('stage1 — end-to-end stage1Prepass', () => {
  it('compresses a typical tool-output blob', () => {
    const input = [
      '\x1B[32mINFO\x1B[0m server starting',
      '',
      '',
      '',
      'a       b      c',
      'repeat',
      'block',
      'here',
      'repeat',
      'block',
      'here',
      'tail',
    ].join('\n');
    const out = stage1Prepass(input);
    expect(out.text).not.toMatch(/\x1B/);
    expect(out.text).not.toMatch(/   /);
    expect(out.text).toContain('(repeated 2×)');
  });

  it('preserves protected entities through the whole pipeline', () => {
    const input = 'fix `Foo` in /src/main.ts at 2026-05-12, see deadbeef1234';
    const out = stage1Prepass(input);
    expect(out.text).toContain('«protected:path:/src/main.ts»');
    expect(out.text).toContain('«protected:date:2026-05-12»');
    expect(out.text).toContain('«protected:sha:deadbeef1234»');
    expect(out.text).toContain('«protected:ident:`Foo`»');
    expect(out.protectedSpans).toBe(4);
  });

  it('is idempotent on already-normalized input', () => {
    const input = 'fix /src/main.ts now';
    const once = stage1Prepass(input).text;
    const twice = stage1Prepass(once).text;
    expect(twice).toBe(once);
  });
});
