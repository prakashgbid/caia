/**
 * Deterministic detector registry — see DESIGN.md §5.1.
 *
 * Each detector is a small, testable, regex/AST-based scanner targeting one
 * of the 18 failure-mode taxonomy categories where pattern-matching beats
 * LLM reasoning (high precision, zero LLM cost, CI-deterministic).
 *
 * The remaining 8 categories are handled by the LLM-reasoned tier
 * (`../llm-reasoner.ts`).
 */

import type { Detector } from '../types.js';

import { securityRegressionDetector } from './security-regression.js';
import { gitBranchHygieneDetector } from './git-branch-hygiene.js';
import { prematureCompletionDetector } from './premature-completion.js';
import { decisionClassifierDetector } from './decision-classifier.js';
import { reLitigationDetector } from './re-litigation.js';
import { toolMisuseDetector } from './tool-misuse.js';
import { costOverrunDetector } from './cost-overrun.js';
import { recipeRotDetector } from './recipe-rot.js';
import { falseModestyDetector } from './false-modesty.js';
import { incompletenessDetector } from './incompleteness.js';

/** All deterministic detectors. Order is stable and deterministic. */
export const ALL_DETECTORS: readonly Detector[] = Object.freeze([
  securityRegressionDetector,
  gitBranchHygieneDetector,
  prematureCompletionDetector,
  decisionClassifierDetector,
  reLitigationDetector,
  toolMisuseDetector,
  costOverrunDetector,
  recipeRotDetector,
  falseModestyDetector,
  incompletenessDetector
]);

export {
  securityRegressionDetector,
  gitBranchHygieneDetector,
  prematureCompletionDetector,
  decisionClassifierDetector,
  reLitigationDetector,
  toolMisuseDetector,
  costOverrunDetector,
  recipeRotDetector,
  falseModestyDetector,
  incompletenessDetector
};

export { excerpt, addedTextOnly } from './shared.js';
