import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';

import { recordTrace } from '../src/traces.js';
import {
  defaultPromotePolicy,
  renderVerdictLine,
  runDailyCompile,
  type CompileVerdict,
} from '../src/compile.js';
import type { DspyBridge } from '../src/bridge.js';
import type { CompileResult } from '../src/protocol.js';

function fakeBridgeYielding(result: CompileResult): {
  bridge: DspyBridge;
  startSpy: ReturnType<typeof vi.fn>;
  stopSpy: ReturnType<typeof vi.fn>;
  compileSpy: ReturnType<typeof vi.fn>;
} {
  const startSpy = vi.fn(async () => undefined);
  const stopSpy = vi.fn(async () => undefined);
  const compileSpy = vi.fn(async () => result);
  const bridge = {
    start: startSpy,
    stop: stopSpy,
    compile: compileSpy,
  } as unknown as DspyBridge;
  return { bridge, startSpy, stopSpy, compileSpy };
}

describe('runDailyCompile', () => {
  let traceRoot: string;
  let compiledRoot: string;
  beforeEach(() => {
    traceRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'dspy-trace-'));
    compiledRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'dspy-compiled-'));
  });
  afterEach(() => {
    fs.rmSync(traceRoot, { recursive: true, force: true });
    fs.rmSync(compiledRoot, { recursive: true, force: true });
  });

  function tap(promptText: string, scope: string, isoTs: string) {
    recordTrace(
      'po-scope-detector',
      {
        version: 'uncompiled',
        input: { promptText },
        output: { targetScope: scope, confidence: 0.85, rationale: 'stub' },
        ok: true,
        model: 'qwen2.5-coder:7b',
        durationMs: 17,
      },
      { root: traceRoot, nowDateIso: () => isoTs },
    );
  }

  it('promotes on first compile (delta=null)', async () => {
    const nowIso = '2026-04-30T18:00:00.000Z';
    const nowMs = Date.parse(nowIso);
    tap('add a logout button', 'story', '2026-04-30T08:00:00.000Z');
    tap('refactor the auth module', 'task', '2026-04-30T09:00:00.000Z');

    const { bridge, compileSpy } = fakeBridgeYielding({
      program: 'po-scope-detector',
      pickle: path.join(compiledRoot, 'po-scope-detector', 'po-scope-detector-v1.pkl'),
      version: 'v1',
      newScore: 0.71,
      prevScore: null,
      delta: null,
    });

    const verdict = await runDailyCompile({
      bridge,
      traceRoot,
      compiledRoot,
      nowMs: () => nowMs,
    });

    expect(verdict.promoted).toBe(true);
    expect(verdict.newVersion).toBe('v1');
    expect(verdict.delta).toBeNull();
    expect(compileSpy).toHaveBeenCalledOnce();
    expect(fs.readFileSync(
      path.join(compiledRoot, 'po-scope-detector', 'CURRENT'), 'utf8',
    ).trim()).toBe('v1');
  });

  it('promotes when delta >= 0', async () => {
    tap('add a logout button', 'story', '2026-04-30T08:00:00.000Z');
    const { bridge } = fakeBridgeYielding({
      program: 'po-scope-detector',
      pickle: path.join(compiledRoot, 'po-scope-detector', 'po-scope-detector-v3.pkl'),
      version: 'v3',
      newScore: 0.78,
      prevScore: 0.74,
      delta: 0.04,
    });
    const verdict = await runDailyCompile({
      bridge,
      traceRoot,
      compiledRoot,
      nowMs: () => Date.parse('2026-04-30T18:00:00.000Z'),
    });
    expect(verdict.promoted).toBe(true);
    expect(verdict.delta).toBeCloseTo(0.04);
    expect(fs.readFileSync(
      path.join(compiledRoot, 'po-scope-detector', 'CURRENT'), 'utf8',
    ).trim()).toBe('v3');
  });

  it('rolls back when delta < 0', async () => {
    tap('add a logout button', 'story', '2026-04-30T08:00:00.000Z');
    const { bridge } = fakeBridgeYielding({
      program: 'po-scope-detector',
      pickle: path.join(compiledRoot, 'po-scope-detector', 'po-scope-detector-v4.pkl'),
      version: 'v4',
      newScore: 0.65,
      prevScore: 0.74,
      delta: -0.09,
    });
    const verdict = await runDailyCompile({
      bridge,
      traceRoot,
      compiledRoot,
      nowMs: () => Date.parse('2026-04-30T18:00:00.000Z'),
    });
    expect(verdict.promoted).toBe(false);
    expect(verdict.delta).toBeCloseTo(-0.09);
    // CURRENT must NOT exist (no prior promote in this test, and we
    // didn't promote this one either).
    const cur = path.join(compiledRoot, 'po-scope-detector', 'CURRENT');
    expect(fs.existsSync(cur)).toBe(false);
  });

  it('writes a JSONL audit-log row to compiles.log', async () => {
    tap('any', 'task', '2026-04-30T08:00:00.000Z');
    const { bridge } = fakeBridgeYielding({
      program: 'po-scope-detector',
      pickle: 'p',
      version: 'v1',
      newScore: 0.5,
      prevScore: null,
      delta: null,
    });
    await runDailyCompile({
      bridge,
      traceRoot,
      compiledRoot,
      nowMs: () => Date.parse('2026-04-30T18:00:00.000Z'),
    });
    const log = fs.readFileSync(path.join(compiledRoot, 'compiles.log'), 'utf8');
    const lines = log.trim().split('\n').filter(Boolean);
    expect(lines).toHaveLength(1);
    expect(JSON.parse(lines[0] as string)).toMatchObject({
      program: 'po-scope-detector',
      newVersion: 'v1',
      promoted: true,
    });
  });

  it('respects a custom promotePolicy', async () => {
    tap('any', 'task', '2026-04-30T08:00:00.000Z');
    const { bridge } = fakeBridgeYielding({
      program: 'po-scope-detector',
      pickle: 'p',
      version: 'v2',
      newScore: 0.99,
      prevScore: 0.5,
      delta: 0.49,
    });
    const verdict = await runDailyCompile({
      bridge,
      traceRoot,
      compiledRoot,
      nowMs: () => Date.parse('2026-04-30T18:00:00.000Z'),
      // refuse promotion no matter what
      promotePolicy: () => false,
    });
    expect(verdict.promoted).toBe(false);
  });

  it('honours externallyManagedBridge — never start/stop the bridge', async () => {
    tap('any', 'task', '2026-04-30T08:00:00.000Z');
    const { bridge, startSpy, stopSpy } = fakeBridgeYielding({
      program: 'po-scope-detector',
      pickle: 'p',
      version: 'v1',
      newScore: 0.5,
      prevScore: null,
      delta: null,
    });
    await runDailyCompile({
      bridge,
      traceRoot,
      compiledRoot,
      externallyManagedBridge: true,
      nowMs: () => Date.parse('2026-04-30T18:00:00.000Z'),
    });
    expect(startSpy).not.toHaveBeenCalled();
    expect(stopSpy).not.toHaveBeenCalled();
  });
});

describe('defaultPromotePolicy', () => {
  it('promotes on first compile', () => {
    expect(
      defaultPromotePolicy({ delta: null } as CompileVerdict),
    ).toBe(true);
  });
  it('promotes when delta == 0', () => {
    expect(
      defaultPromotePolicy({ delta: 0 } as CompileVerdict),
    ).toBe(true);
  });
  it('promotes when delta > 0', () => {
    expect(
      defaultPromotePolicy({ delta: 0.0001 } as CompileVerdict),
    ).toBe(true);
  });
  it('rolls back when delta < 0', () => {
    expect(
      defaultPromotePolicy({ delta: -0.0001 } as CompileVerdict),
    ).toBe(false);
  });
});

describe('renderVerdictLine', () => {
  it('prints first-compile line', () => {
    const line = renderVerdictLine({
      program: 'po-scope-detector',
      newVersion: 'v1',
      newPickle: 'p',
      newScore: 0.71,
      prevScore: null,
      delta: null,
      promoted: true,
      trainsetSize: 14,
      finishedAtIso: '2026-04-30T18:00:00.000Z',
    });
    expect(line).toContain('promoted v1');
    expect(line).toContain('Δ=—');
    expect(line).toContain('next=0.710');
    expect(line).toContain('train=14');
  });
  it('prints rollback line', () => {
    const line = renderVerdictLine({
      program: 'po-scope-detector',
      newVersion: 'v4',
      newPickle: 'p',
      newScore: 0.65,
      prevScore: 0.74,
      delta: -0.09,
      promoted: false,
      trainsetSize: 23,
      finishedAtIso: '2026-04-30T18:00:00.000Z',
    });
    expect(line).toContain('rolled-back');
    expect(line).toContain('Δ=-0.090');
  });
});
