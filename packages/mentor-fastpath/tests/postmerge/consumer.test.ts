/**
 * Unit + integration tests for the postmerge consumer.
 *
 * Strategy:
 *   - In-memory mentor-event-bus Client to seed events.
 *   - Tmpdir for proposal output.
 *   - Drive `processPostMergeOnce` / `processPostMergeBatch` directly to
 *     avoid sleep loops. The long-running runPostMergeConsumer is
 *     covered by exercising its tick body (processPostMergeBatch).
 */

import Database from 'better-sqlite3';
import { mkdtempSync, readdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { Client } from '@chiefaia/mentor-event-bus';

import {
  processPostMergeBatch,
  processPostMergeOnce
} from '../../src/postmerge/consumer.js';
import { openOffsetDb } from '../../src/offset-store.js';

let tmp: string;
let busDbPath: string;
let offsetDbPath: string;
let memoryDir: string;

beforeEach(() => {
  tmp = mkdtempSync(join(tmpdir(), 'mentor-pm-consumer-'));
  busDbPath = join(tmp, 'events.sqlite');
  offsetDbPath = join(tmp, 'offset.sqlite');
  memoryDir = join(tmp, 'memory');
});

afterEach(() => {
  rmSync(tmp, { recursive: true, force: true });
});

function seedBus(events: Array<{ type: string; payload: unknown }>): void {
  const client = new Client({
    dbPath: busDbPath,
    processName: 'test-seeder'
  });
  for (const e of events) {
    // The Client only allows known EventType strings; we use the typed cast.
    const id = client.emit(
      e.type as Parameters<Client['emit']>[0],
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      e.payload as any
    );
    if (id === null) throw new Error(`failed to emit ${e.type}`);
  }
  client.close();
}

describe('processPostMergeBatch', () => {
  it('writes a regression-after-merge proposal for a RegressionDetected event', () => {
    seedBus([
      {
        type: 'RegressionDetected',
        payload: {
          testName: 'integration-tests',
          failedSha: 'ea23ab0'
        }
      }
    ]);

    const eventsDb = new Database(busDbPath, { readonly: true });
    const offsetDb = openOffsetDb(offsetDbPath);
    const stats = processPostMergeBatch(
      eventsDb,
      offsetDb,
      100,
      memoryDir,
      { info: () => undefined, warn: () => undefined },
      () => new Date('2026-05-05T16:00:00Z')
    );
    eventsDb.close();
    offsetDb.close();

    expect(stats.processed).toBe(1);
    expect(stats.written).toBe(1);
    expect(stats.skipped).toBe(0);

    // A proposal file was written.
    const propDir = join(memoryDir, 'proposals');
    const files = readdirSync(propDir);
    expect(files.length).toBe(1);
    expect(files[0]).toMatch(/prematurecompletion/i);
  });

  it('writes an evidence-gate-failed proposal for an EvidenceGateFailure event', () => {
    seedBus([
      {
        type: 'EvidenceGateFailure',
        payload: { prNumber: 311, failedJobs: ['lint', 'typecheck'] }
      }
    ]);

    const eventsDb = new Database(busDbPath, { readonly: true });
    const offsetDb = openOffsetDb(offsetDbPath);
    const stats = processPostMergeBatch(
      eventsDb,
      offsetDb,
      100,
      memoryDir,
      { info: () => undefined, warn: () => undefined },
      () => new Date('2026-05-05T16:00:00Z')
    );
    eventsDb.close();
    offsetDb.close();

    expect(stats.processed).toBe(1);
    expect(stats.written).toBe(1);

    const files = readdirSync(join(memoryDir, 'proposals'));
    expect(files[0]).toMatch(/incompleteness/i);
  });

  it('skips PRMerged-only events without writing a proposal', () => {
    seedBus([
      {
        type: 'PRMerged',
        payload: {
          prNumber: 327,
          sha: 'ea23ab0',
          branch: 'develop',
          author: 'campaign-coordinator'
        }
      }
    ]);

    const eventsDb = new Database(busDbPath, { readonly: true });
    const offsetDb = openOffsetDb(offsetDbPath);
    const stats = processPostMergeBatch(
      eventsDb,
      offsetDb,
      100,
      memoryDir,
      { info: () => undefined, warn: () => undefined },
      () => new Date('2026-05-05T16:00:00Z')
    );
    eventsDb.close();
    offsetDb.close();

    expect(stats.processed).toBe(1);
    expect(stats.written).toBe(0);
    expect(stats.skipped).toBe(1);
  });

  it('idempotent — second call processes 0 new events', async () => {
    seedBus([
      {
        type: 'RegressionDetected',
        payload: { testName: 'unit-tests', failedSha: 'aaa' }
      }
    ]);

    const stats1 = await processPostMergeOnce({
      eventsDbPath: busDbPath,
      offsetDbPath,
      memoryDir,
      now: () => new Date('2026-05-05T16:00:00Z')
    });
    expect(stats1.processed).toBe(1);
    expect(stats1.written).toBe(1);

    const stats2 = await processPostMergeOnce({
      eventsDbPath: busDbPath,
      offsetDbPath,
      memoryDir,
      now: () => new Date('2026-05-05T16:00:00Z')
    });
    expect(stats2.processed).toBe(0);
    expect(stats2.written).toBe(0);
  });

  it('processes mixed event types in a single batch', () => {
    seedBus([
      {
        type: 'PRMerged',
        payload: {
          prNumber: 1,
          sha: 'aaa',
          branch: 'develop'
        }
      },
      {
        type: 'EvidenceGateFailure',
        payload: { prNumber: 2, failedJobs: ['lint'] }
      },
      {
        type: 'RegressionDetected',
        payload: { testName: 'e2e', failedSha: 'bbb' }
      }
    ]);

    const eventsDb = new Database(busDbPath, { readonly: true });
    const offsetDb = openOffsetDb(offsetDbPath);
    const stats = processPostMergeBatch(
      eventsDb,
      offsetDb,
      100,
      memoryDir,
      { info: () => undefined, warn: () => undefined },
      () => new Date('2026-05-05T16:00:00Z')
    );
    eventsDb.close();
    offsetDb.close();

    expect(stats.processed).toBe(3);
    expect(stats.written).toBe(2); // PRMerged-only is skipped
    expect(stats.skipped).toBe(1);
    const files = readdirSync(join(memoryDir, 'proposals'));
    expect(files).toHaveLength(2);
  });

  it('skips events with unparseable payload but still advances offset', () => {
    // Force a broken payload by mutating an emitted event row in-place.
    seedBus([
      {
        type: 'RegressionDetected',
        payload: { testName: 'real', failedSha: 'aaa' }
      }
    ]);
    const writableDb = new Database(busDbPath);
    writableDb
      .prepare(
        `INSERT INTO events (id, event_type, schema_version, correlation_id,
                             parent_event_id, emitted_at, hostname,
                             process_name, payload_json, validation_failed,
                             ingest_offset)
         VALUES ('ev_broken', 'RegressionDetected', 1, NULL, NULL,
                 '2026-05-05T16:00:00.000Z', 'test', 'test',
                 'not-json{{{', 1, 999999)`
      )
      .run();
    writableDb.close();

    const eventsDb = new Database(busDbPath, { readonly: true });
    const offsetDb = openOffsetDb(offsetDbPath);
    const stats = processPostMergeBatch(
      eventsDb,
      offsetDb,
      100,
      memoryDir,
      { info: () => undefined, warn: () => undefined },
      () => new Date('2026-05-05T16:00:00Z')
    );
    eventsDb.close();
    offsetDb.close();

    expect(stats.processed).toBe(2);
    expect(stats.written).toBe(1);
    expect(stats.skipped).toBe(1);
  });
});

describe('processPostMergeOnce', () => {
  it('opens + closes its own DBs', async () => {
    seedBus([
      {
        type: 'RegressionDetected',
        payload: { testName: 'unit', failedSha: 'aaa' }
      }
    ]);
    const stats = await processPostMergeOnce({
      eventsDbPath: busDbPath,
      offsetDbPath,
      memoryDir,
      now: () => new Date('2026-05-05T16:00:00Z')
    });
    expect(stats.processed).toBe(1);
    expect(stats.written).toBe(1);
  });
});
