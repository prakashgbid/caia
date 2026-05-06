import { describe, expect, it } from 'vitest';

import { applyPiiMask } from '../src/pii-mask.js';

describe('applyPiiMask', () => {
  it('redacts email shapes', () => {
    const r = applyPiiMask('Contact alice@example.com about this.');
    expect(r.masked).toBe('Contact [redacted-email] about this.');
    expect(r.redactedSpans).toContain('email');
  });

  it('redacts Anthropic / OpenAI sk- key shape', () => {
    const r = applyPiiMask('key=sk-abcdefghijklmnopqrstuvwxyz1234567890');
    expect(r.masked).toContain('[redacted-secret');
    expect(r.redactedSpans).toContain('secret');
  });

  it('redacts GitHub PAT', () => {
    const r = applyPiiMask('token: ghp_AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA');
    expect(r.masked).toContain('[redacted-secret');
    expect(r.redactedSpans).toContain('secret');
  });

  it('redacts Mac /Users/name/ paths', () => {
    const r = applyPiiMask('/Users/test-user/some/file.md');
    expect(r.masked).toBe('~/some/file.md');
    expect(r.redactedSpans).toContain('path');
  });

  it('redacts Linux /home/name/ paths', () => {
    const r = applyPiiMask('/home/alice/work');
    expect(r.masked).toBe('~/work');
    expect(r.redactedSpans).toContain('path');
  });

  it('handles multiple types in one pass', () => {
    const r = applyPiiMask(
      'See alice@example.com or sk-abcdefghijklmnopqrstuvwxyz1234567890 in /Users/x/y.md'
    );
    expect(r.redactedSpans.sort()).toEqual(['email', 'path', 'secret']);
  });

  it('passes through clean text untouched', () => {
    const r = applyPiiMask('No secrets here, just words.');
    expect(r.masked).toBe('No secrets here, just words.');
    expect(r.redactedSpans).toEqual([]);
  });

  it('redactedSpans is sorted alphabetically for stability', () => {
    const r = applyPiiMask('alice@example.com and /Users/x/y');
    const sorted = [...r.redactedSpans].sort();
    expect(r.redactedSpans).toEqual(sorted);
  });
});
