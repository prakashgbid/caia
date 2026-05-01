import { describe, it, expect } from 'vitest';
import {
  defineProjection,
  applyEvent,
  buildProjection,
  createProjectionStore,
} from '../src/index.js';
import type { EventLike } from '../src/index.js';

const counter = defineProjection({
  init: () => ({ count: 0, items: [] as string[] }),
  handlers: {
    'item.created': (state, payload) => ({
      ...state,
      count: state.count + 1,
      items: [...state.items, (payload as { id: string }).id],
    }),
    'item.deleted': (state) => ({ ...state, count: Math.max(0, state.count - 1) }),
    'item.*': (state) => state, // catch-all fallback
  },
});

const ev = (type: string, payload: Record<string, unknown> = {}, id?: string): EventLike => ({
  id,
  type,
  occurred_at: id ? new Date().toISOString() : undefined,
  payload,
});

describe('applyEvent', () => {
  it('applies a matching handler', () => {
    const state = counter.init();
    const next = applyEvent(counter, state, ev('item.created', { id: 'a' }));
    expect(next.count).toBe(1);
    expect(next.items).toEqual(['a']);
  });

  it('returns state unchanged for unknown event', () => {
    const state = counter.init();
    const next = applyEvent(counter, state, ev('order.placed'));
    expect(next).toBe(state);
  });

  it('handles glob patterns', () => {
    const proj = defineProjection({
      init: () => ({ seen: [] as string[] }),
      handlers: {
        'task.*': (state, _p, e) => ({ seen: [...state.seen, e.type] }),
      },
    });
    const next = applyEvent(proj, proj.init(), ev('task.started'));
    expect(next.seen).toEqual(['task.started']);
  });
});

describe('buildProjection', () => {
  it('reduces all events in order', () => {
    const events = [
      ev('item.created', { id: 'x' }),
      ev('item.created', { id: 'y' }),
      ev('item.deleted'),
    ];
    const state = buildProjection(counter, events);
    expect(state.count).toBe(1);
    expect(state.items).toEqual(['x', 'y']);
  });

  it('returns init state for empty event list', () => {
    const state = buildProjection(counter, []);
    expect(state).toEqual(counter.init());
  });
});

describe('createProjectionStore', () => {
  it('starts with init state', () => {
    const store = createProjectionStore(counter);
    expect(store.getState()).toEqual(counter.init());
  });

  it('apply mutates state', () => {
    const store = createProjectionStore(counter);
    store.apply(ev('item.created', { id: 'a' }));
    store.apply(ev('item.created', { id: 'b' }));
    expect(store.getState().count).toBe(2);
  });

  it('rebuild replaces state from event list', () => {
    const store = createProjectionStore(counter);
    store.apply(ev('item.created', { id: 'old' }));
    store.rebuild([ev('item.created', { id: 'new' })]);
    expect(store.getState().items).toEqual(['new']);
  });

  it('reset returns to init state and clears checkpoint', () => {
    const store = createProjectionStore(counter);
    store.apply(ev('item.created', { id: 'a' }, 'ev_001'));
    store.reset();
    expect(store.getState()).toEqual(counter.init());
    expect(store.getCheckpoint()).toBeNull();
  });

  it('records checkpoint after apply when id and occurred_at present', () => {
    const store = createProjectionStore(counter);
    const timestamp = '2026-05-01T00:00:00.000Z';
    store.apply({ id: 'ev_123', type: 'item.created', occurred_at: timestamp, payload: { id: 'x' } });
    expect(store.getCheckpoint()).toEqual({ lastEventId: 'ev_123', lastEventAt: timestamp });
  });

  it('checkpoint is null when events have no id', () => {
    const store = createProjectionStore(counter);
    store.apply(ev('item.created', { id: 'a' }));
    expect(store.getCheckpoint()).toBeNull();
  });

  it('rebuild sets checkpoint from last event', () => {
    const store = createProjectionStore(counter);
    const ts = '2026-05-01T12:00:00.000Z';
    store.rebuild([{ id: 'ev_999', type: 'item.created', occurred_at: ts, payload: { id: 'z' } }]);
    expect(store.getCheckpoint()).toEqual({ lastEventId: 'ev_999', lastEventAt: ts });
  });

  it('does not crash on unknown events', () => {
    const store = createProjectionStore(counter);
    expect(() => store.apply(ev('unknown.event'))).not.toThrow();
    expect(store.getState().count).toBe(0);
  });
});
