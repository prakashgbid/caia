import { describe, it, expect } from 'vitest';
import { atomicSwap } from '../src/atomic-swap';

describe('import test', () => {
  it('should import atomicSwap function', () => {
    expect(typeof atomicSwap).toBe('function');
  });
});
