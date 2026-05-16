import { EventEmitter } from 'node:events';
import { Readable, Writable } from 'node:stream';
import { describe, expect, it, vi } from 'vitest';

import {
  buildLogLine,
  decideRoute,
  hashPrompt,
  parseClaudeWrapArgs,
  runClaudeWrap,
  synthesiseClaudeJsonEnvelope,
  type ClaudeWrapDeps,
} from '../src/index.js';

describe('parseClaudeWrapArgs', () => {
  it('detects --help', () => {
    expect(parseClaudeWrapArgs(['--help']).wantHelp).toBe(true);
    expect(parseClaudeWrapArgs(['-h']).wantHelp).toBe(true);
  });

  it('strips wrapper-only flags from passthroughArgv', () => {
    const out = parseClaudeWrapArgs(['--prompt-file', '/tmp/p.txt', '--wrap-disable', '--print', '--max-turns', '5']);
    expect(out.promptFile).toBe('/tmp/p.txt');
    expect(out.wrapDisable).toBe(true);
    expect(out.passthroughArgv).toEqual(['--print', '--max-turns', '5']);
  });

  it('keeps --output-format in passthroughArgv AND captures format', () => {
    const out = parseClaudeWrapArgs(['--print', '--output-format', 'json']);
    expect(out.outputFormat).toBe('json');
    expect(out.passthroughArgv).toEqual(['--print', '--output-format', 'json']);
  });

  it('honours --output-format=json long-form', () => {
    const out = parseClaudeWrapArgs(['--output-format=json']);
    expect(out.outputFormat).toBe('json');
    expect(out.passthroughArgv).toEqual(['--output-format=json']);
  });

  it('defaults outputFormat to text', () => {
    expect(parseClaudeWrapArgs(['--print']).outputFormat).toBe('text');
  });
});

describe('decideRoute', () => {
  const baseLocal = {
    choices: [{ message: { content: 'hello world' }, finish_reason: 'stop' }],
    model: 'qwen2.5:7b',
    caia: { provider: 'local' as const, duration_ms: 100 },
  };

  it('returns local on clean local response', () => {
    expect(decideRoute(200, baseLocal)).toEqual({
      route: 'local',
      content: 'hello world',
      model: 'qwen2.5:7b',
      finishReason: 'stop',
    });
  });

  it('escalates on non-2xx http status', () => {
    expect(decideRoute(500, baseLocal)).toEqual({ route: 'escalate', reason: 'router_fail', model: null });
    expect(decideRoute(404, baseLocal)).toEqual({ route: 'escalate', reason: 'router_fail', model: null });
  });

  it('escalates on null body', () => {
    expect(decideRoute(200, null).route).toBe('escalate');
  });

  it('escalates when provider !== local', () => {
    const claudeResp = { ...baseLocal, caia: { provider: 'claude' as const } };
    expect(decideRoute(200, claudeResp)).toEqual({ route: 'escalate', reason: 'provider_claude', model: 'qwen2.5:7b' });
  });

  it('escalates on empty content', () => {
    const empty = { ...baseLocal, choices: [{ message: { content: '' }, finish_reason: 'stop' }] };
    expect(decideRoute(200, empty)).toEqual({
      route: 'escalate',
      reason: 'content_unusable',
      model: 'qwen2.5:7b',
    });
  });

  it('escalates on unknown finish_reason', () => {
    const bad = { ...baseLocal, choices: [{ message: { content: 'ok' }, finish_reason: 'content_filter' }] };
    expect(decideRoute(200, bad)).toEqual({
      route: 'escalate',
      reason: 'content_unusable',
      model: 'qwen2.5:7b',
    });
  });

  it('accepts length / end_turn / tool_use as finish reasons', () => {
    for (const fr of ['length', 'end_turn', 'tool_use']) {
      const r = { ...baseLocal, choices: [{ message: { content: 'ok' }, finish_reason: fr }] };
      expect(decideRoute(200, r).route).toBe('local');
    }
  });

  it('escalates when body has an error envelope', () => {
    expect(decideRoute(200, { error: 'foo' }).route).toBe('escalate');
  });
});

describe('synthesiseClaudeJsonEnvelope', () => {
  it('produces a claude --print --output-format json compatible envelope', () => {
    const env = JSON.parse(synthesiseClaudeJsonEnvelope('result text', 'qwen2.5:7b'));
    expect(env.type).toBe('result');
    expect(env.subtype).toBe('success');
    expect(env.is_error).toBe(false);
    expect(env.result).toBe('result text');
    expect(env.caia_wrap.provider).toBe('local');
    expect(env.caia_wrap.model).toBe('qwen2.5:7b');
  });
});

describe('buildLogLine + hashPrompt', () => {
  it('hashPrompt is stable for the same input', () => {
    expect(hashPrompt('hello')).toBe(hashPrompt('hello'));
    expect(hashPrompt('hello')).not.toBe(hashPrompt('world'));
    expect(hashPrompt('hello')).toHaveLength(16);
  });

  it('emits a single JSON line ending in \\n', () => {
    const line = buildLogLine({
      timestamp: '2026-05-16T00:00:00Z',
      promptHash: 'abc',
      routeDecision: 'routed_local',
      reason: 'router_latency_ms=42',
      latencyMs: 50,
      modelUsed: 'qwen2.5:7b',
      promptBytes: 5,
      exitCode: 0,
    });
    expect(line.endsWith('\n')).toBe(true);
    const parsed = JSON.parse(line.trim());
    expect(parsed.route_decision).toBe('routed_local');
    expect(parsed.model_used).toBe('qwen2.5:7b');
    expect(parsed.prompt_hash).toBe('abc');
  });
});

/** Fake child that immediately exits on close. */
function makeFakeChild(exitCode = 0): EventEmitter & { stdin: Writable; stdout: Readable; stderr: Readable; kill: () => boolean } {
  const ee = new EventEmitter() as ReturnType<typeof makeFakeChild>;
  ee.stdin = new Writable({
    write(_c, _e, cb): void {
      cb();
    },
  });
  ee.stdout = new Readable({ read(): void {} });
  ee.stderr = new Readable({ read(): void {} });
  ee.kill = (): boolean => true;
  setImmediate(() => ee.emit('close', exitCode, null));
  return ee;
}

function makeDeps(over: Partial<ClaudeWrapDeps> = {}): { deps: ClaudeWrapDeps; stdoutLines: string[]; stderrLines: string[]; logs: string[] } {
  const stdoutLines: string[] = [];
  const stderrLines: string[] = [];
  const logs: string[] = [];
  const deps: ClaudeWrapDeps = {
    argv: [],
    readStdin: async () => 'sample prompt',
    fetchImpl: async () =>
      new Response(
        JSON.stringify({
          choices: [{ message: { content: 'local-answer' }, finish_reason: 'stop' }],
          model: 'qwen2.5:7b',
          caia: { provider: 'local' },
        }),
        { status: 200, headers: { 'Content-Type': 'application/json' } },
      ),
    spawnImpl: vi.fn(() => makeFakeChild(0)) as unknown as ClaudeWrapDeps['spawnImpl'],
    appendLog: (l) => logs.push(l),
    stdoutWrite: (s) => stdoutLines.push(s),
    stderrWrite: (s) => stderrLines.push(s),
    now: () => 0,
    ...over,
  };
  return { deps, stdoutLines, stderrLines, logs };
}

describe('runClaudeWrap', () => {
  it('prints help and returns 0 when --help', async () => {
    const { deps, stdoutLines } = makeDeps({ argv: ['--help'] });
    const result = await runClaudeWrap(deps);
    expect(result.exitCode).toBe(0);
    expect(result.routeDecision).toBe('help');
    expect(stdoutLines.join('')).toMatch(/claude-wrap/);
  });

  it('routes locally and emits content when router returns a clean local response', async () => {
    const { deps, stdoutLines, logs } = makeDeps({ argv: ['--print'] });
    const result = await runClaudeWrap(deps);
    expect(result.exitCode).toBe(0);
    expect(result.routeDecision).toBe('routed_local');
    expect(result.modelUsed).toBe('qwen2.5:7b');
    expect(stdoutLines.join('')).toBe('local-answer');
    expect(logs).toHaveLength(1);
    const log = JSON.parse(logs[0]!.trim());
    expect(log.route_decision).toBe('routed_local');
    expect(log.model_used).toBe('qwen2.5:7b');
  });

  it('synthesises a JSON envelope when --output-format json AND routes local', async () => {
    const { deps, stdoutLines } = makeDeps({ argv: ['--print', '--output-format', 'json'] });
    const result = await runClaudeWrap(deps);
    expect(result.exitCode).toBe(0);
    expect(result.routeDecision).toBe('routed_local');
    const env = JSON.parse(stdoutLines.join(''));
    expect(env.type).toBe('result');
    expect(env.result).toBe('local-answer');
  });

  it('escalates when router returns 5xx', async () => {
    const spawnImpl = vi.fn(() => makeFakeChild(0)) as unknown as ClaudeWrapDeps['spawnImpl'];
    const { deps, logs } = makeDeps({
      argv: ['--print'],
      fetchImpl: async () => new Response('boom', { status: 503 }),
      spawnImpl,
    });
    const result = await runClaudeWrap(deps);
    expect(result.routeDecision).toBe('escalated_router_fail');
    expect(result.exitCode).toBe(0);
    expect(spawnImpl).toHaveBeenCalledTimes(1);
    expect(JSON.parse(logs[0]!.trim()).route_decision).toBe('escalated_router_fail');
  });

  it('escalates when provider is claude', async () => {
    const spawnImpl = vi.fn(() => makeFakeChild(7)) as unknown as ClaudeWrapDeps['spawnImpl'];
    const { deps } = makeDeps({
      argv: ['--print'],
      fetchImpl: async () =>
        new Response(
          JSON.stringify({
            choices: [{ message: { content: 'x' }, finish_reason: 'stop' }],
            model: 'claude-sonnet-4-6',
            caia: { provider: 'claude' },
          }),
          { status: 200, headers: { 'Content-Type': 'application/json' } },
        ),
      spawnImpl,
    });
    const result = await runClaudeWrap(deps);
    expect(result.routeDecision).toBe('escalated_provider_claude');
    expect(result.exitCode).toBe(7);
    expect(spawnImpl).toHaveBeenCalledTimes(1);
  });

  it('escalates immediately when --wrap-disable is set and never calls fetch', async () => {
    const fetchImpl = vi.fn(async () => new Response('{}', { status: 200 })) as unknown as ClaudeWrapDeps['fetchImpl'];
    const spawnImpl = vi.fn(() => makeFakeChild(0)) as unknown as ClaudeWrapDeps['spawnImpl'];
    const { deps } = makeDeps({ argv: ['--wrap-disable', '--print'], fetchImpl, spawnImpl });
    const result = await runClaudeWrap(deps);
    expect(result.routeDecision).toBe('escalated_wrap_disabled');
    expect(fetchImpl).not.toHaveBeenCalled();
    expect(spawnImpl).toHaveBeenCalledTimes(1);
  });

  it('escalates when fetch throws (network error)', async () => {
    const spawnImpl = vi.fn(() => makeFakeChild(0)) as unknown as ClaudeWrapDeps['spawnImpl'];
    const { deps } = makeDeps({
      argv: ['--print'],
      fetchImpl: async () => {
        throw new Error('econnrefused');
      },
      spawnImpl,
    });
    const result = await runClaudeWrap(deps);
    expect(result.routeDecision).toBe('escalated_router_fail');
    expect(spawnImpl).toHaveBeenCalledTimes(1);
  });

  it('never throws even when appendLog throws', async () => {
    const { deps } = makeDeps({
      argv: ['--print'],
      appendLog: () => {
        throw new Error('disk full');
      },
    });
    await expect(runClaudeWrap(deps)).resolves.toBeTruthy();
  });
});
