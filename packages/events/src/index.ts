export type EventHandler<T> = (payload: T) => void | Promise<void>;

export interface EventBus {
  on<T>(event: string, handler: EventHandler<T>): () => void;
  off<T>(event: string, handler: EventHandler<T>): void;
  emit<T>(event: string, payload: T): Promise<void>;
  once<T>(event: string): Promise<T>;
}

export function createEventBus(): EventBus {
  const handlers = new Map<string, Set<EventHandler<unknown>>>();

  function getHandlers(event: string): Set<EventHandler<unknown>> {
    if (!handlers.has(event)) handlers.set(event, new Set());
    return handlers.get(event)!;
  }

  return {
    on<T>(event: string, handler: EventHandler<T>) {
      getHandlers(event).add(handler as EventHandler<unknown>);
      return () => this.off(event, handler);
    },

    off<T>(event: string, handler: EventHandler<T>) {
      getHandlers(event).delete(handler as EventHandler<unknown>);
    },

    async emit<T>(event: string, payload: T) {
      const fns = [...getHandlers(event)];
      await Promise.all(fns.map((fn) => fn(payload)));
    },

    once<T>(event: string): Promise<T> {
      return new Promise((resolve) => {
        const unsub = this.on<T>(event, (payload) => {
          unsub();
          resolve(payload);
        });
      });
    },
  };
}
