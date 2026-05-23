import type { IncomingMessage, ServerResponse } from 'node:http';
import { EventEmitter } from 'node:events';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { handleProjectSse, SseConnection } from '../src/realtime.js';
import { buildInMemoryStateMachine } from '../src/test-support.js';

/** Minimal fake of node http's ServerResponse for SSE testing. */
class FakeRes extends EventEmitter {
  statusCode = 0;
  headers = new Map<string, string>();
  chunks: string[] = [];
  ended = false;
  setHeader(k: string, v: string): void {
    this.headers.set(k, v);
  }
  flushHeaders(): void {
    /* no-op */
  }
  write(s: string): boolean {
    this.chunks.push(s);
    return true;
  }
  end(): void {
    this.ended = true;
    this.emit('close');
  }
}

class FakeReq extends EventEmitter {}

describe('SseConnection', () => {
  let res: FakeRes;
  let conn: SseConnection;

  beforeEach(() => {
    res = new FakeRes();
    conn = new SseConnection(res as unknown as ServerResponse, 1_000_000);
  });
  afterEach(() => conn.close());

  it('sets the SSE headers', () => {
    expect(res.headers.get('Content-Type')).toBe('text/event-stream');
    expect(res.headers.get('Cache-Control')).toContain('no-cache');
  });

  it('writes a properly framed event', () => {
    conn.send('hello', 'world', '42');
    const out = res.chunks.join('');
    expect(out).toContain('id: 42');
    expect(out).toContain('event: hello');
    expect(out).toContain('data: world');
    expect(out.endsWith('\n\n')).toBe(true);
  });

  it('splits multiline data into multiple data: frames', () => {
    conn.send('e', 'line1\nline2');
    const out = res.chunks.join('');
    expect(out).toMatch(/data: line1\ndata: line2/);
  });

  it('sendJson serializes the value', () => {
    conn.sendJson('e', { a: 1 });
    expect(res.chunks.join('')).toContain('data: {"a":1}');
  });

  it('sendComment writes a comment line', () => {
    conn.sendComment('keepalive');
    expect(res.chunks.join('')).toContain(': keepalive');
  });

  it('close is idempotent and silences further sends', () => {
    conn.close();
    conn.close();
    expect(conn.isClosed).toBe(true);
    conn.send('e', 'd');
    // chunk count unchanged after close
    const before = res.chunks.length;
    conn.send('e', 'd');
    expect(res.chunks.length).toBe(before);
  });
});

describe('handleProjectSse', () => {
  it('sends a snapshot then forwards state-transition events', async () => {
    const { sm } = buildInMemoryStateMachine({ idempotencyWindowMs: 0 });
    await sm.init();
    const p = await sm.createProject({
      tenantId: 't',
      slug: 'sse-1',
      displayName: 'SSE',
    });

    const req = new FakeReq();
    const res = new FakeRes();
    await handleProjectSse(
      sm,
      req as unknown as IncomingMessage,
      res as unknown as ServerResponse,
      p.id,
      { keepaliveMs: 1_000_000 },
    );

    // initial snapshot
    const snapshot = res.chunks.join('');
    expect(snapshot).toContain('event: snapshot');
    expect(snapshot).toContain('"status":"onboarding"');

    // drive a transition; the SSE listener should append a project event
    await sm.transition(p.id, 'idea-captured', {
      reason: 'r',
      triggeredBy: { kind: 'system', id: 't' },
    });

    // give the microtask queue time to flush the in-memory notify
    await Promise.resolve();
    await Promise.resolve();

    const out = res.chunks.join('');
    expect(out).toContain('event: project');
    expect(out).toContain('"to_state":"idea-captured"');

    // simulate client disconnect — should not throw
    req.emit('close');
    res.end();
  });

  it('returns an error event for unknown project', async () => {
    const { sm } = buildInMemoryStateMachine();
    await sm.init();
    const req = new FakeReq();
    const res = new FakeRes();
    await handleProjectSse(
      sm,
      req as unknown as IncomingMessage,
      res as unknown as ServerResponse,
      '00000000-0000-0000-0000-000000000099',
      {},
    );
    expect(res.chunks.join('')).toContain('"error":"project-not-found"');
  });
});
