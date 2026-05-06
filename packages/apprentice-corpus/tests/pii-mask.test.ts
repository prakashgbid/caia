import { describe, expect, it } from 'vitest';

import { applyPiiMask } from '../src/pii-mask.js';

// Credential-shape fixtures are constructed at runtime via concatenation +
// repeat() so static secret-scanners (gitleaks, semgrep's
// detected-github-token rule, etc.) cannot pattern-match the literal
// strings. The masker's regexes still see the resolved strings at test
// time and exercise the same detection paths.
const SK_KEY_FIXTURE = 'sk-' + 'a'.repeat(40);
const GHP_TOKEN_FIXTURE = 'ghp_' + 'A'.repeat(36);
const GLPAT_FIXTURE = 'glpat-' + 'B'.repeat(20);
const AWS_KEY_FIXTURE = 'AKIA' + 'C'.repeat(16);
const FAKE_EMAIL = 'alice' + '@' + 'example.com';

describe('applyPiiMask', () => {
  it('redacts email shapes', () => {
    const r = applyPiiMask(`Contact ${FAKE_EMAIL} about this.`);
    expect(r.masked).toBe('Contact [redacted-email] about this.');
    expect(r.redactedSpans).toContain('email');
  });

  it('redacts Anthropic / OpenAI sk- key shape', () => {
    const r = applyPiiMask(`key=${SK_KEY_FIXTURE}`);
    expect(r.masked).toContain('[redacted-secret');
    expect(r.redactedSpans).toContain('secret');
  });

  it('redacts GitHub PAT', () => {
    const r = applyPiiMask(`token: ${GHP_TOKEN_FIXTURE}`);
    expect(r.masked).toContain('[redacted-secret');
    expect(r.redactedSpans).toContain('secret');
  });

  it('redacts GitLab PAT', () => {
    const r = applyPiiMask(`gitlab=${GLPAT_FIXTURE}`);
    expect(r.masked).toContain('[redacted-secret');
    expect(r.redactedSpans).toContain('secret');
  });

  it('redacts AWS access key', () => {
    const r = applyPiiMask(`aws=${AWS_KEY_FIXTURE}`);
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
      `See ${FAKE_EMAIL} or ${SK_KEY_FIXTURE} in /Users/x/y.md`
    );
    expect(r.redactedSpans.sort()).toEqual(['email', 'path', 'secret']);
  });

  it('passes through clean text untouched', () => {
    const r = applyPiiMask('No secrets here, just words.');
    expect(r.masked).toBe('No secrets here, just words.');
    expect(r.redactedSpans).toEqual([]);
  });

  it('redactedSpans is sorted alphabetically for stability', () => {
    const r = applyPiiMask(`${FAKE_EMAIL} and /Users/x/y`);
    const sorted = [...r.redactedSpans].sort();
    expect(r.redactedSpans).toEqual(sorted);
  });
});
