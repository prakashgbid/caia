/**
 * magic-numbers detector.
 *
 * Flags numeric literals that are reasonable candidates for extraction
 * into named constants. We deliberately tune for low false positives —
 * the detector only fires when:
 *   - the literal is >= 100 OR contains an `_` digit separator
 *   - the literal is not on a `const ... =` declaration line (already named)
 *   - the file isn't a test or fixture
 *
 * Rationale: small literals (0/1/-1/2) and obvious sentinel values rarely
 * benefit from extraction; large or composite literals nearly always do.
 */

import type { Detector } from '../types.js';
import { addedTextOnly, excerpt, isFixturePath, isJsTsSrcPath, isTestPath, makeFinding } from './shared.js';

// Match large bare numbers OR numbers with underscores separators.
const MAGIC_NUMBER = /(?<![\w.])(\d{3,}|\d{1,3}(?:_\d{3,})+)(?![\w.])/g;
const ASSIGNMENT_DECLARATION = /\b(?:const|let|var|enum|readonly)\s+[A-Z_][A-Z0-9_]*\s*[:=]/;
const ARRAY_INDEX_HINT = /\[\s*\d+\s*\]/;

export const magicNumbersDetector: Detector = {
  id: 'det-magic-numbers',
  dimension: 'magic-numbers',
  scan(hunk, _ctx) {
    if (!isJsTsSrcPath(hunk.file)) return [];
    if (isTestPath(hunk.file)) return [];
    if (isFixturePath(hunk.file)) return [];
    const findings = [];
    for (const line of addedTextOnly(hunk)) {
      // Skip lines that are already a SCREAMING_SNAKE constant declaration —
      // the literal IS the named constant.
      if (ASSIGNMENT_DECLARATION.test(line.text)) continue;
      MAGIC_NUMBER.lastIndex = 0;
      let m: RegExpExecArray | null;
      while ((m = MAGIC_NUMBER.exec(line.text)) !== null) {
        const literal = m[1] ?? '';
        // Skip array-index expressions — `arr[0]` style is fine.
        if (ARRAY_INDEX_HINT.test(line.text) && literal.length < 4) continue;
        findings.push(makeFinding({
          dimension: 'magic-numbers',
          file: hunk.file,
          line: line.newLine,
          suggestionTitle: `magic-number-${literal}`,
          description: `Numeric literal \`${literal}\` used inline. Extracting to a named constant makes intent obvious and centralises the value for future tuning.`,
          suggestedChange: `Promote \`${literal}\` to a SCREAMING_SNAKE \`const\` at module-top, e.g. \`const DEFAULT_TIMEOUT_MS = ${literal};\`.`,
          detectorId: 'det-magic-numbers',
          excerpt: excerpt(line.text)
        }));
      }
    }
    return findings;
  }
};
