/**
 * @caia/interviewer — public surface.
 *
 * Most callers only need `Interviewer` (the orchestrator) and the
 * `loadPlaybook()` helper. Lower-level building blocks are exported so
 * dashboard/CLI/REPL surfaces can compose custom flows.
 *
 * Subscription-only contract: all LLM dispatch goes through
 * `@chiefaia/claude-spawner`, which scrubs `ANTHROPIC_API_KEY` and
 * forces OAuth/keychain. There is no API-key escape hatch.
 */
// ─── Core orchestrator ───────────────────────────────────────────────────
export { Interviewer } from './interviewer.js';
// ─── Building blocks ─────────────────────────────────────────────────────
export { StateMachine, allowedTransitionsFrom, transitionGraph } from './state-machine.js';
export { QuestionGenerator, lintQuestion, clusterSizeForTurn, } from './question-generator.js';
export { BusinessPlanAccumulator, aggregateRubric, mergeDimensions, pillarCoverage, pillarFloorReport, specificityScore, buildUpdatesFromExtraction, } from './accumulator.js';
export { Critic } from './critic.js';
// ─── Persistence ─────────────────────────────────────────────────────────
export { InterviewerPersistence, MemoryInterviewerPersistence, tenantSchemaName, } from './persistence.js';
// ─── LLM dispatch ────────────────────────────────────────────────────────
export { DefaultLlmCaller, ScriptedLlmCaller, extractJsonObject } from './llm.js';
// ─── Prompts (exposed for golden tests / observability) ──────────────────
export { initExtractionPrompt, ingestExtractionPrompt, rubricEvaluationPrompt, selfCritiquePrompt, criticPassSystemPrompt, criticPassUserPrompt, } from './prompts.js';
// ─── Playbook loader ─────────────────────────────────────────────────────
export { loadPlaybook, loadPlaybookFromObject, buildPlaybookIndex, parsePlaybookBank, } from './playbook-loader.js';
// ─── Plan schema ─────────────────────────────────────────────────────────
export { businessPlanV2Schema, sectionSchema, citationSchema, openUnknownSchema, operatorDecisionEntrySchema, rubricScoresSchema, criticPassSchema, emptyBusinessPlan, getSection, setSection, } from './business-plan.js';
// ─── Types ───────────────────────────────────────────────────────────────
export { INTERVIEW_STATES, TERMINAL_STATES, isTerminal, PILLAR_IDS, HORIZONS, DECISION_MODES, BUSINESS_PLAN_SECTIONS, PILLAR_TO_SECTIONS, CRITIC_RECOMMENDATIONS, CRITIC_BLOCKER_SEVERITIES, RUBRIC_DIMENSIONS, RUBRIC_WEIGHTS, } from './types.js';
// ─── Errors ──────────────────────────────────────────────────────────────
export { InterviewerError } from './errors.js';
//# sourceMappingURL=index.js.map