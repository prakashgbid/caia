import { describe, it, expect } from 'vitest';

import type {
  CompileParams,
  CompileResult,
  DspyRequest,
  DspyResponseErr,
  DspyResponseOk,
  PredictParams,
  PredictResult,
} from '../src/protocol.js';

describe('protocol shapes', () => {
  it('round-trips a typed predict request as JSON', () => {
    const req: DspyRequest<PredictParams> = {
      id: 'r-1',
      method: 'predict',
      params: {
        program: 'po-scope-detector',
        version: 'latest',
        input: { promptText: 'add a logout button' },
      },
    };
    const wire = JSON.stringify(req);
    const back = JSON.parse(wire) as DspyRequest<PredictParams>;
    expect(back.method).toBe('predict');
    expect(back.params.program).toBe('po-scope-detector');
    expect(back.params.input).toEqual({ promptText: 'add a logout button' });
  });

  it('discriminates ok vs err responses on .ok', () => {
    const ok: DspyResponseOk<PredictResult> = {
      id: 'r-1',
      ok: true,
      result: {
        output: { targetScope: 'story' },
        model: 'qwen2.5-coder:7b',
        durationMs: 42,
      },
    };
    const err: DspyResponseErr = {
      id: 'r-2',
      ok: false,
      error: { code: 'no-program', message: 'not built yet' },
    };
    expect(ok.ok).toBe(true);
    expect(err.ok).toBe(false);
    if (ok.ok) {
      expect(ok.result.model).toBe('qwen2.5-coder:7b');
    }
    if (!err.ok) {
      expect(err.error.code).toBe('no-program');
    }
  });

  it('CompileResult.delta is null on first compile, number after', () => {
    const first: CompileResult = {
      program: 'po-scope-detector',
      pickle: '/x/po-scope-detector-v1.pkl',
      version: 'v1',
      newScore: 0.6,
      prevScore: null,
      delta: null,
    };
    const second: CompileResult = {
      ...first,
      pickle: '/x/po-scope-detector-v2.pkl',
      version: 'v2',
      newScore: 0.72,
      prevScore: 0.6,
      delta: 0.12,
    };
    expect(first.delta).toBeNull();
    expect(second.delta).toBeCloseTo(0.12, 5);
  });

  it('CompileParams pins the optimizer literal (P0 = miprov2)', () => {
    const p: CompileParams = {
      program: 'po-scope-detector',
      optimizer: 'miprov2',
      trainsetPath: '/tmp/train.jsonl',
      evalsetPath: '/tmp/eval.jsonl',
      outDir: '/tmp/out',
    };
    // @ts-expect-error — anything other than 'miprov2' is rejected at build time.
    const bad: CompileParams = { ...p, optimizer: 'gepa' };
    void bad;
    expect(p.optimizer).toBe('miprov2');
  });
});
