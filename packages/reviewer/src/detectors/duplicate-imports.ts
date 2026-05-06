/**
 * duplicate-imports detector.
 *
 * Flags two `import` lines from the same module path within a single
 * hunk's added content. Common when an agent edits in two passes and
 * doesn't consolidate the imports.
 *
 * Hunk-local — won't catch a duplicate split across hunks of the same
 * file (acceptable; this is a `nit`-severity advisory).
 */

import type { Detector } from '../types.js';
import { addedTextOnly, excerpt, isFixturePath, isJsTsSrcPath, makeFinding } from './shared.js';

const IMPORT_FROM = /^\s*import\s+.*?\s+from\s+['"]([^'"]+)['"]/;

export const duplicateImportsDetector: Detector = {
  id: 'det-duplicate-imports',
  dimension: 'duplicate-imports',
  scan(hunk, _ctx) {
    if (!isJsTsSrcPath(hunk.file)) return [];
    if (isFixturePath(hunk.file)) return [];
    const findings = [];
    const seen = new Map<string, number>();
    for (const line of addedTextOnly(hunk)) {
      const m = IMPORT_FROM.exec(line.text);
      if (m === null) continue;
      const mod = m[1] ?? '';
      const firstLine = seen.get(mod);
      if (firstLine !== undefined) {
        findings.push(makeFinding({
          dimension: 'duplicate-imports',
          file: hunk.file,
          line: line.newLine,
          suggestionTitle: `duplicate-import-${mod}`,
          description: `Module \`${mod}\` imported twice in this hunk (also at line ${firstLine}). Consolidate into a single import statement.`,
          suggestedChange: `Merge the two \`import\` statements into one combined import.`,
          detectorId: 'det-duplicate-imports',
          excerpt: excerpt(line.text)
        }));
        continue;
      }
      seen.set(mod, line.newLine);
    }
    return findings;
  }
};
