/**
 * The Phase-1 reactive fast-path consumer.
 *
 * Polls the mentor-event-bus events.sqlite for new `OperatorCorrection`
 * events. For each new event:
 *
 *   1. Skip if already in the offset-store (idempotency guard).
 *   2. Parse + validate payload (schema-failed events are still
 *      classified — the operator's text is the source of truth even when
 *      the schema fields are off).
 *   3. Run `classifyCorrection` against the payload's correctionText.
 *   4. Persist to the offset-store with the classification.
 *   5. Invoke the `onClassified` callback (default: console.log a
 *      one-line summary). Future PRs replace the callback with a
 *      synthesizer + memory-writer chain.
 *
 * Phase-1 deliberately does NOT auto-write memory files. That's a
 * future PR after the synthesizer + low-risk-classification gating land.
 *
 * Subscriber → producer separation: this module READS the event-bus DB
 * but never writes to it. The event-bus owns its own DB; we own the
 * separate offset-store DB.
 *
 * Trust boundary: dbPath / offsetDbPath come from the consumer caller
 * (production usage threads them from CLI flag / env). All SQL in this
 * module is parameterised; no untrusted input reaches a query string.
 */

import Database from 'better-sqlite3';
import type { Database as DatabaseInstance } from 'better-sqlite3';

import { classifyCorrection } from './classifier.js';
import {
  countProcessed,
  getLastProcessedOffset,
  isProcessed,
  openOffsetDb,
  recordProcessed
} from './offset-store.js';
import type {
  ClassificationResult,
  EventRow,
  OperatorCorrectionInput,
  ProcessedRecord
} from './types.js';

/** The single event_type we react to in Phase 1. */
export const EVENT_TYPE = 'OperatorCorrection';

/** Default poll interval: 10s. Operator-correction → action ≤ 1 min target. */
export const DEFAULT_POLL_INTERVAL_MS = 10_000;

/** Default batch size when reading new events. */
export const DEFAULT_BATCH_SIZE = 100;

export interface ConsumerOptions {
  /** Path to the mentor-event-bus events.sqlite. Read-only access. */
  eventsDbPath: string;
  /**
   * Path to the consumer's own offset-store sqlite. Created if missing.
   * Defaults to `${eventsDbPath}.fastpath-offset.sqlite`.
   */
  offsetDbPath?: string;
  /** Poll interval in ms. Default 10s. */
  pollIntervalMs?: number;
  /** How many events to read per poll. Default 100. */
  batchSize?: number;
  /**
   * Optional callback invoked after each classification. Default logs a
   * one-line summary to stdout. Future PRs supply a synthesizer.
   */
  onClassified?: (
    event: EventRow,
    payload: OperatorCorrectionInput,
    result: ClassificationResult
  ) => Promise<string | undefined> | string | undefined;
  /** AbortSignal for graceful shutdown. */
  abortSignal?: AbortSignal;
  /** Logger. Default: console. */
  logger?: { info: (m: string) => void; warn: (m: string) => void };
  /**
   * Override the sleep function. Test injection — production sleeps via
   * setTimeout.
   */
  sleepFn?: (ms: number) => Promise<void>;
}

const consoleLogger = {
  info: (m: string): void => console.log(m),
  warn: (m: string): void => console.warn(m)
};

const defaultSleep = (ms: number): Promise<void> =>
  new Promise<void>((resolve) => setTimeout(resolve, ms));

/**
 * Run the long-running poll loop. Resolves when `abortSignal` fires.
 *
 * Each iteration:
 *   1. Read `getLastProcessedOffset()` from the offset DB.
 *   2. Query events.sqlite for the next `batchSize` events of type
 *      `OperatorCorrection` with `ingest_offset > lastOffset`.
 *   3. For each new event: classify + persist + onClassified.
 *
 * Errors inside `onClassified` are caught + logged; the consumer keeps
 * advancing so a single bad payload doesn't wedge the pipeline.
 */
export async function runConsumer(opts: ConsumerOptions): Promise<void> {
  const eventsDb = new Database(opts.eventsDbPath, { readonly: true });
  // WAL mode requires open in r/w; the bus opens with WAL = the readers
  // can read the WAL even though we open read-only.
  const offsetDbPath =
    opts.offsetDbPath ?? `${opts.eventsDbPath}.fastpath-offset.sqlite`;
  const offsetDb = openOffsetDb(offsetDbPath);
  const pollIntervalMs = opts.pollIntervalMs ?? DEFAULT_POLL_INTERVAL_MS;
  const batchSize = opts.batchSize ?? DEFAULT_BATCH_SIZE;
  const onClassified =
    opts.onClassified ??
    ((ev, _payload, res): string | undefined => {
      const logger = opts.logger ?? consoleLogger;
      logger.info(
        `[mentor-fastpath] classified event ${ev.id} as ${res.primary} (sev=${res.severity}, conf=${res.confidence})`
      );
      return undefined;
    });
  const logger = opts.logger ?? consoleLogger;
  const sleep = opts.sleepFn ?? defaultSleep;

  logger.info(
    `[mentor-fastpath] starting consumer; eventsDb=${opts.eventsDbPath} offsetDb=${offsetDbPath} pollIntervalMs=${pollIntervalMs}`
  );
  logger.info(
    `[mentor-fastpath] resuming at offset ${getLastProcessedOffset(offsetDb)} (${countProcessed(offsetDb)} events processed previously)`
  );

  try {
    while (!(opts.abortSignal?.aborted ?? false)) {
      try {
        await processBatch(eventsDb, offsetDb, batchSize, onClassified, logger);
      } catch (e) {
        logger.warn(
          `[mentor-fastpath] iteration threw (will retry): ${String(e)}`
        );
      }
      await sleep(pollIntervalMs);
    }
  } finally {
    eventsDb.close();
    offsetDb.close();
    logger.info('[mentor-fastpath] consumer stopped');
  }
}

/**
 * One iteration of the poll loop. Exposed for tests + manual invocation
 * via `processOnce` below. Reads the next `batchSize` events past the
 * stored offset, classifies each, and persists results.
 *
 * Returns the number of events processed in this batch.
 */
export async function processBatch(
  eventsDb: DatabaseInstance,
  offsetDb: DatabaseInstance,
  batchSize: number,
  onClassified: NonNullable<ConsumerOptions['onClassified']>,
  logger: { info: (m: string) => void; warn: (m: string) => void }
): Promise<number> {
  const lastOffset = getLastProcessedOffset(offsetDb);
  const rows = eventsDb
    .prepare(
      `SELECT id, event_type, schema_version, correlation_id, parent_event_id,
              emitted_at, hostname, process_name, payload_json,
              validation_failed, ingest_offset
         FROM events
        WHERE event_type = @eventType
          AND ingest_offset > @lastOffset
        ORDER BY ingest_offset ASC
        LIMIT @batchSize`
    )
    .all({
      eventType: EVENT_TYPE,
      lastOffset,
      batchSize
    }) as EventRow[];

  let processed = 0;
  for (const row of rows) {
    if (isProcessed(offsetDb, row.id)) continue;

    let payload: OperatorCorrectionInput;
    try {
      payload = JSON.parse(row.payload_json) as OperatorCorrectionInput;
    } catch (e) {
      // Schema validation failed at producer time but we still want to
      // record what we tried — the operator may have hand-written the
      // payload and meant something close-to-valid. Use empty text.
      logger.warn(
        `[mentor-fastpath] event ${row.id} payload_json unparseable (${String(e)}); falling back to empty payload`
      );
      payload = { correctionText: row.payload_json };
    }

    const result = classifyCorrection(payload);

    let artifactRef: string | undefined;
    try {
      const ret = await onClassified(row, payload, result);
      artifactRef = typeof ret === 'string' ? ret : undefined;
    } catch (e) {
      logger.warn(
        `[mentor-fastpath] onClassified threw on event ${row.id} (continuing): ${String(e)}`
      );
    }

    const rec: ProcessedRecord = {
      event_id: row.id,
      ingest_offset: row.ingest_offset,
      processed_at: new Date().toISOString(),
      classification_json: JSON.stringify(result),
      artifact_ref: artifactRef ?? null
    };
    recordProcessed(offsetDb, rec);
    processed++;
  }
  return processed;
}

/**
 * Run a single iteration synchronously — for one-shot CLI invocation
 * (e.g. `caia-mentor-fastpath process-once`) or tests.
 *
 * Opens both DBs, runs `processBatch` once, closes them. Returns the
 * count of newly-processed events.
 */
export async function processOnce(
  opts: Omit<ConsumerOptions, 'pollIntervalMs' | 'abortSignal'>
): Promise<number> {
  const eventsDb = new Database(opts.eventsDbPath, { readonly: true });
  const offsetDbPath =
    opts.offsetDbPath ?? `${opts.eventsDbPath}.fastpath-offset.sqlite`;
  const offsetDb = openOffsetDb(offsetDbPath);
  const batchSize = opts.batchSize ?? DEFAULT_BATCH_SIZE;
  const logger = opts.logger ?? consoleLogger;
  const onClassified =
    opts.onClassified ??
    ((ev, _payload, res): string | undefined => {
      logger.info(
        `[mentor-fastpath] classified event ${ev.id} as ${res.primary} (sev=${res.severity}, conf=${res.confidence})`
      );
      return undefined;
    });
  try {
    return await processBatch(
      eventsDb,
      offsetDb,
      batchSize,
      onClassified,
      logger
    );
  } finally {
    eventsDb.close();
    offsetDb.close();
  }
}
