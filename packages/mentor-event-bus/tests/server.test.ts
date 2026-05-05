import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { request } from 'node:http';
import { join } from 'node:path';
import { openDatabase, queryEvents, type InsertEventArgs } from '../src/sqlite';
import { startServer, MAX_BODY_BYTES, type RunningServer } from '../src/server';
import { signRequest } from '../src/auth';
import type { Database as DatabaseInstance } from 'better-sqlite3';

const SECRET = 'a'.repeat(64);
const migrationsDir = join(__dirname, '..', 'migrations');

interface HttpResponse {
  status: number;
  body: string;
}

function postRaw(
  host: string,
  port: number,
  path: string,
  body: string,
  headers: Record<string, string> = {}
): Promise<HttpResponse> {
  return new Promise((resolve, reject) => {
    const req = request(
      {
        method: 'POST',
        host,
        port,
        path,
        headers: {
          'content-type': 'application/json; charset=utf-8',
          'content-length': Buffer.byteLength(body).toString(),
          ...headers
        }
      },
      (resp) => {
        const chunks: Buffer[] = [];
        resp.on('data', (c) => chunks.push(c as Buffer));
        resp.on('end', () =>
          resolve({
            status: resp.statusCode ?? 0,
            body: Buffer.concat(chunks).toString('utf-8')
          })
        );
      }
    );
    req.on('error', reject);
    req.write(body);
    req.end();
  });
}

function getRaw(
  host: string,
  port: number,
  path: string,
  headers: Record<string, string> = {}
): Promise<HttpResponse> {
  return new Promise((resolve, reject) => {
    const req = request(
      {
        method: 'GET',
        host,
        port,
        path,
        headers
      },
      (resp) => {
        const chunks: Buffer[] = [];
        resp.on('data', (c) => chunks.push(c as Buffer));
        resp.on('end', () =>
          resolve({
            status: resp.statusCode ?? 0,
            body: Buffer.concat(chunks).toString('utf-8')
          })
        );
      }
    );
    req.on('error', reject);
    req.end();
  });
}

describe('event-bus HTTP server', () => {
  let db: DatabaseInstance;
  let running: RunningServer;
  const silentLogger = { info: () => undefined, warn: () => undefined };

  beforeAll(async () => {
    db = openDatabase(':memory:', migrationsDir, false);
    running = await startServer({
      db,
      port: 0, // OS-assigned
      host: '127.0.0.1',
      secret: SECRET,
      logger: silentLogger
    });
  });

  afterAll(async () => {
    if (running) await running.close();
    if (db) db.close();
  });

  it('healthz is unauthenticated and returns 200 ok', async () => {
    const resp = await getRaw('127.0.0.1', running.port, '/v1/healthz');
    expect(resp.status).toBe(200);
    expect(resp.body).toContain('ok');
  });

  it('rejects POST /v1/events without auth headers', async () => {
    const body = JSON.stringify({ events: [] });
    const resp = await postRaw('127.0.0.1', running.port, '/v1/events', body);
    expect(resp.status).toBe(401);
    expect(resp.body).toMatch(/missing-timestamp/);
  });

  it('rejects POST with a wrong-secret signature', async () => {
    const body = JSON.stringify({ events: [] });
    const headers = signRequest('z'.repeat(64), body);
    const resp = await postRaw('127.0.0.1', running.port, '/v1/events', body, headers);
    expect(resp.status).toBe(401);
    expect(resp.body).toMatch(/bad-signature/);
  });

  it('accepts a properly signed POST with one event', async () => {
    const event: Omit<InsertEventArgs, 'id'> = {
      event_type: 'PRMerged',
      schema_version: 1,
      correlation_id: null,
      parent_event_id: null,
      emitted_at: new Date().toISOString(),
      hostname: 'test-host',
      process_name: 'test-proc',
      payload_json: JSON.stringify({ prNumber: 1, sha: 'a', branch: 'main' }),
      validation_failed: 0
    };
    const body = JSON.stringify({ events: [event] });
    const headers = signRequest(SECRET, body);
    const resp = await postRaw('127.0.0.1', running.port, '/v1/events', body, headers);
    expect(resp.status).toBe(200);
    const parsed = JSON.parse(resp.body) as { ingested: number; offsets: number[] };
    expect(parsed.ingested).toBe(1);
    expect(parsed.offsets.length).toBe(1);

    // Verify it actually landed in the DB.
    const rows = queryEvents(db, { eventType: 'PRMerged' });
    expect(rows.length).toBeGreaterThanOrEqual(1);
    const last = rows[rows.length - 1]!;
    expect(last.event_type).toBe('PRMerged');
    expect(last.payload_json).toContain('"prNumber":1');
  });

  it('accepts a batch of events', async () => {
    const baseTs = new Date().toISOString();
    const events = [1, 2, 3].map((n) => ({
      event_type: 'TaskCompleted',
      schema_version: 1,
      correlation_id: null,
      parent_event_id: null,
      emitted_at: baseTs,
      hostname: 'h',
      process_name: 'p',
      payload_json: JSON.stringify({ taskId: `t-${n}`, durationMs: 1, exitCode: 0 }),
      validation_failed: 0
    }));
    const body = JSON.stringify({ events });
    const headers = signRequest(SECRET, body);
    const resp = await postRaw('127.0.0.1', running.port, '/v1/events', body, headers);
    expect(resp.status).toBe(200);
    const parsed = JSON.parse(resp.body) as { ingested: number };
    expect(parsed.ingested).toBe(3);
  });

  it('rejects malformed JSON body', async () => {
    const body = '{ not valid json';
    const headers = signRequest(SECRET, body);
    const resp = await postRaw('127.0.0.1', running.port, '/v1/events', body, headers);
    expect(resp.status).toBe(400);
    expect(resp.body).toMatch(/invalid-json/);
  });

  it('rejects body missing required fields', async () => {
    const body = JSON.stringify({ events: [{ event_type: 'PRMerged' }] });
    const headers = signRequest(SECRET, body);
    const resp = await postRaw('127.0.0.1', running.port, '/v1/events', body, headers);
    expect(resp.status).toBe(400);
    expect(resp.body).toMatch(/missing-required-fields/);
  });

  it('rejects body when "events" is not an array', async () => {
    const body = JSON.stringify({ events: { not: 'array' } });
    const headers = signRequest(SECRET, body);
    const resp = await postRaw('127.0.0.1', running.port, '/v1/events', body, headers);
    expect(resp.status).toBe(400);
    expect(resp.body).toMatch(/expected-events-array/);
  });

  it('GET /v1/recent returns persisted events', async () => {
    // First, ingest a known event.
    const event = {
      event_type: 'OperatorCorrection',
      schema_version: 1,
      correlation_id: 'corr-recent-test',
      parent_event_id: null,
      emitted_at: new Date().toISOString(),
      hostname: 'h',
      process_name: 'p',
      payload_json: JSON.stringify({ correctionText: 'fix this', detectionMode: 'manual' }),
      validation_failed: 0
    };
    const postBody = JSON.stringify({ events: [event] });
    const postHeaders = signRequest(SECRET, postBody);
    await postRaw('127.0.0.1', running.port, '/v1/events', postBody, postHeaders);

    // Now query.
    const getHeaders = signRequest(SECRET, '');
    const resp = await getRaw(
      '127.0.0.1',
      running.port,
      '/v1/recent?eventType=OperatorCorrection&limit=10',
      getHeaders
    );
    expect(resp.status).toBe(200);
    const parsed = JSON.parse(resp.body) as { events: Array<{ event_type: string }> };
    expect(parsed.events.some((e) => e.event_type === 'OperatorCorrection')).toBe(true);
  });

  it('returns 404 for unknown paths', async () => {
    const headers = signRequest(SECRET, '');
    const resp = await getRaw('127.0.0.1', running.port, '/v1/nonexistent', headers);
    expect(resp.status).toBe(404);
  });

  it('rejects bodies larger than MAX_BODY_BYTES', async () => {
    const big = 'x'.repeat(MAX_BODY_BYTES + 1);
    const headers = signRequest(SECRET, big);
    // The server destroys the socket once the body exceeds the cap.
    // Depending on chunk timing, the client either receives a 413 response
    // (response flushed before destroy) or an ECONNRESET. Either is correct
    // refusal behavior — we accept both.
    let outcome: { kind: 'http'; status: number } | { kind: 'reset' };
    try {
      const resp = await postRaw('127.0.0.1', running.port, '/v1/events', big, headers);
      outcome = { kind: 'http', status: resp.status };
    } catch (err) {
      const errStr = String(err);
      if (/hang up|ECONNRESET|EPIPE/i.test(errStr)) {
        outcome = { kind: 'reset' };
      } else {
        throw err;
      }
    }
    if (outcome.kind === 'http') {
      expect(outcome.status).toBe(413);
    } else {
      expect(outcome.kind).toBe('reset');
    }
  });
});
