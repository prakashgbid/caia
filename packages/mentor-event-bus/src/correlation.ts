/**
 * Correlation-ID storage backed by AsyncLocalStorage.
 *
 * Producers wrap a logical operation in `withCorrelation('id', () => ...)` and
 * any nested `emit()` calls automatically inherit the correlation_id without
 * needing to thread it through call sites.
 *
 * Why this matters: Mentor reconstructs multi-event chains
 * (PromptReceived → PromptDecomposed → TaskSpawned → TaskCompleted) by
 * grouping on correlation_id. If producers had to thread the ID manually,
 * we'd miss events on every code-path that forgets.
 */

import { AsyncLocalStorage } from 'node:async_hooks';

interface CorrelationContext {
  correlationId: string;
  parentEventId?: string;
}

const storage = new AsyncLocalStorage<CorrelationContext>();

/**
 * Run `fn` with the given correlation_id active in the current async context.
 * Any `emit()` invoked synchronously or asynchronously inside fn picks it up.
 */
export function withCorrelation<T>(
  correlationId: string,
  fn: () => T,
  parentEventId?: string
): T {
  const ctx: CorrelationContext = { correlationId };
  if (parentEventId !== undefined) {
    ctx.parentEventId = parentEventId;
  }
  return storage.run(ctx, fn);
}

/**
 * Async-aware variant of withCorrelation.
 */
export async function withCorrelationAsync<T>(
  correlationId: string,
  fn: () => Promise<T>,
  parentEventId?: string
): Promise<T> {
  const ctx: CorrelationContext = { correlationId };
  if (parentEventId !== undefined) {
    ctx.parentEventId = parentEventId;
  }
  return storage.run(ctx, fn);
}

/**
 * Read the current correlation context, or undefined if outside withCorrelation.
 */
export function currentCorrelation(): CorrelationContext | undefined {
  return storage.getStore();
}

/**
 * Read just the correlation_id from the current context.
 */
export function currentCorrelationId(): string | undefined {
  return storage.getStore()?.correlationId;
}

/**
 * Read just the parent_event_id from the current context.
 */
export function currentParentEventId(): string | undefined {
  return storage.getStore()?.parentEventId;
}
