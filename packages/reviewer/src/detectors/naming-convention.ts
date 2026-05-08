/**
 * naming-convention detector.
 *
 * Flags identifier choices that don't match the repo's TS conventions:
 *   - single-letter variable names outside a tiny allowlist of common iter
 *     letters (i/j/k/x/y/n/t/e), or arrow-function param idioms
 *   - snake_case identifiers in TS source (CAIA is camelCase / PascalCase)
 *
 * The detector is intentionally conservative — naming is the noisiest
 * craftsmanship dimension, so we only flag clear-cut cases.
 */

import type { Detector } from '../types.js';
import { addedTextOnly, excerpt, isFixturePath, isJsTsSrcPath, isTestPath, makeFinding } from './shared.js';

const SHORT_NAME_DECLARATION = /\b(?:const|let|var)\s+([a-z])\s*[=:]/g;
// snake_case identifier introduced as a name. We only catch declarations
// (const/let/var/function/class/type/interface) — using existing snake_case
// from a third-party API is fine.
const SNAKE_DECLARATION = /\b(?:const|let|var|function|class|type|interface)\s+([a-z]+_[a-z_]+)\b/g;
const ALLOWED_SHORT_NAMES = new Set(['i', 'j', 'k', 'x', 'y', 'n', 't', 'e', '_']);

export const namingConventionDetector: Detector = {
  id: 'det-naming-convention',
  dimension: 'naming-convention',
  scan(hunk, _ctx) {
    if (!isJsTsSrcPath(hunk.file)) return [];
    if (isFixturePath(hunk.file)) return [];
    if (isTestPath(hunk.file)) return [];
    const findings = [];
    for (const line of addedTextOnly(hunk)) {
      // Reset regex state for each line.
      SHORT_NAME_DECLARATION.lastIndex = 0;
      SNAKE_DECLARATION.lastIndex = 0;
      let m: RegExpExecArray | null;
      while ((m = SHORT_NAME_DECLARATION.exec(line.text)) !== null) {
        const name = m[1] ?? '';
        if (ALLOWED_SHORT_NAMES.has(name)) continue;
        findings.push(makeFinding({
          dimension: 'naming-convention',
          file: hunk.file,
          line: line.newLine,
          suggestionTitle: `single-letter-name-${name}`,
          description: `Single-letter variable name \`${name}\` outside the allowlisted iter set (i/j/k/x/y/n/t/e). Names should be self-describing — even loop counters benefit when the loop body is non-trivial.`,
          suggestedChange: `Rename \`${name}\` to a descriptive identifier (e.g. \`index\`, \`item\`, \`cursor\`).`,
          detectorId: 'det-naming-convention',
          excerpt: excerpt(line.text)
        }));
      }
      while ((m = SNAKE_DECLARATION.exec(line.text)) !== null) {
        const name = m[1] ?? '';
        findings.push(makeFinding({
          dimension: 'naming-convention',
          file: hunk.file,
          line: line.newLine,
          suggestionTitle: `snake-case-${name}`,
          description: `Identifier \`${name}\` uses snake_case in TypeScript source. CAIA convention (AGENTS.md "Code style") is camelCase for variables/functions and PascalCase for types/classes.`,
          suggestedChange: `Rename to camelCase (e.g. \`${snakeToCamel(name)}\`).`,
          detectorId: 'det-naming-convention',
          excerpt: excerpt(line.text)
        }));
      }
    }
    return findings;
  }
};

function snakeToCamel(s: string): string {
  return s.replace(/_([a-z])/g, (_, ch: string) => ch.toUpperCase());
}
