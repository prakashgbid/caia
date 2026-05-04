import { describe, it, expect } from 'vitest';
import { atomicSwap, rollbackToPrevious, getCurrentTarget, getPreviousTarget } from '../src/atomic-swap';

describe('atomic-swap', () => {
  it('should have atomicSwap function', () => {
    expect(typeof atomicSwap).toBe('function');
  });

  it('should have rollbackToPrevious function', () => {
    expect(typeof rollbackToPrevious).toBe('function');
  });

  it('should have getCurrentTarget function', () => {
    expect(typeof getCurrentTarget).toBe('function');
  });

  it('should have getPreviousTarget function', () => {
    expect(typeof getPreviousTarget).toBe('function');
  });

  it('should handle missing directory gracefully', () => {
    const result = atomicSwap('/tmp/nonexistent-dir-' + Date.now(), 'builds/sha-001');
    expect(result.success).toBe(false);
    expect(result.error).toBeDefined();
  });

  it('should return undefined for non-existent symlink', () => {
    const target = getCurrentTarget('/tmp/nonexistent-dir-' + Date.now());
    expect(target).toBeUndefined();
  });
});
