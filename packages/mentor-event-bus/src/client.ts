/**
 * Mentor event-bus client — local SQLite-direct emit + query.
 *
 * Public API surface:
 *   - new Client({ dbPath, ... })
 *   - emit(type, payload, opts?)        — fire-and-forget; never throws
 *   - getRecent(opts?)                  — query persisted events
 *   - close()                           — close the underlying DB
 *
 * Phase 0 invariant (per design doc): producer code is NEVER blocked by
 * Mentor's reliability. emit() catches every error path and falls through
 * to console.warn — it does not throw. Validation failures persist the
 * event with `validation_failed = 1` so Mentor can detect schema drift.
 *
 * The cross-machine HTTP path lives in PR-β (`http-client.ts`).
 */

import { hostname as osHostname } from 'node:os';
import { customAlphabet } from 'nanoid';
import type { Database as DatabaseInstance } from 'better-sqlite3';

import {
  countEvents,
  insertEvent,
  openDatabase,
  queryEvents,
  registerSchemaDefinition,
  type QueryEventsOptions
} from './sqlite.js';
import { describeSchema, EVENT_SCHEMAS, validatePayload } from './schemas.js';
import {
  EVENT_TYPES,
  type EmittedEvent,
  type EventRow,
  type EventType,
  type PayloadOf
} from './types.js';
import { currentCorrelationId, currentParentEventId } from './correlation.js';

// ─── ID generator ─────────────────────────────────────────────────────────

// 16 chars over [0-9a-z] gives ~10^25 possible IDs — collision-free at our scale.
const makeId = customAlphabet('0123456789abcdefghijklmnopqrstuvwxyz', 16);

function newEventId(): string {
  return `ev_${Date.now().toString(36)}_${makeId()}`;
}

// ─── Client ───────────────────────────────────────────────────────────────

export interface ClientOptions {
  /** Absolute path to the SQLite file, or `:memory:` for tests. */
  dbPath: string;
  /** Override migrations dir (default: package's migrations/). */
  migrationsDir?: string;
  /** Hostname to record on emitted events. Default: os.hostname(). */
  hostname?: string;
  /** Process name (e.g., 'orchestrator', 'worker-coding'). */
  processName?: string;
  /** Logger for non-throwing warnings. Default: console. */
  logger?: { warn: (m: string, ctx?: unknown) => void };
  /** Disable WAL (use only for tests with `:memory:`). */
  disableWal?: boolean;
  /** Skip schema_definitions registration (tests). Default false. */
  skipSchemaRegistration?: boolean;
}

export interface EmitOptions {
  /** Override the inherited correlation_id. */
  correlationId?: string;
  /** Override the inherited parent_event_id. */
  parentEventId?: string;
  /** Override schema_version (for explicit version pinning). */
  schemaVersion?: number;
  /** Override emitted_at (default: now). Useful for tests. */
  emittedAt?: Date;
}

const consoleLogger = {
  warn: (m: string, ctx?: unknown): void => {
    if (ctx !== undefined) console.warn(m, ctx);
    else console.warn(m);
  }
};

/**
 * The main client. Creates / opens the SQLite file, registers schemas, and
 * exposes emit() + getRecent().
 */
export class Client {
  private readonly db: DatabaseInstance;
  private readonly hostname: string;
  private readonly processName: string | null;
  private readonly logger: { warn: (m: string, ctx?: unknown) => void };
  private closed = false;

  constructor(opts: ClientOptions) {
    this.db = openDatabase(opts.dbPath, opts.migrationsDir, !opts.disableWal);
    this.hostname = opts.hostname ?? osHostname();
    this.processName = opts.processName ?? null;
    this.logger = opts.logger ?? consoleLogger;

    if (!opts.skipSchemaRegistration) {
      this.registerAllSchemas();
    }
  }

  /**
   * Persist a Zod-schema fingerprint for every known EventType. Idempotent.
   */
  private registerAllSchemas(): void {
    for (const t of EVENT_TYPES) {
      const schema = EVENT_SCHEMAS[t];
      const desc = describeSchema(schema);
      registerSchemaDefinition(this.db, {
        event_type: t,
        schema_version: 1,
        zod_schema: desc
      });
    }
  }

  /**
   * Emit an event. Type + payload are validated against the Zod schema.
   * Validation failures are persisted with `validation_failed = 1` rather
   * than thrown, preserving the producer-non-blocking invariant.
   *
   * Returns the assigned event id, or null if the underlying DB write
   * threw (in which case a warning is logged).
   */
  emit<T extends EventType>(type: T, payload: PayloadOf<T>, opts: EmitOptions = {}): string | null {
    if (this.closed) {
      this.logger.warn(`[mentor-event-bus] emit on closed client: type=${type}`);
      return null;
    }

    let validation_failed: 0 | 1 = 0;
    const validation = validatePayload(type, payload);
    if (!validation.ok) {
      validation_failed = 1;
      this.logger.warn(`[mentor-event-bus] schema validation failed for ${type}`, validation.error.issues);
    }

    const id = newEventId();
    const correlation_id =
      opts.correlationId ?? currentCorrelationId() ?? null;
    const parent_event_id =
      opts.parentEventId ?? currentParentEventId() ?? null;
    const emitted_at = (opts.emittedAt ?? new Date()).toISOString();
    const schema_version = opts.schemaVersion ?? 1;

    let payload_json: string;
    try {
      payload_json = JSON.stringify(payload);
    } catch (e) {
      this.logger.warn(`[mentor-event-bus] payload JSON.stringify failed for ${type}`, e);
      return null;
    }

    try {
      insertEvent(this.db, {
        id,
        event_type: type,
        schema_version,
        correlation_id,
        parent_event_id,
        emitted_at,
        hostname: this.hostname,
        process_name: this.processName,
        payload_json,
        validation_failed
      });
      return id;
    } catch (e) {
      this.logger.warn(`[mentor-event-bus] DB insert failed for ${type}`, e);
      return null;
    }
  }

  /**
   * Query persisted events.
   */
  getRecent(opts: QueryEventsOptions = {}): EmittedEvent[] {
    const rows = queryEvents(this.db, { order: 'desc', limit: 100, ...opts });
    return rows.map(decodeRow);
  }

  /**
   * Count persisted events matching the query.
   */
  count(opts: QueryEventsOptions = {}): number {
    return countEvents(this.db, opts);
  }

  /**
   * Close the underlying DB. Safe to call multiple times.
   */
  close(): void {
    if (this.closed) return;
    this.closed = true;
    try {
      this.db.close();
    } catch (e) {
      this.logger.warn('[mentor-event-bus] db close failed', e);
    }
  }

  /** Test/debug helper — exposes the raw DB. NOT part of the stable API. */
  unsafeGetDb(): DatabaseInstance {
    return this.db;
  }
}

function decodeRow(row: EventRow): EmittedEvent {
  let payload: unknown;
  try {
    payload = JSON.parse(row.payload_json);
  } catch {
    payload = null;
  }
  return {
    id: row.id,
    type: row.event_type,
    schemaVersion: row.schema_version,
    correlationId: row.correlation_id,
    parentEventId: row.parent_event_id,
    emittedAt: row.emitted_at,
    hostname: row.hostname,
    processName: row.process_name,
    payload,
    validationFailed: row.validation_failed === 1,
    ingestOffset: row.ingest_offset
  };
}
