import { describe, expect, it } from 'vitest';

import { createEventBusReader, projectEventToText } from '../src/event-bus-reader.js';
import { createFakeEventBus } from './helpers/fakes.js';

describe('projectEventToText', () => {
  it('flattens payload to lines', () => {
    const text = projectEventToText({
      id: 'e-1',
      type: 'TaskCompleted',
      emittedAtMs: 0,
      payload: { taskId: 't-1', durationMs: 200, exitCode: 0 }
    });
    expect(text).toContain('Event: TaskCompleted');
    expect(text).toContain('taskId: t-1');
    expect(text).toContain('durationMs: 200');
  });

  it('returns empty string when payload has no detail lines', () => {
    const text = projectEventToText({
      id: 'e-1',
      type: 'X',
      emittedAtMs: 0,
      payload: {}
    });
    expect(text).toBe('');
  });
});

describe('createEventBusReader', () => {
  it('reads events newer than the cutoff', async () => {
    const now = Date.now();
    const oldEvent = {
      id: 'old',
      type: 'TaskCompleted',
      emittedAtMs: now - 1000 * 60 * 60 * 24 * 400,
      payload: { taskId: 'old', durationMs: 1, exitCode: 0 }
    };
    const newEvent = {
      id: 'new',
      type: 'TaskCompleted',
      emittedAtMs: now,
      payload: { taskId: 'new', durationMs: 1, exitCode: 0 }
    };
    const reader = createEventBusReader({
      client: createFakeEventBus([oldEvent, newEvent])
    });
    const out = await reader.read({ maxAgeDays: 365, nowMs: now });
    expect(out.map((a) => a.sourceId)).toEqual(['new']);
    expect(out[0]?.kind).toBe('TaskCompleted');
    expect(out[0]?.text).toContain('taskId: new');
  });

  it('returns [] on read error', async () => {
    const reader = createEventBusReader({
      client: {
        async readSince() {
          throw new Error('boom');
        }
      }
    });
    expect(await reader.read({ maxAgeDays: 1, nowMs: Date.now() })).toEqual([]);
  });
});
