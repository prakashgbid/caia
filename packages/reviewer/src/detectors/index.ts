/**
 * Deterministic detector registry — see DESIGN.md §6.1.
 *
 * Each detector is a small, testable, regex/line-walk-based scanner
 * targeting one of the 10 craftsmanship dimensions where pattern matching
 * is sufficient. The remaining 8 dimensions are LLM-reasoned (see
 * `../llm-reasoner.ts`).
 */

import type { Detector } from '../types.js';

import { namingConventionDetector } from './naming-convention.js';
import { functionLengthDetector } from './function-length.js';
import { fileLengthDetector } from './file-length.js';
import { commentDensityDetector } from './comment-density.js';
import { magicNumbersDetector } from './magic-numbers.js';
import { duplicateImportsDetector } from './duplicate-imports.js';
import { deepNestingDetector } from './deep-nesting.js';
import { todoWithoutTicketDetector } from './todo-without-ticket.js';
import { consoleLoggingDetector } from './console-logging.js';
import { typeAnyDetector } from './type-any.js';

/** All deterministic detectors. Order is stable and deterministic. */
export const ALL_DETECTORS: readonly Detector[] = Object.freeze([
  namingConventionDetector,
  functionLengthDetector,
  fileLengthDetector,
  commentDensityDetector,
  magicNumbersDetector,
  duplicateImportsDetector,
  deepNestingDetector,
  todoWithoutTicketDetector,
  consoleLoggingDetector,
  typeAnyDetector
]);

export {
  namingConventionDetector,
  functionLengthDetector,
  fileLengthDetector,
  commentDensityDetector,
  magicNumbersDetector,
  duplicateImportsDetector,
  deepNestingDetector,
  todoWithoutTicketDetector,
  consoleLoggingDetector,
  typeAnyDetector
};

export { excerpt, addedTextOnly, isJsTsSrcPath, isTestPath, isDocsPath, isFixturePath } from './shared.js';
