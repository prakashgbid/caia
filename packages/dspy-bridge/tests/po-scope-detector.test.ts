import { describe, it, expect, vi } from 'vitest';

import {
  PoScopeDetectorError,
  PO_SCOPE_DETECTOR_PROGRAM,
  runPoScopeDetector,
  SCOPE_VOCAB,
} from '../src/programs/po-scope-detector.js';
import type { DspyBridge } from '../src/bridge.js';

function fakeBridge(predictResult: Record<string, unknown>): DspyBridge {
  return {
    predict: vi.fn(async () => ({
      output: predictResult,
      model: 'qwen2.5-coder:7b',
      durationMs: 23,
    })),
  } as unknown as DspyBridge;
}

describe('runPoScopeDetector', () => {
  it('returns a typed output for a story-shaped prompt', async () => {
    const bridge = fakeBridge({
      targetScope: 'story',
      confidence: 0.92,
      rationale: 'one verb, one object, one concrete deliverable',
    });
    const out = await runPoScopeDetector(bridge, {
      promptText: 'add a logout button to the user-menu dropdown',
    });
    expect(out.targetScope).toBe('story');
    expect(out.confidence).toBeCloseTo(0.92);
    expect(out.rationale).toContain('one verb');
    expect(out.model).toBe('qwen2.5-coder:7b');
    expect(out.durationMs).toBe(23);
  });

  it('forwards visionDocSummary to the bridge predict params', async () => {
    const predictMock = vi.fn(async () => ({
      output: { targetScope: 'epic', confidence: 0.7, rationale: 'theme-bound' },
      model: 'qwen2.5-coder:7b',
      durationMs: 11,
    }));
    const bridge = { predict: predictMock } as unknown as DspyBridge;

    await runPoScopeDetector(bridge, {
      promptText: 'Re-vamp checkout',
      visionDocSummary: 'Theme: cart abandonment, single-page checkout',
    });

    expect(predictMock).toHaveBeenCalledOnce();
    expect(predictMock).toHaveBeenCalledWith(
      expect.objectContaining({
        program: PO_SCOPE_DETECTOR_PROGRAM,
        version: 'latest',
        input: expect.objectContaining({
          promptText: 'Re-vamp checkout',
          visionDocSummary: 'Theme: cart abandonment, single-page checkout',
        }),
      }),
    );
  });

  it('respects a pinned version', async () => {
    const predictMock = vi.fn(async () => ({
      output: { targetScope: 'task', confidence: 0.6, rationale: 'one concern' },
      model: 'qwen2.5-coder:7b',
      durationMs: 9,
    }));
    const bridge = { predict: predictMock } as unknown as DspyBridge;

    await runPoScopeDetector(
      bridge,
      { promptText: 'rename _x to _internal in foo.ts' },
      { version: 'v3' },
    );

    expect(predictMock.mock.calls[0]?.[0]?.version).toBe('v3');
  });

  it('throws PoScopeDetectorError on invalid scope', async () => {
    const bridge = fakeBridge({
      targetScope: 'feature', // not in SCOPE_VOCAB
      confidence: 0.7,
      rationale: 'meh',
    });
    await expect(
      runPoScopeDetector(bridge, { promptText: 'whatever' }),
    ).rejects.toBeInstanceOf(PoScopeDetectorError);
  });

  it('clamps confidence into [0, 1]', async () => {
    const bridge = fakeBridge({
      targetScope: 'subtask',
      confidence: 1.7,
      rationale: 'mechanical',
    });
    const out = await runPoScopeDetector(bridge, {
      promptText: 'rename _x to _internal in foo.ts',
    });
    expect(out.confidence).toBe(1);
  });

  it('exports the canonical scope vocab in size order', () => {
    expect(SCOPE_VOCAB).toEqual([
      'initiative',
      'epic',
      'module',
      'story',
      'task',
      'subtask',
    ]);
  });
});
