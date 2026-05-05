import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { join } from 'node:path';
import { openDatabase, queryEvents } from '../src/sqlite';
import { startServer, type RunningServer } from '../src/server';
import { HttpClient, httpEmitOnce, assertEverySchemaForHttp } from '../src/http-client';
import { withCorrelationAsync } from '../src/correlation';
import type { Database as DatabaseInstance } from 'better-sqlite3';

const SECRET = 'a'.repeat(64);
const migrationsDir = join(__dirname, '..', 'migrations');

describe('HttpClient end-to-end', () => {
  let db: DatabaseInstance;
  let running: RunningServer;
  const silentLogger = { info: () => undefined, warn: () => undefined };

  beforeAll(async () => {
    db = openDatabase(':memory:', migrationsDir, false);
    running = await startServer({
      db,
      port: 0,
      host: '127.0.0.1',
      secret: SECRET,
      logger: silentLogger
    });
  });

  afterAll(async () => {
    if (running) await running.close();
    if (db) db.close();
  });

  it('throws on missing baseUrl', () => {
    expect(() => new HttpClient({ baseUrl: '', secret: SECRET })).toThrow(/baseUrl/);
  });

  it('throws on missing secret', () => {
    expect(() => new HttpClient({ baseUrl: 'http://x:1', secret: '' })).toThrow(/secret/);
  });

  it('healthz round-trip', async () => {
    const c = new HttpClient({
      baseUrl: `http://127.0.0.1:${running.port}`,
      secret: SECRET,
      logger: silentLogger
    });
    const r = await c.healthz();
    expect(r.ok).toBe(true);
  });

  it('emit a valid PRMerged event end-to-end', async () => {
    const c = new HttpClient({
      baseUrl: `http://127.0.0.1:${running.port}`,
      secret: SECRET,
      hostname: 'producer-host',
      processName: 'test',
      logger: silentLogger
    });
    const r = await c.emit('PRMerged', { prNumber: 42, sha: 'abc1234', branch: 'main' });
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.status).toBe(200);
      expect(r.ingestOffsets.length).toBe(1);
    }

    const rows = queryEvents(db, { eventType: 'PRMerged' });
    const ours = rows.find((e) => JSON.parse(e.payload_json).prNumber === 42);
    expect(ours).toBeDefined();
    expect(ours!.hostname).toBe('producer-host');
    expect(ours!.process_name).toBe('test');
  });

  it('emit picks up correlation_id from withCorrelationAsync', async () => {
    const c = new HttpClient({
      baseUrl: `http://127.0.0.1:${running.port}`,
      secret: SECRET,
      logger: silentLogger
    });

    await withCorrelationAsync('correlation-xyz', async () => {
      const r = await c.emit('TaskSpawned', {
        taskId: 't-abc',
        agentName: 'worker-coding'
      });
      expect(r.ok).toBe(true);
    });

    const rows = queryEvents(db, { correlationId: 'correlation-xyz' });
    expect(rows.length).toBeGreaterThanOrEqual(1);
    expect(rows[0]!.event_type).toBe('TaskSpawned');
  });

  it('emit reports auth failure as ok=false (does not throw)', async () => {
    const c = new HttpClient({
      baseUrl: `http://127.0.0.1:${running.port}`,
      secret: 'wrong'.padEnd(64, 'x'),
      logger: silentLogger
    });
    const r = await c.emit('PRMerged', { prNumber: 99, sha: 'x', branch: 'y' });
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.status).toBe(401);
      expect(r.error).toMatch(/bad-signature|http 401/);
    }
  });

  it('emit on unreachable host returns ok=false (does not throw)', async () => {
    const c = new HttpClient({
      baseUrl: 'http://127.0.0.1:1', // port 1 always closed on macOS
      secret: SECRET,
      timeoutMs: 500,
      logger: silentLogger
    });
    const r = await c.emit('PRMerged', { prNumber: 1, sha: 's', branch: 'b' });
    expect(r.ok).toBe(false);
  });

  it('persists validation_failed=1 when payload is invalid', async () => {
    const c = new HttpClient({
      baseUrl: `http://127.0.0.1:${running.port}`,
      secret: SECRET,
      logger: silentLogger
    });
    // PRMerged requires `prNumber: number`. Pass a string to trigger validation failure.
    // We cast to bypass TS but the runtime Zod validator catches it.
    const r = await c.emit(
      'PRMerged',
      { prNumber: 'not-a-number' as unknown as number, sha: 's', branch: 'b' }
    );
    // Network call still succeeds — validation_failed flag is recorded.
    expect(r.ok).toBe(true);

    const rows = queryEvents(db, { eventType: 'PRMerged' });
    const invalid = rows.find((e) => e.validation_failed === 1);
    expect(invalid).toBeDefined();
  });

  it('httpEmitOnce convenience (one-off CLI call)', async () => {
    const r = await httpEmitOnce(
      {
        baseUrl: `http://127.0.0.1:${running.port}`,
        secret: SECRET,
        logger: silentLogger
      },
      'OperatorAcknowledged',
      { ackText: 'thanks' }
    );
    expect(r.ok).toBe(true);
  });
});

describe('assertEverySchemaForHttp', () => {
  it('does not throw — every EventType has a Zod schema', () => {
    expect(() => assertEverySchemaForHttp()).not.toThrow();
  });
});
