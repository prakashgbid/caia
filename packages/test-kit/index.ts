/**
 * Conductor test-kit — shared test utilities.
 *
 * expectEventEmitted(bus, type, matcher) — resolves when matching event fires.
 * expectLogEmitted(loggerSpy, level, fieldMatcher) — asserts pino log fields.
 * coverageConfig — vitest config fragment with 100% thresholds.
 */

import type { ConductorEvent } from '../events-taxonomy/index';

// ─── Event bus spy ────────────────────────────────────────────────────────────

export interface EventEmitterLike {
  on(event: string, listener: (...args: unknown[]) => void): unknown;
  off(event: string, listener: (...args: unknown[]) => void): unknown;
}

export type EventMatcher = Partial<{
  type: string;
  actor: string;
  entity_id: string;
  entity_type: string;
  project_slug: string;
  payload: Record<string, unknown>;
}>;

function matchesEvent(event: ConductorEvent, matcher: EventMatcher): boolean {
  if (matcher.type && event.type !== matcher.type) return false;
  if (matcher.actor && event.actor !== matcher.actor) return false;
  if (matcher.entity_id && event.entity_id !== matcher.entity_id) return false;
  if (matcher.entity_type && event.entity_type !== matcher.entity_type) return false;
  if (matcher.project_slug && event.project_slug !== matcher.project_slug) return false;
  if (matcher.payload) {
    for (const [k, v] of Object.entries(matcher.payload)) {
      if (JSON.stringify(event.payload[k]) !== JSON.stringify(v)) return false;
    }
  }
  return true;
}

/**
 * Waits up to `timeoutMs` for an event matching `type` and `matcher` to be
 * published through the bus. Resolves with the matched event.
 *
 * @no-events — itself doesn't need an event; it IS the event assertion helper.
 */
export function expectEventEmitted(
  bus: EventEmitterLike,
  type: string,
  matcher: Omit<EventMatcher, 'type'> = {},
  timeoutMs = 3000,
): Promise<ConductorEvent> {
  return new Promise<ConductorEvent>((resolve, reject) => {
    const timer = setTimeout(() => {
      bus.off('conductor:event', listener);
      reject(new Error(`expectEventEmitted: no "${type}" event within ${timeoutMs}ms`));
    }, timeoutMs);

    const listener = (event: unknown) => {
      const e = event as ConductorEvent;
      if (matchesEvent(e, { ...matcher, type })) {
        clearTimeout(timer);
        bus.off('conductor:event', listener);
        resolve(e);
      }
    };

    bus.on('conductor:event', listener);
  });
}

// ─── Logger spy ───────────────────────────────────────────────────────────────

export interface PinoLogLine {
  level: string | number;
  msg?: string;
  module?: string;
  correlation_id?: string;
  [key: string]: unknown;
}

export type LogMatcher = Partial<PinoLogLine> & { msgContains?: string };

/**
 * Asserts that a pino logger spy captured a log line matching the given fields.
 * Pass `loggerSpy` as the array you collect from jest.spyOn or pino stream writes.
 *
 * @no-events — pure assertion utility.
 */
export function expectLogEmitted(
  logLines: PinoLogLine[],
  level: string | number,
  matcher: Omit<LogMatcher, 'level'> = {},
): PinoLogLine {
  const match = logLines.find(line => {
    const lvl = typeof level === 'string' ? level : level;
    if (line.level !== lvl) return false;
    if (matcher.msgContains && !String(line.msg ?? '').includes(String(matcher.msgContains))) return false;
    if (matcher.module && line.module !== matcher.module) return false;
    if (matcher.correlation_id && line.correlation_id !== matcher.correlation_id) return false;
    for (const [k, v] of Object.entries(matcher)) {
      if (k === 'msgContains') continue;
      if (JSON.stringify(line[k]) !== JSON.stringify(v)) return false;
    }
    return true;
  });

  if (!match) {
    const found = logLines.map(l => `[${l.level}] ${String(l.msg ?? '')} ${JSON.stringify(l)}`).join('\n  ');
    throw new Error(
      `expectLogEmitted: no "${level}" log matching ${JSON.stringify(matcher)}.\nFound:\n  ${found}`,
    );
  }
  return match;
}

// ─── Coverage config fragment ─────────────────────────────────────────────────

export const coverageConfig = {
  coverage: {
    enabled: true,
    provider: 'v8' as const,
    reporter: ['text', 'json', 'html'] as string[],
    reportsDirectory: './reports/coverage',
    thresholds: {
      lines: 100,
      functions: 100,
      branches: 80,
      statements: 100,
    },
    include: [
      'src/**/*.ts',
      'packages/**/*.ts',
    ],
    exclude: [
      'src/cli/**',
      'src/db/seed*.ts',
      'src/db/migrate-from-jsonl.ts',
      '**/*.d.ts',
      '**/node_modules/**',
    ],
  },
};

// ─── Bus test factory ─────────────────────────────────────────────────────────

import { EventEmitter } from 'events';

/** Create an isolated in-memory event bus for tests (no DB). */
export function createTestBus(): {
  publish: (partial: Partial<ConductorEvent> & { type: string }) => ConductorEvent;
  bus: EventEmitter;
  emitted: ConductorEvent[];
} {
  const bus = new EventEmitter();
  const emitted: ConductorEvent[] = [];

  const publish = (partial: Partial<ConductorEvent> & { type: string }): ConductorEvent => {
    const event: ConductorEvent = {
      id: `test_${Date.now()}`,
      occurred_at: new Date().toISOString(),
      actor: 'system',
      severity: 'info',
      payload: {},
      ...partial,
    } as ConductorEvent;
    emitted.push(event);
    bus.emit('conductor:event', event);
    return event;
  };

  return { publish, bus, emitted };
}
