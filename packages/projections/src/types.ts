export type EventLike = {
  id?: string;
  type: string;
  occurred_at?: string;
  payload: Record<string, unknown>;
};

export type Handler<TState, TPayload = Record<string, unknown>> = (
  state: TState,
  payload: TPayload,
  event: EventLike
) => TState;

export interface ProjectionDef<TState> {
  init: () => TState;
  /** Map of event type -> handler. Supports glob patterns via picomatch. */
  handlers: Partial<Record<string, Handler<TState>>>;
}

export interface Checkpoint {
  lastEventId: string;
  lastEventAt: string;
}

export interface ProjectionStore<TState> {
  getState(): TState;
  apply(event: EventLike): void;
  rebuild(events: EventLike[]): void;
  reset(): void;
  getCheckpoint(): Checkpoint | null;
}
