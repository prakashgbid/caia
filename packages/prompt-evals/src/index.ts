/**
 * @chiefaia/prompt-evals — public API.
 *
 * Wave 1.2 of the Enterprise Wave 1 campaign per
 * agent/memory/enterprise_ai_landscape_directive.md (W1-2 — Promptfoo
 * CI eval suite). Closes the missing CI-level agent-output-quality gap
 * with a deterministic, free, fast eval gate.
 */

export { runAll, _runOneAgentForTest, _stageRawResultForTest } from './runner.js';
export type { RunOptions } from './runner.js';
export {
  baselinePath,
  loadBaseline,
  writeBaseline,
  diffAgainstBaseline
} from './baseline.js';
export { evalsDir, baselinesDir } from './paths.js';
export type {
  AgentBaseline,
  AgentEvalResult,
  BaselineDiff,
  PromptfooTestResult,
  RunSummary
} from './types.js';
