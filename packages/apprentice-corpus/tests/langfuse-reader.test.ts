import { describe, expect, it } from 'vitest';

import { createLangfuseReader, formatTraceText } from '../src/langfuse-reader.js';
import { createFakeLangfuse } from './helpers/fakes.js';

describe('formatTraceText', () => {
  it('formats input + output', () => {
    expect(formatTraceText('hi', 'hello')).toBe('Input:\nhi\n\nOutput:\nhello');
  });
  it('returns empty when both empty', () => {
    expect(formatTraceText('', '')).toBe('');
  });
});

describe('createLangfuseReader', () => {
  it('returns [] when disabled (default Phase-0 stub posture)', async () => {
    const reader = createLangfuseReader({
      client: createFakeLangfuse([
        { id: 't1', name: 'x', input: 'a', output: 'b', createdAtMs: Date.now() }
      ]),
      projectId: 'test',
      enabled: false
    });
    expect(await reader.read({ maxAgeDays: 1, nowMs: Date.now() })).toEqual([]);
  });

  it('reads when enabled', async () => {
    const now = Date.now();
    const reader = createLangfuseReader({
      client: createFakeLangfuse([
        { id: 't1', name: 'agent.run', input: 'a', output: 'b', createdAtMs: now }
      ]),
      projectId: 'test',
      enabled: true
    });
    const out = await reader.read({ maxAgeDays: 1, nowMs: now });
    expect(out.length).toBe(1);
    expect(out[0]?.sourceId).toBe('t1');
    expect(out[0]?.kind).toBe('agent.run');
  });
});
