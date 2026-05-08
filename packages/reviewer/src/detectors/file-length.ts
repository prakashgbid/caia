/**
 * file-length detector.
 *
 * Flags files where the highest `newLine` number exceeds
 * `ctx.thresholds.maxFileLines`. Single finding per file (line 1).
 *
 * This is a hunk-local heuristic — we conservatively only fire when the
 * hunk itself reaches the threshold, since we don't have whole-file
 * context. False negatives (file is already 480 lines and the hunk only
 * adds 5 more) are acceptable; false positives erode trust faster.
 */

import type { Detector, DiffHunk } from '../types.js';
import { walkHunk } from '../diff-parser.js';
import { excerpt, isDocsPath, isFixturePath, isJsTsSrcPath, makeFinding } from './shared.js';

export const fileLengthDetector: Detector = {
  id: 'det-file-length',
  dimension: 'file-length',
  scan(hunk: DiffHunk, ctx) {
    if (!isJsTsSrcPath(hunk.file)) return [];
    if (isDocsPath(hunk.file)) return [];
    if (isFixturePath(hunk.file)) return [];
    // Walk all body lines; both `+` and ` ` context lines carry valid new-file
    // line numbers. Removed lines (`-`) don't appear in the new file so we
    // skip them.
    const lines = walkHunk(hunk).filter(l => l.kind === '+' || l.kind === ' ');
    if (lines.length === 0) return [];
    let lastLineNum = 0;
    for (const l of lines) {
      if (l.newLine > lastLineNum) lastLineNum = l.newLine;
    }
    if (lastLineNum <= ctx.thresholds.maxFileLines) return [];
    return [makeFinding({
      dimension: 'file-length',
      file: hunk.file,
      line: 1,
      suggestionTitle: `file-length-${lastLineNum}`,
      description: `File extends past line ${lastLineNum} (threshold: ${ctx.thresholds.maxFileLines}). Long files resist navigation; consider splitting along cohesive seams (one type / one detector / one feature per file).`,
      suggestedChange: 'Identify a cohesive sub-module and extract it. Common seams: types, helpers, dispatch table, factory functions.',
      detectorId: 'det-file-length',
      excerpt: excerpt(`file ends at line ${lastLineNum}`)
    })];
  }
};
