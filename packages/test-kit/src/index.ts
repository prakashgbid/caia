import type { Logger } from '@chiefaia/logger';
import type { EventBus } from '@chiefaia/events';
import { MemorySecretsAdapter, createSecretsClient } from '@chiefaia/secrets';

export type { MemorySecretsAdapter };
export { createSecretsClient };

/** Creates a no-op logger suitable for tests — silences all output */
export function createTestLogger(): Logger {
  const noop = () => undefined;
  function makeLogger(): Logger {
    return {
      trace: noop,
      debug: noop,
      info: noop,
      warn: noop,
      error: noop,
      fatal: noop,
      child: () => makeLogger(),
    };
  }
  return makeLogger();
}

/** Creates a spy logger that captures log lines for assertions */
export function createSpyLogger(): Logger & { lines: Array<{ level: string; msg: string; ctx?: unknown }> } {
  const lines: Array<{ level: string; msg: string; ctx?: unknown }> = [];

  function makeLogger(bindings: Record<string, unknown> = {}): ReturnType<typeof createSpyLogger> {
    function log(level: string, msg: string, ctx?: unknown): void {
      lines.push({ level, msg, ctx: { ...bindings, ...(ctx as Record<string, unknown> | undefined) } });
    }
    return Object.assign(
      {
        trace: (msg: string, ctx?: unknown) => log('trace', msg, ctx),
        debug: (msg: string, ctx?: unknown) => log('debug', msg, ctx),
        info: (msg: string, ctx?: unknown) => log('info', msg, ctx),
        warn: (msg: string, ctx?: unknown) => log('warn', msg, ctx),
        error: (msg: string, ctx?: unknown) => log('error', msg, ctx),
        fatal: (msg: string, ctx?: unknown) => log('fatal', msg, ctx),
        child: (b: Record<string, unknown>) => makeLogger({ ...bindings, ...b }),
      },
      { lines },
    );
  }

  return makeLogger();
}

/** Creates an in-memory event bus for testing — same interface as production bus */
export { createEventBus as createTestEventBus } from '@chiefaia/events';

/** Creates a secrets client pre-loaded with test values */
export function createTestSecretsClient(values: Record<string, string> = {}) {
  return createSecretsClient(new MemorySecretsAdapter(values));
}

/** Waits for a condition to be truthy, polling every `interval` ms */
export async function waitFor(
  condition: () => boolean | Promise<boolean>,
  { timeout = 5000, interval = 50 } = {},
): Promise<void> {
  const deadline = Date.now() + timeout;
  while (Date.now() < deadline) {
    if (await condition()) return;
    await new Promise((r) => setTimeout(r, interval));
  }
  throw new Error(`waitFor timed out after ${timeout}ms`);
}
