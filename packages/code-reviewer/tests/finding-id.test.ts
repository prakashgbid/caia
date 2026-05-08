import { describe, it, expect } from 'vitest';
import { findingId } from '../src/finding-id.js';

describe('findingId', () => {
  it('produces a stable hex string', () => {
    const id = findingId({ dimension: 'correctness', file: 'a.ts', line: 10, issueTitle: 'bug' });
    expect(id).toMatch(/^[0-9a-f]{8}$/);
  });

  it('is deterministic', () => {
    const a = findingId({ dimension: 'correctness', file: 'a.ts', line: 10, issueTitle: 'bug' });
    const b = findingId({ dimension: 'correctness', file: 'a.ts', line: 10, issueTitle: 'bug' });
    expect(a).toBe(b);
  });

  it('changes when any input changes', () => {
    const base = findingId({ dimension: 'correctness', file: 'a.ts', line: 10, issueTitle: 'bug' });
    expect(findingId({ dimension: 'correctness', file: 'a.ts', line: 11, issueTitle: 'bug' })).not.toBe(base);
    expect(findingId({ dimension: 'correctness', file: 'b.ts', line: 10, issueTitle: 'bug' })).not.toBe(base);
    expect(findingId({ dimension: 'naming', file: 'a.ts', line: 10, issueTitle: 'bug' })).not.toBe(base);
    expect(findingId({ dimension: 'correctness', file: 'a.ts', line: 10, issueTitle: 'other' })).not.toBe(base);
  });
});
