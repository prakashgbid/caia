/**
 * Unit + integration coverage for src/mentor-emit.ts.
 *
 * Strategy: stand up a tiny in-process HTTP server that records every POST,
 * point the emitter at it via the test-only config seam, and verify the
 * emit path produces a correctly-signed request. Then exercise the failure
 * modes (no config, server down, server 500) and assert that emit never
 * throws and never blocks the caller.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createHmac } from 'node:crypto';
import { createServer, type Server } from 'node:http';
import { AddressInfo } from 'node:net';

import {
  emitMentorEvent,
  newClaudeRequestId,
  newDecisionId,
  __resetEmitterConfig,
  __setEmitterConfigForTests,
} from '../src/mentor-emit.js';

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
  resolveNextRequest: () => Promise<RecordedRequest>;
}> {
  const requests: RecordedRequest[] = [];
  const waiters: Array<(r: RecordedRequest) => void> = [];

  const server: Server = createServer((req, res) => {
    const chunks: Buffer[] = [];
    req.on('data', (c: Buffer) => chunks.push(c));
    req.on('end', () => {
      const body = Buffer.concat(chunks).toString('utf-8');
      const recorded: RecordedRequest = { body, headers: req.headers };
      requests.push(recorded);
      const waiter = waiters.shift();
      if (waiter) waiter(recorded);
      const respond = (): void => {
        res.statusCode = opts.status ?? 200;
        res.setHeader('content-type', 'application/json');
        res.end(JSON.stringify({ ingested: 1, offsets: [1] }));
      };
      if (opts.delayMs) {
        setTimeout(respond, opts.delayMs);
      } else {
        respond();
      }
    });
  });

  await new Promise<void>((resolve) =>
    server.listen(0, '127.0.0.1', () => resolve()),
  );
  const port = (server.address() as AddressInfo).port;

  return {
    port,
    close: () => new Promise<void>((resolve) => server.close(() => resolve())),
    requests,
    resolveNextRequest: () =>
      new Promise<RecordedRequest>((resolve) => waiters.push(resolve)),
  };
}

const TEST_SECRET = 'a'.repeat(40);

describe('mentor-emit', () => {
  let server: Awaited<ReturnType<typeof startCapturingServer>> | null = null;

  beforeEach(() => {
    __resetEmitterConfig();
  });

  afterEach(async () => {
    // Drain any in-flight setImmediate dispatches BEFORE we tear down the
    // server / config — otherwise a queued emit from this test would race
    // into the next test's freshly-configured server.
    await new Promise((r) => setImmediate(r));
    await new Promise((r) => setImmediate(r));
    if (server) {
      await server.close();
      server = null;
    }
    __resetEmitterConfig();
  });

  describe('newDecisionId / newClaudeRequestId', () => {
    it('mints unique decision ids', () => {
      const ids = new Set<string>();
      for (let i = 0; i < 50; i++) ids.add(newDecisionId());
      expect(ids.size).toBe(50);
      for (const id of ids) expect(id).toMatch(/^dec_[a-z0-9]+_[a-z0-9]+$/);
    });

    it('mints unique claude-request ids', () => {
      const ids = new Set<string>();
      for (let i = 0; i < 50; i++) ids.add(newClaudeRequestId());
      expect(ids.size).toBe(50);
      for (const id of ids) expect(id).toMatch(/^creq_[a-z0-9]+_[a-z0-9]+$/);
    });
  });

  describe('emitMentorEvent', () => {
    it('no-ops silently when secret is unset', async () => {
      // No config set at all — explicit __setEmitterConfigForTests omitted.
      // Force the env to have no secret so the resolved config is `null`
      // (otherwise a stray CAIA_EVENT_BUS_SECRET in the dev machine env
      // would make this test reach the network).
      const savedSecret = process.env['CAIA_EVENT_BUS_SECRET'];
      const savedPath = process.env['CAIA_EVENT_BUS_SECRET_PATH'];
      delete process.env['CAIA_EVENT_BUS_SECRET'];
      delete process.env['CAIA_EVENT_BUS_SECRET_PATH'];
      try {
        expect(() =>
          emitMentorEvent('RouterDecision', {
            decisionId: 'dec_test',
            modelChosen: 'qwen2.5-coder:7b',
            provider: 'ollama',
            displacementClass: 'local',
            latencyMs: 5,
          }),
        ).not.toThrow();
        // Drain the setImmediate queue so this test's dispatch resolves
        // BEFORE the next test reconfigures the emitter — otherwise the
        // queued setImmediate would fire with the next test's server URL.
        await new Promise((r) => setImmediate(r));
      } finally {
        if (savedSecret !== undefined) process.env['CAIA_EVENT_BUS_SECRET'] = savedSecret;
        if (savedPath !== undefined) process.env['CAIA_EVENT_BUS_SECRET_PATH'] = savedPath;
      }
    });

    it('POSTs a signed event to the configured base URL', async () => {
      server = await startCapturingServer();
      __setEmitterConfigForTests({
        baseUrl: `http://127.0.0.1:${server.port}`,
        secret: TEST_SECRET,
        timeoutMs: 1_000,
      });

      const captured = server.resolveNextRequest();
      emitMentorEvent('RouterDecision', {
        decisionId: 'dec_abc',
        modelChosen: 'qwen2.5-coder:7b',
        provider: 'ollama',
        displacementClass: 'local',
        latencyMs: 42,
      });
      const req = await captured;

      // The wrapper must wrap the event into { events: [...] }.
      const parsed = JSON.parse(req.body) as { events: Array<Record<string, unknown>> };
      expect(parsed.events).toHaveLength(1);
      const event = parsed.events[0]!;
      expect(event['event_type']).toBe('RouterDecision');
      const payload = JSON.parse(event['payload_json'] as string) as Record<string, unknown>;
      expect(payload['decisionId']).toBe('dec_abc');
      expect(payload['provider']).toBe('ollama');
      expect(payload['displacementClass']).toBe('local');
      expect(payload['latencyMs']).toBe(42);

      // Signature must match the HMAC over `${ts}:${body}`.
      const ts = req.headers['x-caia-timestamp'];
      const sig = req.headers['x-caia-signature'];
      expect(typeof ts).toBe('string');
      expect(typeof sig).toBe('string');
      const expected = createHmac('sha256', TEST_SECRET)
        .update(`${ts as string}:${req.body}`)
        .digest('hex');
      expect(sig).toBe(expected);
    });

    it('swallows server errors and never throws', async () => {
      server = await startCapturingServer({ status: 500 });
      __setEmitterConfigForTests({
        baseUrl: `http://127.0.0.1:${server.port}`,
        secret: TEST_SECRET,
        timeoutMs: 1_000,
      });

      expect(() =>
        emitMentorEvent('Compression', {
          stage: 'router.prompt',
          inputChars: 100,
          outputChars: 80,
          ratio: 0.8,
          method: 'headroom',
        }),
      ).not.toThrow();

      // Yield once to let setImmediate dispatch fire.
      await new Promise((r) => setImmediate(r));
      // We don't get a strong assertion that the request was made (server
      // counts may race the test), but the absence of a throw is the
      // contract.
    });

    it('swallows connection-refused (server down) without throwing', () => {
      // Point at a port nothing is listening on.
      __setEmitterConfigForTests({
        baseUrl: 'http://127.0.0.1:1',
        secret: TEST_SECRET,
        timeoutMs: 100,
      });

      expect(() =>
        emitMentorEvent('ClaudeRequest', {
          requestId: 'creq_x',
          model: 'claude-sonnet-4-6',
          systemPromptHash: 'deadbeef',
          messageCount: 1,
        }),
      ).not.toThrow();
    });

    it('does not block the caller (returns synchronously)', async () => {
      server = await startCapturingServer({ delayMs: 200 });
      __setEmitterConfigForTests({
        baseUrl: `http://127.0.0.1:${server.port}`,
        secret: TEST_SECRET,
        timeoutMs: 1_000,
      });

      const start = Date.now();
      emitMentorEvent('ClaudeDuration', {
        requestId: 'creq_x',
        startTs: new Date().toISOString(),
        endTs: new Date().toISOString(),
        wallMs: 0,
        ok: true,
      });
      const elapsed = Date.now() - start;
      // The HTTP call adds at least 200ms server-side, but the emit call
      // itself must return in well under 50ms.
      expect(elapsed).toBeLessThan(50);
    });

    it('respects override base URL via setEmitterConfigForTests', async () => {
      server = await startCapturingServer();
      __setEmitterConfigForTests({
        baseUrl: `http://127.0.0.1:${server.port}`,
        secret: TEST_SECRET,
      });
      const captured = server.resolveNextRequest();
      emitMentorEvent('Compression', {
        stage: 'router.prompt.stage1',
        inputChars: 1000,
        outputChars: 500,
        ratio: 0.5,
        method: 'dedupe',
      });
      await captured;
      expect(server.requests.length).toBe(1);
    });
  });

  describe('integration with the router (route() → emit path)', () => {
    it('emits a RouterDecision when route() finishes', async () => {
      // Lazy import inside the test so the module-load side effects don't
      // run before __setEmitterConfigForTests.
      server = await startCapturingServer();
      __setEmitterConfigForTests({
        baseUrl: `http://127.0.0.1:${server.port}`,
        secret: TEST_SECRET,
      });

      const { route, __setAdapters } = await import('../src/router.js');
      __setAdapters(
        {
          isAvailable: vi.fn().mockResolvedValue(true),
          generate: vi.fn().mockResolvedValue({
            response: 'ok',
            model: 'qwen2.5-coder:7b',
            provider: 'local',
            durationMs: 5,
          }),
        } as never,
        null,
      );

      const waiter = server.resolveNextRequest();
      await route('domain-classification', 'hello world');
      const req = await waiter;

      const parsed = JSON.parse(req.body) as { events: Array<{ event_type: string; payload_json: string }> };
      expect(parsed.events[0]!.event_type).toBe('RouterDecision');
      const payload = JSON.parse(parsed.events[0]!.payload_json) as Record<string, unknown>;
      expect(payload['caiaTaskType']).toBe('domain-classification');
      expect(payload['displacementClass']).toBe('local');
      expect(payload['provider']).toBe('ollama');
      expect(typeof payload['decisionId']).toBe('string');
      expect(typeof payload['latencyMs']).toBe('number');
    });
  });
});
