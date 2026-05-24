/**
 * @caia/plan-defender — public surface.
 *
 * The Plan Defender pattern: per-submission Claude Code subagent that
 * acts as a faithful proxy for the producing agent whose session has
 * closed. Spawned by EA sub-agents, seeded with the producer's structured
 * context dump, answers Reviewer clarification questions with citations
 * back to the original sources. Loops up to 5 rounds per submission;
 * escalates on strategic-class, producer-never-decided, or
 * consecutive-low-confidence triggers.
 *
 * Reference: research/ea_agent_operational_framework_2026.md §3.
 */

export {
  DEFENDER_ITERATION_CAP,
  CONSECUTIVE_LOW_CONFIDENCE_THRESHOLD
} from './types.js';

export type {
  PlanContextDump,
  DecisionPoint,
  SourceConsulted,
  OpenQuestion,
  AlternativeDropped,
  Assumption,
  DefenderQuestion,
  DefenderAnswer,
  DefenderEscalation,
  DefenderEscalationKind,
  DefenderHandle,
  DialogueLogEntry,
  DefenderSpawnerConfig,
  ResponderAdapter,
  ResponderInput,
  ContextDumpValidationError,
  ContextDumpValidation
} from './types.js';

export {
  PlanDefenderSpawner,
  type AskResult,
  type SpawnResult
} from './spawner.js';

export { PlanDefender, type DefenderSession } from './defender.js';

export {
  DEFENDER_SYSTEM_PROMPT_HEAD,
  buildDefenderPrompt
} from './system-prompt.js';

export {
  loadContextDump,
  validateContextDump,
  normaliseContextDump,
  computeThickness,
  dumpPathForPlan,
  makeStubContextDump
} from './context-dump.js';

export {
  DialogueLog,
  partitionLogByRound,
  type DialogueLogConfig
} from './dialogue-log.js';

export {
  isStrategicQuestion,
  isProducerNeverDecided,
  isConsecutiveLowConfidence,
  detectEscalation
} from './escalation-detector.js';

export {
  createClaudeResponder,
  StubResponder,
  parseDefenderAnswer,
  type ClaudeResponderConfig
} from './responder.js';

export { defaultFs, MemoryFs, type FsLike } from './fs.js';
