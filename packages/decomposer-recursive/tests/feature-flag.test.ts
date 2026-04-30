import { describe, it, expect } from 'vitest';
import {
  PO_USE_RECURSIVE_DECOMPOSER_ENV,
  STAGE_PO_DECOMPOSING,
  useRecursiveDecomposer,
} from '../src/feature-flag.js';

describe('STAGE_PO_DECOMPOSING', () => {
  it('is the stable canonical pipeline-stage name', () => {
    expect(STAGE_PO_DECOMPOSING).toBe('po_decomposing');
  });
});

describe('PO_USE_RECURSIVE_DECOMPOSER_ENV', () => {
  it('is the canonical env var name', () => {
    expect(PO_USE_RECURSIVE_DECOMPOSER_ENV).toBe('PO_USE_RECURSIVE_DECOMPOSER');
  });
});

describe('useRecursiveDecomposer', () => {
  it('defaults to false when no env or value is provided', () => {
    expect(useRecursiveDecomposer({ env: {} })).toBe(false);
  });

  it('respects explicit value=true', () => {
    expect(useRecursiveDecomposer({ value: true })).toBe(true);
  });

  it('respects explicit value=false even when env is "1"', () => {
    expect(
      useRecursiveDecomposer({
        value: false,
        env: { PO_USE_RECURSIVE_DECOMPOSER: '1' },
      }),
    ).toBe(false);
  });

  it.each([['1'], ['true'], ['TRUE'], ['yes'], ['on']])(
    'parses %s as true',
    (raw) => {
      expect(
        useRecursiveDecomposer({ env: { PO_USE_RECURSIVE_DECOMPOSER: raw } }),
      ).toBe(true);
    },
  );

  it.each([['0'], ['false'], ['no'], ['off'], ['']])(
    'parses %s as false',
    (raw) => {
      expect(
        useRecursiveDecomposer({ env: { PO_USE_RECURSIVE_DECOMPOSER: raw } }),
      ).toBe(false);
    },
  );

  it('handles whitespace + case-mixing', () => {
    expect(
      useRecursiveDecomposer({ env: { PO_USE_RECURSIVE_DECOMPOSER: '  TruE  ' } }),
    ).toBe(true);
  });
});
