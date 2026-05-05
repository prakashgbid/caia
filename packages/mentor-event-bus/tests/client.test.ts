import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { Client } from '../src/client';
import { withCorrelation } from '../src/correlation';

let dbDir: string;
const migrationsDir = join(__dirname, '..', 'migrations');

beforeEach(() => {
  dbDir = mkdtempSync(join(tmpdir(), 'mentor-bus-client-'));
});
afterEach(() => {
  rmSync(dbDir, { recursive: true, force: true });
});

function makeClient(opts: Partial<ConstructorParameters<typeof Client>[0]> = {}): Client {
  return new Client({
    dbPath: join(dbDir, 'events.sqlite'),
    migrationsDir,
    hostname: 'test-host',
    processName: 'test',
    disableWal: true,
    ...opts
  });
}

describe('Client.emit', () => {
  it('emits a valid PRMerged event and returns an id', () => {
    const c = makeClient();
    const id = c.emit('PRMerged', { prNumber: 312, sha: 'abc1234', branch: 'develop' });
    expect(id).toBeTruthy();
    expect(id?.startsWith('ev_')).toBe(true);
    const rows = c.getRecent({ eventType: 'PRMerged' });
    expect(rows.length).toBe(1);
    expect(rows[0]!.payload).toEqual({ prNumber: 312, sha: 'abc1234', branch: 'develop' });
    expect(rows[0]!.validationFailed).toBe(false);
    c.close();
  });

  it('emits even when payload validation fails (with validation_failed=1)', () => {
    const c = makeClient();
    // Invalid SHA → validation fails but emit must not throw
    const id = c.emit('PRMerged', {
      prNumber: 312,
      sha: 'NOT-A-SHA',
      branch: 'develop'
    } as never);
    expect(id).toBeTruthy();
    const rows = c.getRecent({ eventType: 'PRMerged' });
    expect(rows.length).toBe(1);
    expect(rows[0]!.validationFailed).toBe(true);
    c.close();
  });

  it('inherits correlation_id from withCorrelation', () => {
    const c = makeClient();
    let emitted: string | null = null;
    withCorrelation('corr-test', () => {
      emitted = c.emit('PromptReceived', { promptId: 'p1', body: 'hello' });
    });
    expect(emitted).not.toBeNull();
    const rows = c.getRecent({ correlationId: 'corr-test' });
    expect(rows.length).toBe(1);
    expect(rows[0]!.correlationId).toBe('corr-test');
    c.close();
  });

  it('explicit emit-options override the inherited correlation_id', () => {
    const c = makeClient();
    withCorrelation('outer', () => {
      c.emit('PromptReceived', { promptId: 'p1', body: 'hi' }, { correlationId: 'inner' });
    });
    const rows = c.getRecent();
    expect(rows[0]!.correlationId).toBe('inner');
    c.close();
  });

  it('records hostname + processName', () => {
    const c = makeClient({ hostname: 'host-z', processName: 'orchestrator' });
    c.emit('TaskSpawned', { taskId: 't1', agentName: 'worker-coding' });
    const rows = c.getRecent();
    expect(rows[0]!.hostname).toBe('host-z');
    expect(rows[0]!.processName).toBe('orchestrator');
    c.close();
  });

  it('returns null and logs on emit-after-close', () => {
    let warned = false;
    const c = makeClient({ logger: { warn: () => { warned = true; } } });
    c.close();
    const id = c.emit('TaskCompleted', { taskId: 't1', durationMs: 1, exitCode: 0 });
    expect(id).toBeNull();
    expect(warned).toBe(true);
  });
});

describe('Client.getRecent', () => {
  it('returns an empty array on a fresh DB', () => {
    const c = makeClient();
    expect(c.getRecent()).toEqual([]);
    c.close();
  });

  it('orders by ingest_offset desc by default', () => {
    const c = makeClient();
    c.emit('TaskSpawned', { taskId: 't1', agentName: 'a' });
    c.emit('TaskSpawned', { taskId: 't2', agentName: 'a' });
    c.emit('TaskSpawned', { taskId: 't3', agentName: 'a' });
    const rows = c.getRecent({ limit: 10 });
    expect(rows.map((r) => (r.payload as { taskId: string }).taskId)).toEqual(['t3', 't2', 't1']);
    c.close();
  });

  it('count() returns the row total', () => {
    const c = makeClient();
    c.emit('TaskSpawned', { taskId: 't1', agentName: 'a' });
    c.emit('TaskSpawned', { taskId: 't2', agentName: 'a' });
    expect(c.count()).toBe(2);
    expect(c.count({ eventType: 'TaskSpawned' })).toBe(2);
    expect(c.count({ eventType: 'PRMerged' })).toBe(0);
    c.close();
  });
});

describe('Client schema registration', () => {
  it('populates schema_definitions on init', () => {
    const c = makeClient();
    const db = c.unsafeGetDb();
    const rows = db.prepare('SELECT COUNT(*) AS n FROM schema_definitions').get() as { n: number };
    // 22 event types, all registered at init time
    expect(rows.n).toBe(22);
    c.close();
  });

  it('skips schema registration when skipSchemaRegistration=true', () => {
    const c = makeClient({ skipSchemaRegistration: true });
    const rows = c.unsafeGetDb().prepare('SELECT COUNT(*) AS n FROM schema_definitions').get() as {
      n: number;
    };
    expect(rows.n).toBe(0);
    c.close();
  });
});

describe('Client persistence', () => {
  it('events survive a close + reopen', () => {
    const dbPath = join(dbDir, 'persist.sqlite');
    const c1 = new Client({ dbPath, migrationsDir, disableWal: true });
    c1.emit('PRMerged', { prNumber: 999, sha: 'deadbeef', branch: 'develop' });
    c1.close();
    expect(existsSync(dbPath)).toBe(true);
    const c2 = new Client({ dbPath, migrationsDir, disableWal: true });
    const rows = c2.getRecent();
    expect(rows.length).toBe(1);
    expect((rows[0]!.payload as { prNumber: number }).prNumber).toBe(999);
    c2.close();
  });
});
