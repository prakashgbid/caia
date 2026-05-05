import { describe, it, expect } from 'vitest';
import { EVENT_TYPES } from '../src/types';
import { EVENT_SCHEMAS, assertEverySchemaPresent } from '../src/schemas';

describe('event taxonomy', () => {
  it('declares 22 event types', () => {
    expect(EVENT_TYPES.length).toBe(22);
  });

  it('event type names are unique', () => {
    const set = new Set(EVENT_TYPES);
    expect(set.size).toBe(EVENT_TYPES.length);
  });

  it('every event type has a registered Zod schema', () => {
    expect(() => assertEverySchemaPresent()).not.toThrow();
    for (const t of EVENT_TYPES) {
      expect(EVENT_SCHEMAS[t]).toBeDefined();
    }
  });
});
