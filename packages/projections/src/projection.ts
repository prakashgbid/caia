import picomatch from 'picomatch';
import type { EventLike, ProjectionDef, ProjectionStore, Checkpoint } from './types.js';

export function defineProjection<TState>(def: ProjectionDef<TState>): ProjectionDef<TState> {
  return def;
}

/** Apply a single event to an existing state, returning the new state. Pure. */
export function applyEvent<TState>(
  def: ProjectionDef<TState>,
  state: TState,
  event: EventLike,
): TState {
  for (const [pattern, handler] of Object.entries(def.handlers)) {
    if (!handler) continue;
    if (picomatch.isMatch(event.type, pattern)) {
      return handler(state, event.payload, event);
    }
  }
  return state;
}

/** Build state from scratch by replaying all events. Pure. */
export function buildProjection<TState>(
  def: ProjectionDef<TState>,
  events: EventLike[],
): TState {
  let state = def.init();
  for (const event of events) {
    state = applyEvent(def, state, event);
  }
  return state;
}

/**
 * Create a stateful store backed by a projection definition.
 * The store tracks a checkpoint (last applied event id/timestamp) so
 * callers can resume incremental rebuilds.
 */
export function createProjectionStore<TState>(
  def: ProjectionDef<TState>,
): ProjectionStore<TState> {
  let state = def.init();
  let checkpoint: Checkpoint | null = null;

  return {
    getState(): TState {
      return state;
    },

    apply(event: EventLike): void {
      state = applyEvent(def, state, event);
      if (event.id && event.occurred_at) {
        checkpoint = { lastEventId: event.id, lastEventAt: event.occurred_at };
      }
    },

    rebuild(events: EventLike[]): void {
      state = buildProjection(def, events);
      const last = events.at(-1);
      checkpoint =
        last?.id && last.occurred_at
          ? { lastEventId: last.id, lastEventAt: last.occurred_at }
          : null;
    },

    reset(): void {
      state = def.init();
      checkpoint = null;
    },

    getCheckpoint(): Checkpoint | null {
      return checkpoint;
    },
  };
}
