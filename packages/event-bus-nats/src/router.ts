/**
 * HybridEventBus — feature-flag-controlled router between the legacy
 * in-process bus (`@chiefaia/event-bus-internal`) and the NATS
 * JetStream bus (`NatsEventBus` in this package).
 *
 * The flag `BUS_BACKEND_NATS_FOR_EVENT_TYPES` is a CSV of event type
 * strings. Listed types route to NATS; everything else stays on the
 * in-process bus. Default-empty means "100% legacy, NATS connection
 * not even opened" — safe for environments without a broker.
 *
 * Publish: route per event.type.
 *   • For legacy-routed publishes, the legacy bus emits 'conductor:event'
 *     internally — the WS gateway already listens on that, so nothing
 *     special is needed.
 *   • For NATS-routed publishes, the bus ALSO calls
 *     `legacy.emit('conductor:event', event)` after the NATS publish so
 *     in-process WS / projector listeners stay in sync with the unified
 *     event stream. (Legacy SQLite outbox is bypassed because the event
 *     is now durably stored in JetStream.)
 *
 * Subscribe: subscribe to BOTH backends. Each backend only delivers
 * events that were published on it, so handlers don't double-fire.
 *
 * Replay: defer to the legacy SQLite outbox (JetStream-backed replay
 * lands in v0.2).
 *
 * The class also exposes Node-EventEmitter-compatible `on/off/emit`
 * methods that delegate to the legacy bus so existing callers using
 * `eventBus.on('conductor:event', ...)` (e.g. the WS gateway) keep
 * working when this class is re-exported as `eventBus`.
 *
 * Wave 1a (2026-05-25): three events flip via this flag —
 * `tenant.provisioned`, `worker.heartbeat`, `pipeline.stage.advanced`.
 * Per-event consumer overrides (esp. `ackPolicy: 'none'` for the
 * heartbeat firehose) are passed through `natsConfig.consumerOverrides`.
 */

import type {
  ConductorEvent,
} from '@chiefaia/events-taxonomy-internal';
import { NatsEventBus } from './index.js';
import type {
  EventBus,
  EventHandler,
  EventQueryOpts,
  NatsEventBusConfig,
  PublishInput,
  Unsubscribe,
} from './types.js';

/** Name of the env var that controls routing. CSV of event type strings. */
export const BUS_BACKEND_NATS_ENV_VAR = 'BUS_BACKEND_NATS_FOR_EVENT_TYPES';

/** Internal Node-EventEmitter event name the legacy bus uses for the WS gateway. */
const CONDUCTOR_EMITTER_EVENT = 'conductor:event';

/**
 * Minimal structural shape the legacy bus must satisfy. Matches the
 * surface of `@chiefaia/event-bus-internal`'s exported `eventBus`
 * singleton — we keep this structurally typed so this package does
 * NOT take a runtime dependency on event-bus-internal (which is the
 * migration target, not a dependency).
 *
 * The `on/off/emit` methods are optional and reflect that the legacy
 * singleton extends Node's EventEmitter. The HybridEventBus uses them
 * when present so WS callers continue working.
 */
export interface LegacyEventBus {
  publish(input: PublishInput): ConductorEvent;
  subscribe(typeGlob: string, handler: EventHandler): Unsubscribe;
  replay(opts: EventQueryOpts): ConductorEvent[];
  on?(event: string, listener: (...args: unknown[]) => void): unknown;
  off?(event: string, listener: (...args: unknown[]) => void): unknown;
  emit?(event: string, ...args: unknown[]): boolean;
}

export interface HybridEventBusOptions {
  /** The in-process bus to delegate non-routed events to. Required. */
  legacyBus: LegacyEventBus;
  /**
   * NATS bus configuration. If omitted (or if no events are routed),
   * the NATS backend is never instantiated and `connect()` is a no-op.
   * This keeps NATS-less environments fully functional with the default
   * empty flag.
   */
  natsConfig?: NatsEventBusConfig;
  /**
   * Explicit override of the routed-events set. If provided, the env
   * var is ignored. Useful for tests and for environments that wire
   * the flag through config rather than env.
   */
  natsRoutedEventTypes?: string[];
}

/** Parse a CSV env var value into a deduplicated list of event types. */
export function parseFlagCsv(raw: string | undefined | null): string[] {
  if (!raw) return [];
  const seen = new Set<string>();
  for (const part of raw.split(',')) {
    const trimmed = part.trim();
    if (trimmed.length > 0) seen.add(trimmed);
  }
  return [...seen];
}

export class HybridEventBus implements EventBus {
  private readonly legacy: LegacyEventBus;
  private readonly nats: NatsEventBus | null;
  private readonly routed: Set<string>;
  private connected = false;

  constructor(opts: HybridEventBusOptions) {
    if (!opts.legacyBus) {
      throw new Error('HybridEventBus: legacyBus is required');
    }
    this.legacy = opts.legacyBus;

    const routedList =
      opts.natsRoutedEventTypes ??
      parseFlagCsv(process.env[BUS_BACKEND_NATS_ENV_VAR]);
    this.routed = new Set(routedList);

    // Construct the NATS bus only if we'd actually use it. This keeps
    // ALL existing behavior intact when the flag is empty (default).
    if (opts.natsConfig && this.routed.size > 0) {
      this.nats = new NatsEventBus(opts.natsConfig);
    } else {
      this.nats = null;
    }
  }

  /** Whether the given event type is configured to use NATS. */
  isNatsRouted(eventType: string): boolean {
    return this.nats !== null && this.routed.has(eventType);
  }

  /** Snapshot of the routed event types (frozen). */
  get routedEventTypes(): readonly string[] {
    return Object.freeze([...this.routed]);
  }

  /** True iff a NATS backend was instantiated. */
  get hasNatsBackend(): boolean {
    return this.nats !== null;
  }

  /** Expose the underlying NATS bus for advanced wiring (DLQ hook, stats). */
  get natsBus(): NatsEventBus | null {
    return this.nats;
  }

  /** True after a successful connect() call. */
  get isConnected(): boolean {
    return this.connected;
  }

  /**
   * Connect the NATS backend. No-op when no events are routed
   * (and the NATS bus was never instantiated). Idempotent.
   */
  async connect(): Promise<void> {
    if (this.connected) return;
    if (this.nats) await this.nats.connect();
    this.connected = true;
  }

  /** Disconnect the NATS backend. Idempotent. */
  async close(): Promise<void> {
    if (!this.connected) return;
    if (this.nats) await this.nats.close();
    this.connected = false;
  }

  /**
   * Route the publish based on the event type. NATS publishes are async;
   * legacy publishes are sync. We preserve the legacy sync return path
   * so callers that consume `event.id` immediately (e.g. the POST /events
   * route) keep working when the flag is empty.
   *
   * For NATS-routed publishes, we ALSO emit `'conductor:event'` on the
   * legacy bus's EventEmitter (when available) so in-process subscribers
   * (WS gateway, projector) stay in sync. The legacy SQLite outbox is
   * NOT written for NATS-routed events — the event is durably stored
   * in JetStream instead.
   *
   * The EventBus interface explicitly allows `Promise<ConductorEvent> | ConductorEvent`.
   */
  publish(input: PublishInput): Promise<ConductorEvent> | ConductorEvent {
    if (this.nats && this.routed.has(input.type)) {
      const natsPromise = this.nats.publish(input);
      return natsPromise.then((event) => {
        // Emit on the legacy EventEmitter so WS gateway listeners see
        // NATS-routed events too. Swallow errors — emit must never block
        // the publish path.
        try {
          if (typeof this.legacy.emit === 'function') {
            this.legacy.emit(CONDUCTOR_EMITTER_EVENT, event);
          }
        } catch { /* swallow */ }
        return event;
      });
    }
    return this.legacy.publish(input);
  }

  /**
   * Subscribe to both backends so the handler sees the unified stream.
   * Each backend only delivers events that were published on it, so the
   * handler doesn't fire twice for the same event.
   *
   * If no NATS backend exists, this degrades to a legacy-only subscription.
   */
  subscribe(typeGlob: string, handler: EventHandler): Unsubscribe {
    const u1 = this.legacy.subscribe(typeGlob, handler);
    const u2 = this.nats ? this.nats.subscribe(typeGlob, handler) : (() => {});
    return () => {
      try { u1(); } catch { /* swallow */ }
      try { u2(); } catch { /* swallow */ }
    };
  }

  /** Replay defers to the legacy SQLite-backed store. */
  replay(opts: EventQueryOpts): ConductorEvent[] {
    return this.legacy.replay(opts);
  }

  /** Forward the sender identity to the NATS bus (no-op if NATS is disabled). */
  setSender(sender: string): void {
    if (this.nats) this.nats.setSender(sender);
  }

  // ─── Node-EventEmitter passthrough ────────────────────────────────────
  // The legacy bus extends EventEmitter; the WS gateway and a few other
  // callers depend on this. We delegate so this class is a drop-in
  // replacement for `eventBus` re-exports.

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  on(event: string, listener: (...args: any[]) => void): this {
    if (typeof this.legacy.on === 'function') {
      this.legacy.on(event, listener as (...args: unknown[]) => void);
    }
    return this;
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  off(event: string, listener: (...args: any[]) => void): this {
    if (typeof this.legacy.off === 'function') {
      this.legacy.off(event, listener as (...args: unknown[]) => void);
    }
    return this;
  }

  emit(event: string, ...args: unknown[]): boolean {
    if (typeof this.legacy.emit === 'function') {
      return this.legacy.emit(event, ...args);
    }
    return false;
  }
}
