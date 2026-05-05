import { describe, it, expect } from 'vitest';
import { validatePayload, describeSchema, EVENT_SCHEMAS } from '../src/schemas';

describe('validatePayload', () => {
  it('accepts a valid PRMerged payload', () => {
    const result = validatePayload('PRMerged', {
      prNumber: 312,
      sha: 'abc1234',
      branch: 'develop'
    });
    expect(result.ok).toBe(true);
  });

  it('rejects PRMerged with bad SHA', () => {
    const result = validatePayload('PRMerged', {
      prNumber: 312,
      sha: 'NOT-A-SHA',
      branch: 'develop'
    });
    expect(result.ok).toBe(false);
  });

  it('rejects PRMerged missing required field', () => {
    const result = validatePayload('PRMerged', { prNumber: 312, sha: 'abc1234' });
    expect(result.ok).toBe(false);
  });

  it('accepts a valid TaskSpawned payload with optional parent', () => {
    const result = validatePayload('TaskSpawned', {
      taskId: 't1',
      agentName: 'worker-coding'
    });
    expect(result.ok).toBe(true);
  });

  it('accepts MemoryWritten with operation = create', () => {
    const result = validatePayload('MemoryWritten', {
      path: 'memory/foo.md',
      size: 1234,
      operation: 'create'
    });
    expect(result.ok).toBe(true);
  });

  it('rejects MemoryWritten with unknown operation', () => {
    const result = validatePayload('MemoryWritten', {
      path: 'memory/foo.md',
      size: 1234,
      operation: 'wibble'
    });
    expect(result.ok).toBe(false);
  });

  it('accepts OperatorCorrection with detectionMode=manual', () => {
    const result = validatePayload('OperatorCorrection', {
      correctionText: 'no, do it the other way',
      detectionMode: 'manual'
    });
    expect(result.ok).toBe(true);
  });

  it('rejects OperatorCorrection with empty text', () => {
    const result = validatePayload('OperatorCorrection', {
      correctionText: '',
      detectionMode: 'manual'
    });
    expect(result.ok).toBe(false);
  });
});

describe('describeSchema', () => {
  it('returns a string', () => {
    const desc = describeSchema(EVENT_SCHEMAS.PRMerged);
    expect(typeof desc).toBe('string');
    expect(desc.length).toBeGreaterThan(2);
  });
});
