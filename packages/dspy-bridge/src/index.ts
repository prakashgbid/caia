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

// ─── Trace pipeline (PR3) ───────────────────────────────────────────────
export { recordTrace, readTraces, defaultTraceRoot } from './traces.js';
export type { TraceRow, TraceWriterOptions } from './traces.js';
export { buildTrainset, writeTrainsetJsonl } from './trainset.js';
export type { BuildTrainsetOptions, TrainsetRow } from './trainset.js';
export type { SpendRecord } from './spend-bridge.js';
export {
  PHASE2E_002_FIXTURES,
  fixturesToEvalsetRows,
} from './evalsets/po-scope-detector-phase2e002.js';
export type { Phase2e002Fixture } from './evalsets/po-scope-detector-phase2e002.js';
