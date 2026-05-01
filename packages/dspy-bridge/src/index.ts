// Public API for @chiefaia/dspy-bridge

export { DspyBridge, DspyBridgeError } from './bridge.js';
export type { DspyBridgeOptions } from './bridge.js';
export type {
  CompileParams,
  CompileResult,
  DspyMethod,
  DspyRequest,
  DspyResponse,
  DspyResponseErr,
  DspyResponseOk,
  ListProgramsResult,
  LoadProgramParams,
  LoadProgramResult,
  PingParams,
  PingResult,
  PredictParams,
  PredictResult,
  RequestId,
} from './protocol.js';

// ─── Typed program wrappers ─────────────────────────────────────────────
//
// One file per registered DSPy program. The orchestrator imports these
// rather than calling `bridge.predict(...)` directly so the Node side
// stays type-safe across the JSONL boundary.
export {
  runPoScopeDetector,
  PoScopeDetectorError,
  SCOPE_VOCAB,
  PO_SCOPE_DETECTOR_PROGRAM,
} from './programs/po-scope-detector.js';
export type {
  PoScopeDetectorInput,
  PoScopeDetectorOutput,
  StoryScope,
} from './programs/po-scope-detector.js';
