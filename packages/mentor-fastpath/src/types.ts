/**
 * Shared types for the Mentor Phase-1 reactive fast-path.
 *
 * The fast-path subscribes to OperatorCorrection events from the Mentor
 * event bus, classifies the failure mode against the 18-category
 * taxonomy from `agent/memory/mentor_agent_directive.md`, and proposes a
 * durable lesson.
 *
 * This module exports the type surface only; classifier + consumer
 * implementations live in their own modules and depend on these types.
 */

/**
 * The 18 failure-mode categories from the Mentor directive. New
 * categories may be added as Mentor encounters novel patterns; treat the
 * list as extensible (do not hard-code its size in switch statements).
 *
 * Order matches `mentor_agent_directive.md` for ease of cross-reference.
 */
export type FailureMode =
  | 'Hallucination'
  | 'ScopeMismatch'
  | 'Incompleteness'
  | 'WrongDirection'
  | 'LackingInformation'
  | 'CoordinationFailure'
  | 'GitHygieneFailure'
  | 'CostOverrun'
  | 'SecurityRegression'
  | 'OperatorConfusion'
  | 'PrematureCompletion'
  | 'ReLitigation'
  | 'DecisionClassifierViolation'
  | 'MemoryDrift'
  | 'FalseModesty'
  | 'RecipeRot'
  | 'ToolMisuse'
  | 'CIFlakeAsRealFailure'
  /** Catch-all when no rule matches (consumer escalates to LLM verify in later PR). */
  | 'Unclassified';

/**
 * Severity of the failure as inferred from the correction text. Used
 * downstream by the synthesizer to decide whether the lesson should be
 * auto-applied or surfaced for operator review.
 */
export type Severity = 'low' | 'medium' | 'high';

/**
 * Generalizability — does this look like a one-off slip or a systemic
 * pattern the same agent may repeat?
 */
export type Generalizability = 'one-off' | 'systemic' | 'unknown';

/**
 * Classification result returned by `classifyCorrection`. The shape is
 * intentionally narrow for Phase-1; future PRs add LLM-verified
 * confidence scores + secondary tags.
 */
export interface ClassificationResult {
  /** Primary failure-mode category. */
  primary: FailureMode;
  /** Zero or more secondary tags drawn from the same taxonomy. */
  secondary: FailureMode[];
  /** Inferred severity. Conservative default: 'medium'. */
  severity: Severity;
  /**
   * Inferred generalizability. Phase-1 leaves this 'unknown' for most
   * inputs; pattern-recognition logic in Phase-4 fills it in.
   */
  generalizability: Generalizability;
  /**
   * The regex pattern (or 'fallback' / 'manual-tag') that matched. Useful
   * for debugging classifier coverage gaps and for downstream LLM-verify
   * prompting in later PRs.
   */
  matchedBy: string;
  /**
   * 0..1 confidence score — Phase-1 uses 1.0 for exact regex matches and
   * 0.0 for the 'Unclassified' fallback. LLM verification in later PRs
   * produces intermediate scores.
   */
  confidence: number;
}

/**
 * The shape of an `OperatorCorrection` event payload as defined in the
 * mentor-event-bus. Re-declared here so this package doesn't have to
 * import all of mentor-event-bus's type surface — which would create an
 * unwanted dependency cycle later when fastpath becomes part of the bus
 * substrate's distribution.
 */
export interface OperatorCorrectionInput {
  /** Free-form text of the operator's correction. */
  correctionText: string;
  /** Optional context: chat-message that prompted the correction. */
  context?: string;
  /** Detection mode — manual via CLI, regex auto, or LLM-verified. */
  detectionMode?: 'manual' | 'regex' | 'llm';
}

/**
 * The minimal shape of an event row as returned by the mentor-event-bus
 * sqlite query helpers. Re-declared narrowly so this module only depends
 * on what it actually consumes.
 */
export interface EventRow {
  id: string;
  event_type: string;
  schema_version: number;
  correlation_id: string | null;
  parent_event_id: string | null;
  emitted_at: string;
  hostname: string;
  process_name: string | null;
  payload_json: string;
  validation_failed: 0 | 1;
  ingest_offset: number;
}

/**
 * A processed-event record persisted by the consumer's offset store.
 * Used to resume from the last-seen offset across daemon restarts and
 * to record the classifier outcome for later audit.
 */
export interface ProcessedRecord {
  /** OperatorCorrection event id (FK to events table). */
  event_id: string;
  /** Mirror of the event's ingest_offset for fast cursor advance. */
  ingest_offset: number;
  /** When the consumer processed it. */
  processed_at: string;
  /** Serialised ClassificationResult JSON. */
  classification_json: string;
  /** Optional next-stage artifact id (memory file path, PR number, etc.). */
  artifact_ref: string | null;
}
