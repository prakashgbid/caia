/**
 * Runtime routing — orchestrator switch for the DSPy substrate.
 *
 * The PO scope detector has TWO concrete paths:
 *
 *   1. Legacy: hand-written prompt -> @chiefaia/local-llm-router
 *      (the existing `callStructured()` flow in scope-detector.ts).
 *
 *   2. DSPy: compiled program in ~/.caia/dspy/compiled/po-scope-detector/
 *      reached via @chiefaia/dspy-bridge.
 *
 * The router picks the DSPy path when ALL of the following are true:
 *
 *   - the runtime flag is enabled
 *     (env CAIA_DSPY_RUNTIME=1, or the on-disk pointer
 *      ~/.caia/dspy/runtime/po-scope-detector.enabled exists)
 *   - the DSPy bridge starts cleanly
 *   - the bridge call succeeds
 *
 * On ANY failure the router falls back to the legacy path and emits a
 * structured-log line. This is a *strict opt-in* with strict failure
 * tolerance — the substrate cutover is reversible by removing the
 * pointer file. No service restart needed.
 *
 * Every successful DSPy call writes a trace row via
 * `@chiefaia/dspy-bridge`'s `recordTrace()` so the next compile cron
 * has fresh data — closing the §7 feedback loop end-to-end.
 */

import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';

import {
  DspyBridge,
  PoScopeDetectorError,
  recordTrace,
  runPoScopeDetector,
} from '@chiefaia/dspy-bridge';

import type { ScopeDetection } from './types.js';

export interface DspyRuntimeOptions {
  /**
   * Force-enable the DSPy path regardless of env / pointer file. Used
   * by integration tests that bring up an in-process bridge.
   */
  forceEnabled?: boolean;
  /**
   * Pre-built bridge — bypasses the singleton + lazy-start. Used by
   * tests; production wiring should leave this undefined.
   */
  bridge?: DspyBridge;
  /** Test-seam wall-clock provider. */
  nowDateIso?: () => string;
  /** Disable the trace tap (test-only). */
  disableTraceTap?: boolean;
}

let _singleton: DspyBridge | null = null;
let _starting: Promise<DspyBridge> | null = null;
let _failed = false;

/**
 * Returns true if the DSPy path is enabled by env or pointer file.
 *
 * Cheap (one stat / env-read) — caller is free to check on every call.
 */
export function isDspyRuntimeEnabled(): boolean {
  if (process.env['CAIA_DSPY_RUNTIME'] === '1') return true;
  if (process.env['CAIA_DSPY_RUNTIME'] === '0') return false;
  const pointer = path.join(
    os.homedir(),
    '.caia',
    'dspy',
    'runtime',
    'po-scope-detector.enabled',
  );
  return fs.existsSync(pointer);
}

/**
 * Try the DSPy path. Resolves to null on miss (fall back to legacy);
 * resolves to a ScopeDetection on hit.
 *
 * The "miss" arms:
 *   - runtime flag is off                            -> null
 *   - bridge start failed in this process before     -> null
 *   - bridge start fails this call                   -> null  (sets _failed)
 *   - bridge.predict throws / returns invalid scope  -> null  (logs + counts)
 *
 * Hit:
 *   - returns the ScopeDetection
 *   - writes a trace row for the next compile cycle
 */
export async function tryDspyScopeDetect(
  promptText: string,
  visionDocSummary: string | undefined,
  options: DspyRuntimeOptions = {},
): Promise<ScopeDetection | null> {
  const enabled = options.forceEnabled ?? isDspyRuntimeEnabled();
  if (!enabled) return null;

  let bridge: DspyBridge;
  try {
    bridge = options.bridge ?? (await getOrStartSingleton());
  } catch (err) {
    logFallback('bridge-start-failed', err);
    _failed = true;
    return null;
  }

  try {
    const out = await runPoScopeDetector(bridge, {
      promptText,
      ...(visionDocSummary ? { visionDocSummary } : {}),
    });

    // Trace tap — feed the next compile cycle.
    if (!options.disableTraceTap) {
      try {
        recordTrace(
          'po-scope-detector',
          {
            version: 'runtime',
            input: {
              promptText,
              ...(visionDocSummary ? { visionDocSummary } : {}),
            },
            output: {
              targetScope: out.targetScope,
              confidence: out.confidence,
              rationale: out.rationale,
            },
            ok: true,
            model: out.model,
            durationMs: out.durationMs,
          },
          options.nowDateIso ? { nowDateIso: options.nowDateIso } : {},
        );
      } catch (tapErr) {
        // Trace failure must NEVER break a production call.
        logFallback('trace-tap-failed', tapErr);
      }
    }

    return {
      targetScope: out.targetScope,
      confidence: out.confidence,
      rationale: out.rationale,
      model: out.model,
      durationMs: out.durationMs,
    };
  } catch (err) {
    if (err instanceof PoScopeDetectorError) {
      logFallback('invalid-dspy-output', err);
    } else {
      logFallback('dspy-predict-failed', err);
    }
    return null;
  }
}

async function getOrStartSingleton(): Promise<DspyBridge> {
  if (_failed) {
    throw new Error('DSPy bridge failed to start earlier in this process');
  }
  if (_singleton) return _singleton;
  if (_starting) return _starting;
  _starting = (async () => {
    const bridge = new DspyBridge();
    await bridge.start();
    _singleton = bridge;
    _starting = null;
    return bridge;
  })();
  try {
    return await _starting;
  } catch (err) {
    _starting = null;
    throw err;
  }
}

function logFallback(code: string, err: unknown): void {
  const msg = err instanceof Error ? err.message : String(err);
  process.stderr.write(
    `[decomposer-recursive] dspy fallback (${code}): ${msg}\n`,
  );
}

/**
 * Test seam: dispose the singleton bridge between tests so a fresh
 * one is created. Production code should never call this.
 */
export function __resetDspyRuntimeForTests(): void {
  _singleton = null;
  _starting = null;
  _failed = false;
}
