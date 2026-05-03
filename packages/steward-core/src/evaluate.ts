/**
 * Process evaluator — the core compliance-check loop.
 *
 * Given a process definition, an event stream, and the current time, walk
 * each transition and detect whether the deadline has elapsed without the
 * expected next event. Emit `ProcessDrift` records for missed transitions.
 *
 * P0 implementation is single-pass and stateless: callers provide the full
 * relevant event stream each cycle. P1 will add the `steward_process_state`
 * table to avoid re-scanning history.
 *
 * Reference: devops-steward-agent-design-2026-05-03.md §3.4 + §5.
 */

import type { StewardEvent } from './events.js';
import type { Invariant, Process, ProcessDrift } from './process-graph.js';
import { ProcessDriftSchema } from './process-graph.js';
import { evaluatePredicate, PredicateError } from './predicate.js';

const MS_PER_MINUTE = 60_000;

/* ───────────────────────────────────────────────────────────────────────── *
 *  Apply invariants to derive Steward events from raw events                 *
 * ───────────────────────────────────────────────────────────────────────── */

/**
 * Walk a process's invariants over a single event. If a predicate matches,
 * emit a derived event with the configured type and payload-mapping.
 *
 * Multiple invariants may match a single event; multiple events may be
 * emitted. The lifecycle key for correlation is taken from the source event's
 * `correlationId` field if present, else from the first declared payload key.
 */
export function applyInvariants(process: Process, event: StewardEvent): StewardEvent[] {
  const derived: StewardEvent[] = [];
  for (const inv of process.invariants) {
    let matched: unknown;
    try {
      matched = evaluatePredicate(inv.when, { event });
    } catch (err) {
      // Predicate errors are policy bugs, not data issues. Skip the invariant
      // for this event so a single broken rule doesn't crash the daemon; the
      // daemon's own error path will surface the predicate error.
      if (err instanceof PredicateError) {
        continue;
      }
      throw err;
    }
    if (!matched) continue;
    derived.push(buildDerivedEvent(process.id, inv, event));
  }
  return derived;
}

function buildDerivedEvent(
  processId: string,
  inv: Invariant,
  source: StewardEvent,
): StewardEvent {
  const payload: Record<string, unknown> = { _processId: processId, _invariantId: inv.id };
  if (inv.payload) {
    for (const [key, expr] of Object.entries(inv.payload)) {
      payload[key] = resolvePayloadExpression(expr, { event: source });
    }
  }
  const correlationId = source.correlationId ?? deriveCorrelationKey(source, inv.id);
  return {
    id: `derived::${processId}::${inv.id}::${source.id}`,
    source: 'self',
    type: inv.emit,
    repo: source.repo,
    payload,
    observedAt: source.observedAt,
    correlationId,
  };
}

/**
 * Resolve a payload expression. Supports:
 *   - literal strings (no `$.` prefix)
 *   - jsonpath-style accessors prefixed with `$.` (e.g. "$.event.payload.pull_request.number")
 */
// Guard against prototype-pollution path access (semgrep prototype-pollution-loop).
// The path comes from trusted YAML, but defense-in-depth: refuse the standard
// dunder paths regardless.
const FORBIDDEN_PATH_KEYS = new Set(['__proto__', 'constructor', 'prototype']);

function resolvePayloadExpression(expr: string, ctx: Record<string, unknown>): unknown {
  if (!expr.startsWith('$.')) return expr;
  const path = expr.slice(2);
  const parts = path.split('.');
  let cur: unknown = ctx;
  for (const p of parts) {
    if (cur == null || typeof cur !== 'object') return undefined;
    if (FORBIDDEN_PATH_KEYS.has(p)) return undefined;
    if (!Object.prototype.hasOwnProperty.call(cur, p)) return undefined;
    cur = (cur as Record<string, unknown>)[p];
  }
  return cur;
}

function deriveCorrelationKey(source: StewardEvent, invariantId: string): string {
  // Fall back to a deterministic key derived from source event fields.
  return `${source.repo}::${invariantId}::${source.id}`;
}

/* ───────────────────────────────────────────────────────────────────────── *
 *  Walk transitions and detect drift                                         *
 * ───────────────────────────────────────────────────────────────────────── */

export interface EvaluateOptions {
  /** Current time, as Unix epoch milliseconds. Defaults to Date.now(). */
  now?: number;
}

/**
 * Run a single process against a normalized event stream and return any
 * drift records (one per missed transition).
 *
 * The event stream must include both raw events (those the watcher emitted
 * from polling) and any derived events from prior cycles (for P0 we accept
 * either; the caller is responsible for de-duplication).
 *
 * Algorithm:
 *   1. Apply invariants to every raw event to derive Steward events.
 *   2. Group all events (raw + derived) by lifecycleKey (correlation id).
 *   3. For each lifecycle, walk transitions; emit drift if expected_next is
 *      missing and the deadline has elapsed.
 */
export function evaluateProcess(
  process: Process,
  events: StewardEvent[],
  opts: EvaluateOptions = {},
): ProcessDrift[] {
  if (!process.enabled) return [];

  const now = opts.now ?? Date.now();
  const drifts: ProcessDrift[] = [];

  // 1. Build the full set of relevant events: raw events whose type appears
  //    in this process's signals or transitions, plus all derived events
  //    from invariants applied to raw events.
  const signalSet = new Set(process.signals);
  const transitionTypes = new Set<string>();
  for (const t of process.transitions) {
    transitionTypes.add(t.from);
    transitionTypes.add(t.expected_next);
  }

  const allEvents: StewardEvent[] = [];
  for (const ev of events) {
    if (signalSet.has(ev.type) || transitionTypes.has(ev.type)) {
      allEvents.push(ev);
    }
    // Apply invariants regardless of signal match, since invariants may
    // emit a derived event whose type IS in transitionTypes.
    if (signalSet.has(ev.type)) {
      const derived = applyInvariants(process, ev);
      allEvents.push(...derived);
    }
  }

  // 2. Group by lifecycleKey.
  const lifecycles = new Map<string, StewardEvent[]>();
  for (const ev of allEvents) {
    const key = ev.correlationId ?? `_singleton::${ev.id}`;
    const arr = lifecycles.get(key);
    if (arr) {
      arr.push(ev);
    } else {
      lifecycles.set(key, [ev]);
    }
  }

  // 3. For each lifecycle, walk transitions.
  for (const [lifecycleKey, lifecycleEvents] of lifecycles) {
    const eventsByType = new Map<string, StewardEvent[]>();
    for (const ev of lifecycleEvents) {
      const arr = eventsByType.get(ev.type);
      if (arr) arr.push(ev);
      else eventsByType.set(ev.type, [ev]);
    }

    for (const transition of process.transitions) {
      const fromEvents = eventsByType.get(transition.from);
      if (!fromEvents || fromEvents.length === 0) continue;

      // Use the most recent `from` event as the deadline anchor.
      const fromEvent = fromEvents.reduce((latest, ev) =>
        ev.observedAt > latest.observedAt ? ev : latest,
      );
      const deadline = fromEvent.observedAt + transition.deadline_min * MS_PER_MINUTE;
      if (now < deadline) continue; // not yet due

      const nextEvents = eventsByType.get(transition.expected_next);
      if (nextEvents && nextEvents.some((ev) => ev.observedAt >= fromEvent.observedAt)) {
        // Expected next event was observed; no drift.
        continue;
      }

      // Drift!
      const drift: ProcessDrift = ProcessDriftSchema.parse({
        processId: process.id,
        processVersion: process.version,
        fromEventType: transition.from,
        expectedNext: transition.expected_next,
        lifecycleKey,
        deadlineMin: transition.deadline_min,
        detectedAt: now,
        fromObservedAt: fromEvent.observedAt,
        severity: transition.on_miss.severity,
        recoveryKind: transition.on_miss.recovery_kind,
        recoveryPayload: transition.on_miss.recovery_payload,
      });
      drifts.push(drift);
    }
  }

  return drifts;
}
