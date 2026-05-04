import { describe, it, expect } from 'vitest';
import { pruneBuilds, isDiskUsageOk } from '../src/disk-prune';

describe('disk-prune', () => {
  it('should have pruneBuilds function', () => {
    expect(typeof pruneBuilds).toBe('function');
  });

  it('should have isDiskUsageOk function', () => {
    expect(typeof isDiskUsageOk).toBe('function');
  });

  it('should handle missing builds directory', () => {
    const result = pruneBuilds('/tmp/nonexistent-' + Date.now(), 10);
    expect(result.success).toBe(true);
    expect(result.removedDirs).toEqual([]);
  });

  it('should handle disk check for valid path', () => {
    // Check a path that should always exist
    const ok = isDiskUsageOk('/tmp');
    expect(typeof ok).toBe('boolean');
  });
});
