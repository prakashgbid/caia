/**
 * Integration tests for the consumer (`processBatch` / `processOnce`).
 *
 * Uses real SQLite (via better-sqlite3) with file-mode tmp DBs to mirror
 * production behavior. Each test creates a fresh events.sqlite + offset
 * DB so there's no test-order coupling.
 *
 * We construct the events.sqlite by hand (matching the
 * mentor-event-bus's 0001_init.sql shape) rather than depending on the
 * mentor-event-bus package directly — this keeps the test suite fast +
 * the package boundary clean.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import Database from 'better-sqlite3';
import type { Database as DatabaseInstance } from 'better-sqlite3';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import {
  processBatch,
  processOnce
} from '../src/consumer.js';
import {
  countProcessed,
  getLastProcessedOffset,
  isProcessed,
  openOffsetDb
} from '../src/offset-store.js';
import type { ClassificationResult, EventRow, OperatorCorrectionInput } from '../src/types.js';

let tmp: string;
let eventsDbPath: string;
let offsetDbPath: string;

beforeEach(() => {
  tmp = mkdtempSync(join(tmpdir(), 'mentor-fastpath-test-'));
  eventsDbPath = join(tmp, 'events.sqlite');
  offsetDbPath = join(tmp, 'offset.sqlite');
});

afterEach(() => {
  rmSync(tmp, { recursive: true, force: true });
});

/** Build a minimal events.sqlite + insert N OperatorCorrection events. */
function seedEventsDb(rows: Array<Partial<EventRow> & Pick<EventRow, 'id' | 'event_type' | 'payload_json'>>): void {
  const db = new Database(eventsDbPath);
  db.pragma('journal_mode = WAL');
  db.exec(`
    CREATE TABLE events (
      id              TEXT PRIMARY KEY,
      event_type      TEXT NOT NULL,
      schema_version  INTEGER NOT NULL DEFAULT 1,
      correlation_id  TEXT,
      parent_event_id TEXT,
      emitted_at      TEXT NOT NULL,
      hostname        TEXT NOT NULL,
      process_name    TEXT,
      payload_json    TEXT NOT NULL,
      validation_failed INTEGER NOT NULL DEFAULT 0,
      ingest_offset   INTEGER NOT NULL UNIQUE
    );
    CREATE INDEX idx_events_type_off ON events(event_type, ingest_offset);
  `);
  let off = 1;
  const insert = db.prepare(`
    INSERT INTO events (id, event_type, schema_version, correlation_id, parent_event_id,
                        emitted_at, hostname, process_name, payload_json,
                        validation_failed, ingest_offset)
    VALUES (@id, @event_type, @schema_version, @correlation_id, @parent_event_id,
            @emitted_at, @hostname, @process_name, @payload_json,
            @validation_failed, @ingest_offset)
  `);
  for (const r of rows) {
    insert.run({
      id: r.id,
      event_type: r.event_type,
      schema_version: r.schema_version ?? 1,
      correlation_id: r.correlation_id ?? null,
      parent_event_id: r.parent_event_id ?? null,
      emitted_at: r.emitted_at ?? new Date().toISOString(),
      hostname: r.hostname ?? 'test-host',
      process_name: r.process_name ?? null,
      payload_json: r.payload_json,
      validation_failed: r.validation_failed ?? 0,
      ingest_offset: r.ingest_offset ?? off++
    });
  }
  db.close();
}

/** A no-op classifier callback that records calls. */
function makeRecorder(): {
  callback: (
    event: EventRow,
    payload: OperatorCorrectionInput,
    result: ClassificationResult
  ) => string | undefined;
  calls: Array<{ id: string; primary: string }>;
} {
  const calls: Array<{ id: string; primary: string }> = [];
  return {
    callback: (event, _payload, result) => {
      calls.push({ id: event.id, primary: result.primary });
      return `artifact_${event.id}`;
    },
    calls
  };
}

const silentLogger = {
  info: (): void => undefined,
  warn: (): void => undefined
};

describe('processBatch', () => {
  it('processes new events and skips already-processed', async () => {
    seedEventsDb([
      {
        id: 'ev1',
        event_type: 'OperatorCorrection',
        payload_json: JSON.stringify({
          correctionText: 'we already decided this',
          detectionMode: 'manual'
        }),
        ingest_offset: 1
      },
      {
        id: 'ev2',
        event_type: 'OperatorCorrection',
        payload_json: JSON.stringify({
          correctionText: 'use the MCP instead',
          detectionMode: 'manual'
        }),
        ingest_offset: 2
      }
    ]);

    const eventsDb: DatabaseInstance = new Database(eventsDbPath, { readonly: true });
    const offsetDb = openOffsetDb(offsetDbPath);
    const recorder = makeRecorder();

    const n = await processBatch(eventsDb, offsetDb, 100, recorder.callback, silentLogger);
    expect(n).toBe(2);
    expect(recorder.calls).toEqual([
      { id: 'ev1', primary: 'ReLitigation' },
      { id: 'ev2', primary: 'ToolMisuse' }
    ]);
    expect(isProcessed(offsetDb, 'ev1')).toBe(true);
    expect(isProcessed(offsetDb, 'ev2')).toBe(true);
    expect(getLastProcessedOffset(offsetDb)).toBe(2);

    // Re-run: nothing new, count stays at 2
    const n2 = await processBatch(eventsDb, offsetDb, 100, recorder.callback, silentLogger);
    expect(n2).toBe(0);
    expect(recorder.calls.length).toBe(2);

    eventsDb.close();
    offsetDb.close();
  });

  it('ignores events of other types', async () => {
    seedEventsDb([
      {
        id: 'ev_pr',
        event_type: 'PRMerged',
        payload_json: JSON.stringify({ prNumber: 1, sha: 'a'.repeat(40), branch: 'develop' }),
        ingest_offset: 1
      },
      {
        id: 'ev_correction',
        event_type: 'OperatorCorrection',
        payload_json: JSON.stringify({ correctionText: 'stop asking', detectionMode: 'manual' }),
        ingest_offset: 2
      }
    ]);

    const eventsDb = new Database(eventsDbPath, { readonly: true });
    const offsetDb = openOffsetDb(offsetDbPath);
    const recorder = makeRecorder();
    const n = await processBatch(eventsDb, offsetDb, 100, recorder.callback, silentLogger);
    expect(n).toBe(1);
    expect(recorder.calls).toEqual([
      { id: 'ev_correction', primary: 'DecisionClassifierViolation' }
    ]);
    eventsDb.close();
    offsetDb.close();
  });

  it('respects batchSize', async () => {
    seedEventsDb(
      Array.from({ length: 5 }, (_, i) => ({
        id: `ev${i}`,
        event_type: 'OperatorCorrection',
        payload_json: JSON.stringify({ correctionText: 'stop asking', detectionMode: 'manual' }),
        ingest_offset: i + 1
      }))
    );
    const eventsDb = new Database(eventsDbPath, { readonly: true });
    const offsetDb = openOffsetDb(offsetDbPath);
    const recorder = makeRecorder();

    const n1 = await processBatch(eventsDb, offsetDb, 2, recorder.callback, silentLogger);
    expect(n1).toBe(2);
    const n2 = await processBatch(eventsDb, offsetDb, 2, recorder.callback, silentLogger);
    expect(n2).toBe(2);
    const n3 = await processBatch(eventsDb, offsetDb, 2, recorder.callback, silentLogger);
    expect(n3).toBe(1);

    eventsDb.close();
    offsetDb.close();
  });

  it('continues past unparseable payload_json by classifying the raw string', async () => {
    seedEventsDb([
      {
        id: 'ev_bad',
        event_type: 'OperatorCorrection',
        payload_json: 'not valid json',
        validation_failed: 1,
        ingest_offset: 1
      },
      {
        id: 'ev_good',
        event_type: 'OperatorCorrection',
        payload_json: JSON.stringify({ correctionText: 'stop asking', detectionMode: 'manual' }),
        ingest_offset: 2
      }
    ]);

    const eventsDb = new Database(eventsDbPath, { readonly: true });
    const offsetDb = openOffsetDb(offsetDbPath);
    const recorder = makeRecorder();
    const n = await processBatch(eventsDb, offsetDb, 100, recorder.callback, silentLogger);
    expect(n).toBe(2);
    expect(recorder.calls.find((c) => c.id === 'ev_bad')?.primary).toBe('Unclassified');
    expect(recorder.calls.find((c) => c.id === 'ev_good')?.primary).toBe(
      'DecisionClassifierViolation'
    );
    eventsDb.close();
    offsetDb.close();
  });

  it('continues even when onClassified throws', async () => {
    seedEventsDb([
      {
        id: 'ev1',
        event_type: 'OperatorCorrection',
        payload_json: JSON.stringify({ correctionText: 'stop asking' }),
        ingest_offset: 1
      },
      {
        id: 'ev2',
        event_type: 'OperatorCorrection',
        payload_json: JSON.stringify({ correctionText: 'use MCP instead' }),
        ingest_offset: 2
      }
    ]);

    const eventsDb = new Database(eventsDbPath, { readonly: true });
    const offsetDb = openOffsetDb(offsetDbPath);
    const calls: string[] = [];
    const onClassified = (ev: EventRow): string => {
      calls.push(ev.id);
      if (ev.id === 'ev1') throw new Error('intentional');
      return `art_${ev.id}`;
    };
    const n = await processBatch(eventsDb, offsetDb, 100, onClassified, silentLogger);
    expect(n).toBe(2);
    // Both events still get persisted in offset-store so we don't reprocess
    expect(isProcessed(offsetDb, 'ev1')).toBe(true);
    expect(isProcessed(offsetDb, 'ev2')).toBe(true);
    eventsDb.close();
    offsetDb.close();
  });

  it('persists artifact_ref returned by onClassified', async () => {
    seedEventsDb([
      {
        id: 'ev1',
        event_type: 'OperatorCorrection',
        payload_json: JSON.stringify({ correctionText: 'stop asking' }),
        ingest_offset: 1
      }
    ]);
    const eventsDb = new Database(eventsDbPath, { readonly: true });
    const offsetDb = openOffsetDb(offsetDbPath);
    const onClassified = (ev: EventRow): string => `art_${ev.id}`;
    await processBatch(eventsDb, offsetDb, 100, onClassified, silentLogger);
    const row = offsetDb
      .prepare('SELECT artifact_ref FROM processed_events WHERE event_id = ?')
      .get('ev1') as { artifact_ref: string } | undefined;
    expect(row?.artifact_ref).toBe('art_ev1');
    eventsDb.close();
    offsetDb.close();
  });
});

describe('processOnce', () => {
  it('opens DBs, processes one batch, and closes them', async () => {
    seedEventsDb([
      {
        id: 'ev1',
        event_type: 'OperatorCorrection',
        payload_json: JSON.stringify({ correctionText: 'stop asking' }),
        ingest_offset: 1
      }
    ]);
    const recorder = makeRecorder();
    const n = await processOnce({
      eventsDbPath,
      offsetDbPath,
      onClassified: recorder.callback,
      logger: silentLogger
    });
    expect(n).toBe(1);
    expect(recorder.calls.length).toBe(1);

    // Check the offset-store survives the close — re-open and read.
    const reopened = openOffsetDb(offsetDbPath);
    expect(countProcessed(reopened)).toBe(1);
    expect(getLastProcessedOffset(reopened)).toBe(1);
    reopened.close();
  });

  it('returns 0 when there are no new events', async () => {
    seedEventsDb([]);
    const n = await processOnce({
      eventsDbPath,
      offsetDbPath,
      logger: silentLogger
    });
    expect(n).toBe(0);
  });
});

describe('offset-store integration', () => {
  it('survives process restart by resuming from last_offset', async () => {
    seedEventsDb([
      {
        id: 'ev1',
        event_type: 'OperatorCorrection',
        payload_json: JSON.stringify({ correctionText: 'stop asking' }),
        ingest_offset: 1
      },
      {
        id: 'ev2',
        event_type: 'OperatorCorrection',
        payload_json: JSON.stringify({ correctionText: 'use MCP' }),
        ingest_offset: 2
      }
    ]);

    const r1 = makeRecorder();
    const n1 = await processOnce({
      eventsDbPath,
      offsetDbPath,
      batchSize: 1, // process only 1, leave ev2 for "next restart"
      onClassified: r1.callback,
      logger: silentLogger
    });
    expect(n1).toBe(1);
    expect(r1.calls.map((c) => c.id)).toEqual(['ev1']);

    // Simulate restart by calling processOnce again
    const r2 = makeRecorder();
    const n2 = await processOnce({
      eventsDbPath,
      offsetDbPath,
      onClassified: r2.callback,
      logger: silentLogger
    });
    expect(n2).toBe(1);
    expect(r2.calls.map((c) => c.id)).toEqual(['ev2']);
  });
});
