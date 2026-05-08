/**
 * deep-nesting detector.
 *
 * Counts leading whitespace indent units on added lines. When indent
 * exceeds `ctx.thresholds.maxNestingDepth` (default 4 — matching AGENTS.md
 * "no nesting >4 levels") we emit a `suggestion` finding pointing at the
 * deepest line.
 *
 * Indentation unit detection: 2 spaces or a tab. Mixed indentation
 * is treated as if every leading tab is one level.
 */

import type { Detector } from '../types.js';
import { addedTextOnly, excerpt, isFixturePath, isJsTsSrcPath, makeFinding } from './shared.js';

const SPACES_PER_LEVEL = 2;
const LEADING_WS = /^([ \t]*)/;

export const deepNestingDetector: Detector = {
  id: 'det-deep-nesting',
  dimension: 'deep-nesting',
  scan(hunk, ctx) {
    if (!isJsTsSrcPath(hunk.file)) return [];
    if (isFixturePath(hunk.file)) return [];
    const findings = [];
    let deepest = 0;
    let deepestLine = 0;
    let deepestText = '';
    for (const line of addedTextOnly(hunk)) {
      if (line.text.trim() === '') continue;
      const m = LEADING_WS.exec(line.text);
      const ws = m === null ? '' : (m[1] ?? '');
      // Treat each tab as one level; spaces in groups of two.
      let level = 0;
      for (let i = 0; i < ws.length; i++) {
        if (ws[i] === '\t') level++;
      }
      const spaceCount = ws.replace(/\t/g, '').length;
      level += Math.floor(spaceCount / SPACES_PER_LEVEL);
      if (level > deepest) {
        deepest = level;
        deepestLine = line.newLine;
        deepestText = line.text;
      }
    }
    if (deepest > ctx.thresholds.maxNestingDepth) {
      findings.push(makeFinding({
        dimension: 'deep-nesting',
        file: hunk.file,
        line: deepestLine,
        suggestionTitle: `nesting-depth-${deepest}`,
        description: `Indent depth ${deepest} exceeds threshold ${ctx.thresholds.maxNestingDepth}. Deep nesting hides control flow; CAIA convention (AGENTS.md "Code style") is "no nesting >4 levels".`,
        suggestedChange: 'Lift inner blocks into helpers, use early returns, or invert conditionals to flatten the structure.',
        detectorId: 'det-deep-nesting',
        excerpt: excerpt(deepestText)
      }));
    }
    return findings;
  }
};
