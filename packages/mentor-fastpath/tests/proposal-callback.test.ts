/**
 * Integration tests for the proposal-callback factory and its
 * end-to-end use through the consumer's processBatch.
 *
 * Verifies the full reactive loop in-memory:
 *   OperatorCorrection event in events.sqlite
 *     → processBatch reads it
 *     → classifyCorrection categorizes it
 *     → makeProposalCallback synthesizes + writes a proposal markdown
 *     → offset-store records the proposal path as artifact_ref
 *
 * No real DBs from outside the tmpdir are touched.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import Database from 'better-sqlite3';
import {
  existsSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { processOnce } from '../src/consumer.js';
import { makeProposalCallback } from '../src/proposal-callback.js';
import { listProposals, PROPOSALS_SUBDIR } from '../src/memory-writer.js';
import type { ClassificationResult, EventRow, OperatorCorrectionInput } from '../src/types.js';

let tmp: string;
let eventsDbPath: string;
let offsetDbPath: string;
let memoryDir: string;

beforeEach(() => {
  tmp = mkdtempSync(join(tmpdir(), 'mentor-pcb-'));
  eventsDbPath = join(tmp, 'events.sqlite');
  offsetDbPath = join(tmp, 'offset.sqlite');
  memoryDir = join(tmp, 'memory');
});

afterEach(() => {
  rmSync(tmp, { recursive: true, force: true });
});

function seedEvent(
  id: string,
  ingestOffset: number,
  payload: OperatorCorrectionInput
): void {
  const db = new Database(eventsDbPath);
  db.pragma('journal_mode = WAL');
  db.exec(`
    CREATE TABLE IF NOT EXISTS events (
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
    CREATE INDEX IF NOT EXISTS idx_events_type_off ON events(event_type, ingest_offset);
  `);
  db.prepare(`
    INSERT INTO events (id, event_type, schema_version, correlation_id, parent_event_id,
                        emitted_at, hostname, process_name, payload_json,
                        validation_failed, ingest_offset)
    VALUES (?, 'OperatorCorrection', 1, NULL, NULL, ?, 'test-host', 'test-proc', ?, 0, ?)
  `).run(id, new Date().toISOString(), JSON.stringify(payload), ingestOffset);
  db.close();
}

const silentLogger = {
  info: (): void => undefined,
  warn: (): void => undefined
};

describe('makeProposalCallback (end-to-end through processOnce)', () => {
  it('writes a proposal file for each new OperatorCorrection event', async () => {
    seedEvent('ev_relit', 1, { correctionText: 'we already decided this', detectionMode: 'manual' });
    seedEvent('ev_decision', 2, { correctionText: 'stop asking', detectionMode: 'manual' });

    const onClassified = makeProposalCallback({ memoryDir, logger: silentLogger });
    const n = await processOnce({
      eventsDbPath,
      offsetDbPath,
      onClassified,
      logger: silentLogger
    });

    expect(n).toBe(2);
    const proposals = listProposals(memoryDir);
    expect(proposals.length).toBe(2);

    // Each proposal contains the event id in provenance + the right category
    const contents = proposals.map((p) => readFileSync(p, 'utf-8'));
    const relit = contents.find((c) => c.includes('ev_relit'));
    const decision = contents.find((c) => c.includes('ev_decision'));
    expect(relit).toBeDefined();
    expect(decision).toBeDefined();
    expect(relit).toContain('classifiedAs: ReLitigation');
    expect(decision).toContain('classifiedAs: DecisionClassifierViolation');
  });

  it('records the proposal file path as artifact_ref in the offset store', async () => {
    seedEvent('ev_only', 1, { correctionText: 'stop asking', detectionMode: 'manual' });

    const onClassified = makeProposalCallback({ memoryDir, logger: silentLogger });
    await processOnce({
      eventsDbPath,
      offsetDbPath,
      onClassified,
      logger: silentLogger
    });

    const offsetDb = new Database(offsetDbPath, { readonly: true });
    const row = offsetDb
      .prepare('SELECT artifact_ref FROM processed_events WHERE event_id = ?')
      .get('ev_only') as { artifact_ref: string } | undefined;
    offsetDb.close();
    expect(row?.artifact_ref).toBeDefined();
    expect(row!.artifact_ref).toContain(PROPOSALS_SUBDIR);
    expect(existsSync(row!.artifact_ref)).toBe(true);
  });

  it('does not throw or wedge the consumer if writeProposal fails', async () => {
    seedEvent('ev_only', 1, { correctionText: 'stop asking', detectionMode: 'manual' });

    // Force a write failure: point memoryDir at a path under a regular
    // file so mkdir(... { recursive: true }) cannot create the subdir.
    const blocker = join(tmp, 'blocker-file');
    writeFileSync(blocker, 'x');
    const badMemoryDir = join(blocker, 'subdir');

    const warnings: string[] = [];
    const logger = {
      info: (): void => undefined,
      warn: (m: string): void => {
        warnings.push(m);
      }
    };
    const onClassified = makeProposalCallback({ memoryDir: badMemoryDir, logger });

    const n = await processOnce({
      eventsDbPath,
      offsetDbPath,
      onClassified,
      logger: silentLogger
    });
    expect(n).toBe(1);
    // Warning was logged, consumer continued
    expect(warnings.some((w) => w.includes('proposal write failed'))).toBe(true);
    // Event is still recorded as processed (so we don't re-attempt forever)
    const offsetDb = new Database(offsetDbPath, { readonly: true });
    const row = offsetDb
      .prepare('SELECT artifact_ref FROM processed_events WHERE event_id = ?')
      .get('ev_only') as { artifact_ref: string | null } | undefined;
    offsetDb.close();
    expect(row).toBeDefined();
    expect(row!.artifact_ref).toBeNull();
  });

  it('uses the injected clock for deterministic filenames', async () => {
    seedEvent('ev_only', 1, { correctionText: 'stop asking', detectionMode: 'manual' });

    const fixed = new Date('2026-05-05T07:08:09.000Z');
    const onClassified = makeProposalCallback({
      memoryDir,
      logger: silentLogger,
      now: () => fixed
    });
    await processOnce({
      eventsDbPath,
      offsetDbPath,
      onClassified,
      logger: silentLogger
    });
    const proposals = listProposals(memoryDir);
    expect(proposals.length).toBe(1);
    expect(proposals[0]).toContain('20260505-070809-');
  });

  it('callback signature returns a string when the write succeeds', () => {
    // Compile-time + runtime test that the callback returns a string artifact_ref.
    const cb = makeProposalCallback({ memoryDir, logger: silentLogger });
    const event: EventRow = {
      id: 'x',
      event_type: 'OperatorCorrection',
      schema_version: 1,
      correlation_id: null,
      parent_event_id: null,
      emitted_at: new Date().toISOString(),
      hostname: 'h',
      process_name: 'p',
      payload_json: '{}',
      validation_failed: 0,
      ingest_offset: 1
    };
    const payload: OperatorCorrectionInput = { correctionText: 'stop asking' };
    const cls: ClassificationResult = {
      primary: 'DecisionClassifierViolation',
      secondary: [],
      severity: 'medium',
      generalizability: 'systemic',
      matchedBy: 'test',
      confidence: 1
    };
    const ret = cb(event, payload, cls);
    expect(typeof ret).toBe('string');
  });
});
