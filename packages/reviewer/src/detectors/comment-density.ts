/**
 * comment-density detector.
 *
 * Flags new public exports added without a JSDoc-style comment block on the
 * preceding line. CAIA convention: every public surface is self-documenting
 * via JSDoc, even one-liners (so editor tooltips work for downstream
 * consumers).
 *
 * The detector reads the FULL hunk body (added + context) so it can see
 * the line before the export. If the prior line ends a JSDoc block (last
 * two chars are an asterisk and a forward slash) or starts with two
 * slashes, the export is considered documented.
 */

import type { Detector, DiffHunk } from '../types.js';
import { walkHunk } from '../diff-parser.js';
import { excerpt, isFixturePath, isJsTsSrcPath, isTestPath, makeFinding } from './shared.js';

const PUBLIC_EXPORT = /^\s*export\s+(?:async\s+)?(?:function|class|interface|type|const|enum)\s+([A-Za-z_]\w*)/;
const JSDOC_END = '*' + '/';

export const commentDensityDetector: Detector = {
  id: 'det-comment-density',
  dimension: 'comment-density',
  scan(hunk: DiffHunk, _ctx) {
    if (!isJsTsSrcPath(hunk.file)) return [];
    if (isFixturePath(hunk.file)) return [];
    if (isTestPath(hunk.file)) return [];
    const lines = walkHunk(hunk);
    const findings = [];
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      if (line === undefined) continue;
      if (line.kind !== '+') continue;
      const m = PUBLIC_EXPORT.exec(line.text);
      if (m === null) continue;
      const symbol = m[1] ?? 'export';
      // Inspect the immediately preceding NON-empty line (added or context)
      // — comment? then it's documented.
      let prev = i - 1;
      while (prev >= 0) {
        const p = lines[prev];
        if (p === undefined) break;
        if (p.text.trim() === '') {
          prev--;
          continue;
        }
        break;
      }
      if (prev >= 0) {
        const p = lines[prev];
        if (p !== undefined) {
          const prevText = p.text.trimEnd();
          if (prevText.endsWith(JSDOC_END) || prevText.trimStart().startsWith('//')) continue;
        }
      }
      findings.push(makeFinding({
        dimension: 'comment-density',
        file: hunk.file,
        line: line.newLine,
        suggestionTitle: `undocumented-export-${symbol}`,
        description: `Public export \`${symbol}\` added without a JSDoc preamble. Even a one-line JSDoc comment surfaces in editor tooltips for downstream consumers.`,
        suggestedChange: `Add a JSDoc block above \`${symbol}\` describing what it does and any non-obvious constraints.`,
        detectorId: 'det-comment-density',
        excerpt: excerpt(line.text)
      }));
    }
    return findings;
  }
};
