/**
 * Typed Node-side wrapper around the DSPy `po-scope-detector` program.
 *
 * This is the ONLY supported entry point from the rest of CAIA into
 * the DSPy substrate for scope detection. The orchestrator (PR5)
 * routes through `runPoScopeDetector(...)` instead of the raw
 * structured-output helper when the runtime feature flag is on.
 *
 * Wire-shape mirrors the Python side
 * (caia_dspy_bridge/programs/po_scope_detector.py).
 */

import type { DspyBridge } from '../bridge.js';

/** The six scopes the detector can return, largest to smallest. */
export const SCOPE_VOCAB = [
  'initiative',
  'epic',
  'module',
  'story',
  'task',
  'subtask',
] as const;
export type StoryScope = (typeof SCOPE_VOCAB)[number];

/** Stable program-name used by the bridge / storage / cron / docs. */
export const PO_SCOPE_DETECTOR_PROGRAM = 'po-scope-detector';

export interface PoScopeDetectorInput {
  promptText: string;
  /** Optional pre-extracted vision-doc theme summary. */
  visionDocSummary?: string;
}

export interface PoScopeDetectorOutput {
  targetScope: StoryScope;
  confidence: number;
  rationale: string;
  /** Telemetry — concrete model that produced the verdict. */
  model: string;
  /** Wall-clock ms of the predict call. */
  durationMs: number;
}

export class PoScopeDetectorError extends Error {
  public override readonly cause: unknown;
  constructor(message: string, cause?: unknown) {
    super(`[po-scope-detector] ${message}`);
    this.name = 'PoScopeDetectorError';
    if (cause !== undefined) {
      this.cause = cause;
    }
  }
}

/**
 * Run the DSPy `po-scope-detector` program against a single prompt.
 *
 * The bridge resolves `version: 'latest'` to whatever
 * `~/.caia/dspy/compiled/po-scope-detector/CURRENT` points at.
 * If no compiled version exists yet, the Python server falls back to
 * the uncompiled `dspy.ChainOfThought` over the same Signature — so
 * this function works on day one, before any compile lands.
 */
export async function runPoScopeDetector(
  bridge: DspyBridge,
  input: PoScopeDetectorInput,
  options: { version?: string } = {},
): Promise<PoScopeDetectorOutput> {
  const result = await bridge.predict({
    program: PO_SCOPE_DETECTOR_PROGRAM,
    version: options.version ?? 'latest',
    input: {
      promptText: input.promptText,
      ...(input.visionDocSummary ? { visionDocSummary: input.visionDocSummary } : {}),
    },
  });

  const out = result.output;
  const targetScope = String(out.targetScope ?? '').toLowerCase();
  if (!isScope(targetScope)) {
    throw new PoScopeDetectorError(
      `model returned an invalid scope: ${JSON.stringify(out.targetScope)}. ` +
        `Expected one of: ${SCOPE_VOCAB.join(', ')}.`,
      out,
    );
  }
  const confidence = clamp01(Number(out.confidence ?? 0.5));
  const rationale = String(out.rationale ?? '(no rationale)').trim();

  return {
    targetScope,
    confidence,
    rationale,
    model: result.model,
    durationMs: result.durationMs,
  };
}

function isScope(value: string): value is StoryScope {
  return (SCOPE_VOCAB as readonly string[]).includes(value);
}

function clamp01(n: number): number {
  if (Number.isNaN(n)) return 0.5;
  if (n < 0) return 0;
  if (n > 1) return 1;
  return n;
}
