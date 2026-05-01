/**
 * Runtime-routing tests — DSPy path vs legacy fallback.
 *
 * The DspyBridge is mocked at the module level so these tests don't
 * spin up a Python sub-process. Live DSPy traffic is exercised by the
 * cron itself once the LaunchAgent is loaded.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';

import {
  __resetDspyRuntimeForTests,
  isDspyRuntimeEnabled,
  tryDspyScopeDetect,
} from '../src/dspy-runtime.js';
import { detectScope } from '../src/scope-detector.js';

import {
  fakeOllama,
  fakeClaude,
  installFakeAdapters,
  clearAdapters,
  jsonResponse,
} from './_helpers.js';

vi.mock('@chiefaia/dspy-bridge', async () => {
  // We replace runPoScopeDetector / DspyBridge / recordTrace with stubs
  // that the test controls via global hooks. The real implementations
  // are exercised by `@chiefaia/dspy-bridge`'s own test suite.
  return {
    DspyBridge: class FakeBridge {
      // eslint-disable-next-line @typescript-eslint/no-empty-function
      async start(): Promise<void> {}
      // eslint-disable-next-line @typescript-eslint/no-empty-function
      async stop(): Promise<void> {}
    },
    PoScopeDetectorError: class extends Error {},
    runPoScopeDetector: vi.fn(),
    recordTrace: vi.fn(),
  };
});

import { runPoScopeDetector, recordTrace } from '@chiefaia/dspy-bridge';

const runPoScopeDetectorMock = runPoScopeDetector as unknown as ReturnType<typeof vi.fn>;
const recordTraceMock = recordTrace as unknown as ReturnType<typeof vi.fn>;

describe('isDspyRuntimeEnabled', () => {
  const origRuntime = process.env['CAIA_DSPY_RUNTIME'];
  let pointerDir: string;

  beforeEach(() => {
    delete process.env['CAIA_DSPY_RUNTIME'];
    pointerDir = fs.mkdtempSync(path.join(os.tmpdir(), 'dspy-runtime-flag-'));
  });
  afterEach(() => {
    if (origRuntime !== undefined) process.env['CAIA_DSPY_RUNTIME'] = origRuntime;
    else delete process.env['CAIA_DSPY_RUNTIME'];
    fs.rmSync(pointerDir, { recursive: true, force: true });
  });

  it('respects CAIA_DSPY_RUNTIME=1', () => {
    process.env['CAIA_DSPY_RUNTIME'] = '1';
    expect(isDspyRuntimeEnabled()).toBe(true);
  });

  it('respects CAIA_DSPY_RUNTIME=0 (force-off even if pointer file exists)', () => {
    process.env['CAIA_DSPY_RUNTIME'] = '0';
    expect(isDspyRuntimeEnabled()).toBe(false);
  });
});

describe('tryDspyScopeDetect', () => {
  beforeEach(() => {
    runPoScopeDetectorMock.mockReset();
    recordTraceMock.mockReset();
    __resetDspyRuntimeForTests();
  });

  it('returns null when runtime is disabled', async () => {
    delete process.env['CAIA_DSPY_RUNTIME'];
    const out = await tryDspyScopeDetect('add a logout button', undefined);
    expect(out).toBeNull();
    expect(runPoScopeDetectorMock).not.toHaveBeenCalled();
  });

  it('returns the bridge verdict when forceEnabled', async () => {
    runPoScopeDetectorMock.mockResolvedValueOnce({
      targetScope: 'story',
      confidence: 0.9,
      rationale: 'one verb, one deliverable',
      model: 'qwen2.5-coder:7b',
      durationMs: 22,
    });
    const out = await tryDspyScopeDetect(
      'add a logout button',
      undefined,
      { forceEnabled: true, bridge: {} as never, disableTraceTap: true },
    );
    expect(out).not.toBeNull();
    expect(out?.targetScope).toBe('story');
    expect(out?.model).toBe('qwen2.5-coder:7b');
  });

  it('records a trace row on the happy path', async () => {
    runPoScopeDetectorMock.mockResolvedValueOnce({
      targetScope: 'task',
      confidence: 0.7,
      rationale: 'one concern',
      model: 'qwen2.5-coder:7b',
      durationMs: 11,
    });
    await tryDspyScopeDetect(
      'rename _x to _internal in foo.ts',
      undefined,
      { forceEnabled: true, bridge: {} as never },
    );
    expect(recordTraceMock).toHaveBeenCalledOnce();
    const args = recordTraceMock.mock.calls[0];
    expect(args?.[0]).toBe('po-scope-detector');
    expect(args?.[1]).toMatchObject({
      ok: true,
      version: 'runtime',
      output: { targetScope: 'task' },
    });
  });

  it('returns null and logs on bridge failure', async () => {
    runPoScopeDetectorMock.mockRejectedValueOnce(new Error('predict timed out'));
    const errSpy = vi.spyOn(process.stderr, 'write').mockImplementation(() => true);
    const out = await tryDspyScopeDetect(
      'whatever',
      undefined,
      { forceEnabled: true, bridge: {} as never },
    );
    expect(out).toBeNull();
    expect(errSpy).toHaveBeenCalled();
    errSpy.mockRestore();
  });
});

describe('detectScope — runtime routing integration', () => {
  beforeEach(() => {
    clearAdapters();
    __resetDspyRuntimeForTests();
    runPoScopeDetectorMock.mockReset();
    recordTraceMock.mockReset();
    delete process.env['CAIA_DSPY_RUNTIME'];
  });
  afterEach(() => {
    clearAdapters();
    delete process.env['CAIA_DSPY_RUNTIME'];
  });

  it('uses legacy path when DSPy runtime is disabled', async () => {
    const ollama = fakeOllama({
      responses: [
        jsonResponse({
          targetScope: 'story',
          confidence: 0.85,
          rationale: 'one verb, one deliverable',
        }),
      ],
    });
    installFakeAdapters(ollama, fakeClaude({ responses: [] }));

    const out = await detectScope({ promptText: 'add a logout button' });
    expect(out.targetScope).toBe('story');
    expect(runPoScopeDetectorMock).not.toHaveBeenCalled();
  });

  it('falls back to legacy when DSPy runtime fails', async () => {
    process.env['CAIA_DSPY_RUNTIME'] = '1';
    runPoScopeDetectorMock.mockRejectedValueOnce(new Error('bridge dead'));
    const errSpy = vi.spyOn(process.stderr, 'write').mockImplementation(() => true);
    const ollama = fakeOllama({
      responses: [
        jsonResponse({
          targetScope: 'task',
          confidence: 0.6,
          rationale: 'fallback',
        }),
      ],
    });
    installFakeAdapters(ollama, fakeClaude({ responses: [] }));

    const out = await detectScope({ promptText: 'rename _x to _internal in foo.ts' });
    expect(out.targetScope).toBe('task');
    errSpy.mockRestore();
  });
});
