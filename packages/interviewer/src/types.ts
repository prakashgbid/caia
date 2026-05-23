/**
 * @caia/interviewer — core type contracts.
 *
 * Mirrors `skills/playbook/business-plan-schema.json` (BusinessPlanV2,
 * 20 sections, three-horizon decomposition) and `question-templates.json`
 * (16 pillars, 364 questions, MVP/1yr/5yr/nice horizons, DECIDE/DEFER modes).
 *
 * The state machine is per spec §1.2:
 *   INIT → PLANNING → ASKING → AWAITING_USER → INGESTING → EVALUATING
 *         ↘ if score < 82                                       ↓
 *           PLANNING ←─────────────────────────────────────  if ≥ 82
 *                                                             ↓
 *                                                       SELF_CRITIQUE
 *                                                             ↓
 *                                                       (clean) → COMPLETE → HANDOFF
 *                                                       (gaps)  → PLANNING
 *
 *   PAUSED        ← AWAITING_USER timeout / operator pause
 *   FORCE_CLOSED  ← operator override (any non-terminal state)
 */

import type { ZodIssue } from 'zod';

// ─────────────────────────────────────────────────────────────────────────
// State machine
// ─────────────────────────────────────────────────────────────────────────

export const INTERVIEW_STATES = [
  'INIT',
  'PLANNING',
  'ASKING',
  'AWAITING_USER',
  'INGESTING',
  'EVALUATING',
  'SELF_CRITIQUE',
  'COMPLETE',
  'HANDOFF',
  'PAUSED',
  'FORCE_CLOSED',
] as const;

export type InterviewState = (typeof INTERVIEW_STATES)[number];

export const TERMINAL_STATES = ['HANDOFF', 'FORCE_CLOSED'] as const satisfies readonly InterviewState[];
export type TerminalState = (typeof TERMINAL_STATES)[number];

export function isTerminal(state: InterviewState): state is TerminalState {
  return (TERMINAL_STATES as readonly InterviewState[]).includes(state);
}

// ─────────────────────────────────────────────────────────────────────────
// Pillars / horizons / decision modes
// ─────────────────────────────────────────────────────────────────────────

export const PILLAR_IDS = [
  'B1', 'B2', 'B3', 'B4', 'B5', 'B6', 'B7', 'B8',
  'B9', 'B10', 'B11', 'B12', 'B13', 'B14', 'B15', 'B16',
] as const;

export type PillarId = (typeof PILLAR_IDS)[number];

export const HORIZONS = ['MVP', '1yr', '5yr', 'nice'] as const;
export type Horizon = (typeof HORIZONS)[number];

export const DECISION_MODES = ['DECIDE', 'DEFER'] as const;
export type DecisionMode = (typeof DECISION_MODES)[number];

// ─────────────────────────────────────────────────────────────────────────
// Question bank shapes
// ─────────────────────────────────────────────────────────────────────────

export interface QuestionTemplate {
  readonly id: string;
  readonly pillar: PillarId;
  readonly pillar_name: string;
  readonly subcategory: string;
  readonly question: string;
  readonly rationale: string;
  readonly horizon: Horizon;
  readonly decision_mode: DecisionMode;
  readonly weight: number;
  readonly triggers_followups: readonly string[];
  readonly rejects_answers: readonly string[];
}

export interface PillarDefinition {
  readonly id: PillarId;
  readonly number: number;
  readonly name: string;
  readonly weight: number;
  readonly subcategories: readonly string[];
  readonly question_count: number;
  readonly questions: readonly QuestionTemplate[];
}

export interface MomTestPattern {
  readonly pattern: string;
  readonly replace_with: string;
}

export interface ClusterSizeRule {
  readonly turn_range: readonly [number, number];
  readonly questions_per_turn: number;
  readonly strategy: string;
}

export interface ColdStartFixture {
  readonly turn_number: number;
  readonly question_ids: readonly string[];
  readonly rationale: string;
}

export interface PlaybookBank {
  readonly version: string;
  readonly schema: string;
  readonly total_pillars: number;
  readonly total_questions: number;
  readonly pillars: readonly PillarDefinition[];
  readonly cluster_sizes_by_turn: readonly ClusterSizeRule[];
  readonly cold_start_fixture: ColdStartFixture;
  readonly mom_test_rejection_patterns: readonly MomTestPattern[];
  readonly horizon_mix: Readonly<Record<Horizon, number>>;
  readonly decision_mode_mix: Readonly<Record<DecisionMode, number>>;
  readonly operator_locked: string;
}

// ─────────────────────────────────────────────────────────────────────────
// Business plan — narrative wrapper around 20 sections
// ─────────────────────────────────────────────────────────────────────────

export const BUSINESS_PLAN_SECTIONS = [
  'executiveSummary',
  'problemStatement',
  'valueProposition',
  'marketOpportunity',
  'customerICP',
  'competitiveLandscape',
  'solutionScope',
  'mvpScope',
  'oneYearScope',
  'fiveYearVision',
  'businessModel',
  'unitEconomics',
  'financialPlan',
  'technicalArchitecture',
  'scalePerformance',
  'brandVoiceDesign',
  'contentSEOGrowth',
  'operationsTeam',
  'legalCompliance',
  'riskPremortem',
  'successMetrics',
] as const;

export type BusinessPlanSectionKey = (typeof BUSINESS_PLAN_SECTIONS)[number];

export const PILLAR_TO_SECTIONS: Readonly<Record<PillarId, readonly BusinessPlanSectionKey[]>> = {
  B1: ['businessModel'],
  B2: ['marketOpportunity'],
  B3: ['customerICP'],
  B4: ['competitiveLandscape'],
  B5: ['problemStatement', 'valueProposition'],
  B6: ['solutionScope', 'mvpScope'],
  B7: ['mvpScope', 'oneYearScope', 'fiveYearVision'],
  B8: ['technicalArchitecture'],
  B9: ['scalePerformance'],
  B10: ['brandVoiceDesign'],
  B11: ['contentSEOGrowth'],
  B12: ['unitEconomics', 'financialPlan'],
  B13: ['operationsTeam'],
  B14: ['legalCompliance'],
  B15: ['riskPremortem'],
  B16: ['successMetrics'],
};

// ─────────────────────────────────────────────────────────────────────────
// Turn log
// ─────────────────────────────────────────────────────────────────────────

export type TurnRole = 'agent' | 'user' | 'system';

export interface InterviewTurn {
  readonly id: string;
  readonly interviewId: string;
  readonly turnNumber: number;
  readonly role: TurnRole;
  readonly content: string;
  readonly questionIds?: readonly string[];
  readonly pillarsCovered?: readonly PillarId[];
  readonly askedAt: Date;
  readonly answeredAt: Date | null;
  readonly llmCallCount: number;
  readonly metadata?: Readonly<Record<string, unknown>>;
}

// ─────────────────────────────────────────────────────────────────────────
// Open unknowns / operator log
// ─────────────────────────────────────────────────────────────────────────

export type OpenUnknownReason =
  | 'founder_doesnt_know'
  | 'deferred_3x'
  | 'rubric_clamp'
  | 'operator_force_close';

export interface OpenUnknown {
  readonly pillar: PillarId;
  readonly question_id: string;
  readonly question: string;
  readonly suggestedDefault?: string;
  readonly blocking: boolean;
  readonly reason: OpenUnknownReason;
}

export interface OperatorDecisionEntry {
  readonly turn: number;
  readonly responderRole: 'founder' | 'operator' | 'customer';
  readonly decisionField: string;
  readonly from: string;
  readonly to: string;
  readonly rationale: string;
}

// ─────────────────────────────────────────────────────────────────────────
// Critic verdicts
// ─────────────────────────────────────────────────────────────────────────

export const CRITIC_RECOMMENDATIONS = ['meeting', 'pass_kind', 'pass_no_note'] as const;
export type CriticRecommendation = (typeof CRITIC_RECOMMENDATIONS)[number];

export const CRITIC_BLOCKER_SEVERITIES = ['blocker', 'major', 'minor'] as const;
export type CriticBlockerSeverity = (typeof CRITIC_BLOCKER_SEVERITIES)[number];

export interface CriticDecisionFactor {
  readonly factor: string;
  readonly quote: string;
  readonly sentiment: 'positive' | 'negative';
}

export interface CriticBlocker {
  readonly issue: string;
  readonly planSection: string;
  readonly severity: CriticBlockerSeverity;
}

export interface CriticPassResult {
  readonly recommendation: CriticRecommendation;
  readonly top5DecisionFactors: readonly CriticDecisionFactor[];
  readonly meetingQuestions: readonly string[];
  readonly blockers: readonly CriticBlocker[];
  readonly ranAtTurn: number;
  readonly passNumber: 1 | 2;
}

// ─────────────────────────────────────────────────────────────────────────
// Rubric / scoring
// ─────────────────────────────────────────────────────────────────────────

export const RUBRIC_DIMENSIONS = [
  'specificity',
  'internalConsistency',
  'decisionDensity',
  'buildability',
  'scopeFiniteness',
  'audienceFocus',
  'riskAwareness',
  'marketEvidence',
  'horizonDiscipline',
  'investability',
] as const;

export type RubricDimension = (typeof RUBRIC_DIMENSIONS)[number];

/** Weights per spec §5.2 — applied to 1-5 dimension scores. */
export const RUBRIC_WEIGHTS: Readonly<Record<RubricDimension, number>> = {
  specificity: 1.3,
  internalConsistency: 1.2,
  decisionDensity: 1.2,
  buildability: 1.5,
  scopeFiniteness: 1.4,
  audienceFocus: 1.1,
  riskAwareness: 0.8,
  marketEvidence: 1.3,
  horizonDiscipline: 1.4,
  investability: 1.5,
};

export interface RubricScores {
  readonly perPillarCoverage: Readonly<Record<PillarId, number>>;
  readonly dimensions: Readonly<Record<RubricDimension, number>>;
  readonly aggregateScore: number;
}

// ─────────────────────────────────────────────────────────────────────────
// Interview / orchestrator
// ─────────────────────────────────────────────────────────────────────────

export type CloseReason =
  | 'agent_complete'
  | 'operator_force'
  | 'session_timeout'
  | 'budget_exceeded';

export interface InterviewMetadata {
  readonly responderRole: 'founder' | 'operator' | 'customer';
  readonly llmCallCount: number;
  readonly llmCallBudget: number;
  readonly criticPassesRun: number;
  readonly fatigueOverrides: number;
  readonly deferralAttempts: Readonly<Record<string, number>>;
}

export interface InterviewSnapshot {
  readonly id: string;
  readonly tenantSlug: string;
  readonly operatorEmail: string;
  readonly grandIdeaPrompt: string;
  readonly state: InterviewState;
  readonly turnNumber: number;
  readonly turns: readonly InterviewTurn[];
  readonly plan: unknown;
  readonly rubric: RubricScores | null;
  readonly criticPasses: readonly CriticPassResult[];
  readonly openUnknowns: readonly OpenUnknown[];
  readonly operatorLog: readonly OperatorDecisionEntry[];
  readonly closeReason: CloseReason | null;
  readonly metadata: InterviewMetadata;
  readonly createdAt: Date;
  readonly updatedAt: Date;
}

// ─────────────────────────────────────────────────────────────────────────
// LLM call abstraction
// ─────────────────────────────────────────────────────────────────────────

export interface LlmCallOptions {
  readonly modelHint?: 'opus' | 'sonnet' | 'haiku' | string;
  readonly maxBudgetMs?: number;
  readonly systemPrompt?: string;
}

export interface LlmCallResult {
  readonly ok: boolean;
  readonly text: string;
  readonly durationMs: number;
  readonly diagnostic: string | null;
  readonly modelUsed: string;
}

export interface LlmCaller {
  call(prompt: string, opts?: LlmCallOptions): Promise<LlmCallResult>;
}

// ─────────────────────────────────────────────────────────────────────────
// Validation / parse-result helpers
// ─────────────────────────────────────────────────────────────────────────

export type ParseResult<T> =
  | { readonly ok: true; readonly value: T }
  | { readonly ok: false; readonly issues: readonly ZodIssue[]; readonly rawText: string };

// ─────────────────────────────────────────────────────────────────────────
// State transition events
// ─────────────────────────────────────────────────────────────────────────

export interface StateTransition {
  readonly from: InterviewState;
  readonly to: InterviewState;
  readonly reason: string;
  readonly turnNumber: number;
  readonly at: Date;
}
