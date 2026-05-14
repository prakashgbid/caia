/**
 * Tests for src/mentor-emit.ts (prompt-optimizer copy) — mirrors the
 * local-llm-router suite. Verifies the HTTP signing + fire-and-forget +
 * never-throws contract, and asserts that `optimize()` emits one
 * `PromptOptimizerStage` event per stage.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createHmac } from 'node:crypto';
import { createServer, type Server } from 'node:http';
import { AddressInfo } from 'node:net';

import {
  emitOptimizerEvent,
  newOptimizerRunId,
  __resetEmitterConfig,
  __setEmitterConfigForTests,
} from '../src/mentor-emit.js';
import { optimize } from '../src/index.js';

interface RecordedRequest {
  body: string;
  headers: Record<string, string | string[] | undefined>;
}

async function startCapturingServer(opts: {
  status?: number;
  delayMs?: number;
} = {}): Promise<{
  port: number;
  close: () => Promise<void>;
  requests: RecordedRequest[];
  waitForRequests: (n: number, timeoutMs?: number) => Promise<void>;
}> {
  const requests: RecordedRequest[] = [];
  const listeners: Array<() => void> = [];
  const server: Server = createServer((req, res) => {
    const chunks: Buffer[] = [];
    req.on('data', (c: Buffer) => chunks.push(c));
    req.on('end', () => {
      const body = Buffer.concat(chunks).toString('utf-8');
      requests.push({ body, headers: req.headers });
      for (const l of listeners.splice(0)) l();
      const respond = (): void => {
        res.statusCode = opts.status ?? 200;
        res.setHeader('content-type', 'application/json');
        res.end(JSON.stringify({ ingested: 1, offsets: [1] }));
      };
      if (opts.delayMs) setTimeout(respond, opts.delayMs);
      else respond();
    });
  });
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', () => r()));
  const port = (server.address() as AddressInfo).port;
  return {
    port,
    close: () => new Promise<void>((r) => server.close(() => r())),
    requests,
    waitForRequests: async (n: number, timeoutMs = 2_000) => {
      const start = Date.now();
      while (requests.length < n) {
        if (Date.now() - start > timeoutMs) {
          throw new Error(
            `waitForRequests: expected ${n}, got ${requests.length} after ${timeoutMs}ms`,
          );
        }
        await new Promise<void>((r) => {
          const timer = setTimeout(r, 25);
          listeners.push(() => {
            clearTimeout(timer);
            r();
          });
        });
      }
    },
  };
}

async function drain(): Promise<void> {
  // Flush microtasks + setImmediate queue + a short macrotask so that
  // outbound HTTP writes have a chance to round-trip to the loopback
  // server. setImmediate alone is not enough — the kernel needs a tick.
  for (let i = 0; i < 4; i++) await new Promise((r) => setImmediate(r));
  await new Promise((r) => setTimeout(r, 25));
  for (let i = 0; i < 2; i++) await new Promise((r) => setImmediate(r));
}

const TEST_SECRET = 'b'.repeat(40);

describe('prompt-optimizer mentor-emit', () => {
  let server: Awaited<ReturnType<typeof startCapturingServer>> | null = null;

  beforeEach(() => {
    __resetEmitterConfig();
  });

  afterEach(async () => {
    await drain();
    if (server) {
      await server.close();
      server = null;
    }
    __resetEmitterConfig();
  });

  it('newOptimizerRunId mints unique ids', () => {
    const ids = new Set<string>();
    for (let i = 0; i < 40; i++) ids.add(newOptimizerRunId());
    expect(ids.size).toBe(40);
  });

  it('emit no-ops silently when secret is unset', async () => {
    const savedSecret = process.env['CAIA_EVENT_BUS_SECRET'];
    const savedPath = process.env['CAIA_EVENT_BUS_SECRET_PATH'];
    delete process.env['CAIA_EVENT_BUS_SECRET'];
    delete process.env['CAIA_EVENT_BUS_SECRET_PATH'];
    try {
      expect(() =>
        emitOptimizerEvent('PromptOptimizerStage', {
          runId: 'opt_test',
          stageNumber: 1,
          transform: 'stage1-prepass',
          tokensIn: 10,
          tokensOut: 10,
        }),
      ).not.toThrow();
      await drain();
    } finally {
      if (savedSecret !== undefined) process.env['CAIA_EVENT_BUS_SECRET'] = savedSecret;
      if (savedPath !== undefined) process.env['CAIA_EVENT_BUS_SECRET_PATH'] = savedPath;
    }
  });

  it('emit POSTs a correctly-signed event', async () => {
    server = await startCapturingServer();
    __setEmitterConfigForTests({
      baseUrl: `http://127.0.0.1:${server.port}`,
      secret: TEST_SECRET,
    });
    emitOptimizerEvent('PromptOptimizerStage', {
      runId: 'opt_1',
      stageNumber: 1,
      transform: 'stage1-prepass',
      tokensIn: 100,
      tokensOut: 80,
      noop: false,
    });
    await server.waitForRequests(1);
    expect(server.requests.length).toBe(1);
    const req = server.requests[0]!;
    const parsed = JSON.parse(req.body) as { events: Array<{ payload_json: string; event_type: string }> };
    expect(parsed.events[0]!.event_type).toBe('PromptOptimizerStage');
    const payload = JSON.parse(parsed.events[0]!.payload_json) as Record<string, unknown>;
    expect(payload['stageNumber']).toBe(1);
    expect(payload['transform']).toBe('stage1-prepass');

    const ts = req.headers['x-caia-timestamp'] as string;
    const sig = req.headers['x-caia-signature'] as string;
    const expected = createHmac('sha256', TEST_SECRET)
      .update(`${ts}:${req.body}`)
      .digest('hex');
    expect(sig).toBe(expected);
  });

  it('emit swallows network errors silently (server down)', () => {
    __setEmitterConfigForTests({
      baseUrl: 'http://127.0.0.1:1',
      secret: TEST_SECRET,
      timeoutMs: 100,
    });
    expect(() =>
      emitOptimizerEvent('PromptOptimizerStage', {
        runId: 'opt_2',
        stageNumber: 2,
        transform: 'stage2-summarize',
        tokensIn: 200,
        tokensOut: 100,
      }),
    ).not.toThrow();
  });

  it('emit is fire-and-forget — returns synchronously', async () => {
    server = await startCapturingServer({ delayMs: 200 });
    __setEmitterConfigForTests({
      baseUrl: `http://127.0.0.1:${server.port}`,
      secret: TEST_SECRET,
    });
    const start = Date.now();
    emitOptimizerEvent('PromptOptimizerStage', {
      runId: 'opt_3',
      stageNumber: 3,
      transform: 'stage3-prune',
      tokensIn: 200,
      tokensOut: 150,
    });
    expect(Date.now() - start).toBeLessThan(50);
  });

  describe('optimize() integration', () => {
    it('emits a stage-1 event on the short-prompt bail-out path', async () => {
      server = await startCapturingServer();
      __setEmitterConfigForTests({
        baseUrl: `http://127.0.0.1:${server.port}`,
        secret: TEST_SECRET,
      });

      const res = await optimize({
        userQuestion: 'rename Foo to Bar',
        toolOutputs: [{ id: 't1', content: 'short blob' }],
        budget: { skipStagesUnderTokens: 1000 },
      });
      expect(res.metrics.stage2.skipped).toBe(true);

      // Bail-out path emits 3 events: stage 1 + skip stage 2 + skip stage 3.
      await server.waitForRequests(3);
      expect(server.requests.length).toBeGreaterThanOrEqual(1);
      const stages = server.requests
        .map((r) => JSON.parse(r.body) as { events: Array<{ event_type: string; payload_json: string }> })
        .flatMap((p) => p.events.map((e) => JSON.parse(e.payload_json) as { stageNumber: number; transform: string }));
      const stageNumbers = stages.map((s) => s.stageNumber).sort();
      expect(stageNumbers).toContain(1);
    });

    it('emits stage-1, stage-2, stage-3 events on the full pipeline', async () => {
      server = await startCapturingServer();
      __setEmitterConfigForTests({
        baseUrl: `http://127.0.0.1:${server.port}`,
        secret: TEST_SECRET,
      });

      // Long-enough prompt to force stage2/stage3 to run.
      const longBlob = 'verbose log preamble '.repeat(150) + 'rename Foo identifier';
      const fetchSpy = vi.fn(async (url: string) => {
        if (url.includes('/v1/chat/completions')) {
          return new Response(
            JSON.stringify({
              choices: [{ message: { content: 'rename Foo identifier (preamble dropped)' } }],
            }),
            { status: 200, headers: { 'content-type': 'application/json' } },
          );
        }
        return new Response('', { status: 404 });
      }) as unknown as typeof fetch;

      const original = globalThis.fetch;
      globalThis.fetch = fetchSpy;
      try {
        await optimize({
          systemPrompt: 'You are a careful assistant.',
          toolOutputs: [{ id: 'blob-1', content: longBlob }],
          userQuestion: 'rename Foo to Bar',
          budget: { skipStagesUnderTokens: 50 },
        });
      } finally {
        globalThis.fetch = original;
      }
      // Full pipeline fires one event per stage (3 total).
      await server.waitForRequests(3);

      const stages = server.requests
        .map((r) => JSON.parse(r.body) as { events: Array<{ event_type: string; payload_json: string }> })
        .flatMap((p) => p.events.map((e) => JSON.parse(e.payload_json) as { stageNumber: number }));
      const seenNumbers = new Set(stages.map((s) => s.stageNumber));
      expect(seenNumbers.has(1)).toBe(true);
      expect(seenNumbers.has(2)).toBe(true);
      expect(seenNumbers.has(3)).toBe(true);
    });
  });
});
