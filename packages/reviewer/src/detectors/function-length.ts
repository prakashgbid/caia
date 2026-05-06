/**
 * function-length detector.
 *
 * Hunk-local heuristic — counts consecutive added lines inside a function
 * body started by `function`/`=>` keyword and not yet closed by a balanced
 * `}` at indent depth 0 from the function start. If the count exceeds
 * `ctx.thresholds.maxFunctionLines`, emit a `consider` finding.
 *
 * The detector deliberately uses indentation tracking rather than a full
 * AST — cheaper, deterministic, and good enough for advisory output.
 * False positives (functions inside object literals) are acceptable
 * because the suggestion is non-blocking.
 */

import type { Detector } from '../types.js';
import { walkHunk } from '../diff-parser.js';
import { excerpt, isFixturePath, isJsTsSrcPath, makeFinding } from './shared.js';

const FUNCTION_START = /\b(function|=>)\b/;

export const functionLengthDetector: Detector = {
  id: 'det-function-length',
  dimension: 'function-length',
  scan(hunk, ctx) {
    if (!isJsTsSrcPath(hunk.file)) return [];
    if (isFixturePath(hunk.file)) return [];
    const lines = walkHunk(hunk).filter(l => l.kind === '+' || l.kind === ' ');
    const findings = [];

    let inFunction = false;
    let openBraces = 0;
    let startLine = 0;
    let lineCount = 0;
    let firstLineText = '';

    for (const line of lines) {
      const text = line.text;
      if (!inFunction) {
        // Detect a function start: keyword + opening brace on this line OR
        // arrow with `{` somewhere in this line.
        if (FUNCTION_START.test(text) && text.includes('{')) {
          inFunction = true;
          openBraces = countChar(text, '{') - countChar(text, '}');
          startLine = line.kind === '+' ? line.newLine : line.oldLine;
          lineCount = 1;
          firstLineText = text;
        }
        continue;
      }
      // Already inside a function — keep counting until braces balance.
      lineCount++;
      openBraces += countChar(text, '{') - countChar(text, '}');
      if (openBraces <= 0) {
        if (lineCount > ctx.thresholds.maxFunctionLines) {
          findings.push(makeFinding({
            dimension: 'function-length',
            file: hunk.file,
            line: startLine,
            suggestionTitle: `function-length-${lineCount}`,
            description: `Function spans ${lineCount} lines (threshold: ${ctx.thresholds.maxFunctionLines}). Long functions resist comprehension; consider extracting cohesive sections into helpers.`,
            suggestedChange: 'Extract sub-blocks into well-named helper functions; aim for the function body to read like a high-level summary.',
            detectorId: 'det-function-length',
            excerpt: excerpt(firstLineText)
          }));
        }
        inFunction = false;
        openBraces = 0;
        lineCount = 0;
        startLine = 0;
        firstLineText = '';
      }
    }
    return findings;
  }
};

function countChar(s: string, ch: string): number {
  let n = 0;
  for (let i = 0; i < s.length; i++) if (s[i] === ch) n++;
  return n;
}
