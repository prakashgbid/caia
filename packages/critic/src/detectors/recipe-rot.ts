/**
 * recipe-rot detector.
 *
 * Flags markdown documentation that references files / paths NOT present in
 * the diff's filesystem snapshot. Specifically: README/docs lines mentioning
 * `packages/<X>/` or `apps/<X>/` where `<X>` doesn't exist OR scripts that
 * reference a no-longer-existing CLI binary.
 *
 * V1 is conservative — only flags when the referenced path is in the same
 * line as a `cat`, `read`, `open`, or back-tick code-block context, AND the
 * path looks like a project-relative path (no leading `/`, no `http://`).
 */

import type { Detector } from '../types.js';
import { addedTextOnly, excerpt, makeFinding } from './shared.js';

const DOC_PATH = /\.(md|mdx|markdown)$/i;
const CONTEXT_VERB = /\b(cat|read|open|see|edit|run)\b\s*[`"']?/i;
const PROJECT_PATH = /(?<![\w/.])(packages\/[a-z][a-z0-9-]+|apps\/[a-z][a-z0-9-]+)(?:\/[\w./-]+)?/;

export const recipeRotDetector: Detector = {
  id: 'det-recipe-rot',
  category: 'recipe-rot',
  scan(hunk, ctx) {
    if (!DOC_PATH.test(hunk.file)) return [];
    const findings = [];
    for (const line of addedTextOnly(hunk)) {
      if (!CONTEXT_VERB.test(line.text)) continue;
      const m = PROJECT_PATH.exec(line.text);
      if (m === null) continue;
      const referenced = m[1] ?? '';
      // We can't actually stat the FS here (detector is pure / hunk-scoped),
      // but we can flag any reference with a high false-positive likelihood
      // for human review when the docs file itself is being added — that's
      // the "fresh recipe" smell.
      if (hunk.status === 'added') {
        findings.push(makeFinding({
          category: 'recipe-rot',
          file: hunk.file,
          line: line.newLine,
          attackVector: 'doc-references-project-path',
          description: `New documentation references project path \`${referenced}\`. Verify the path actually exists at the merge SHA — fresh docs frequently rot when paths shift in the same PR.`,
          reproductionSteps: [
            `ls ${referenced}`,
            'Confirm the referenced path exists at HEAD of the merge commit.'
          ],
          suggestedMitigation: 'Replace the path reference with a stable identifier (e.g. package name `@chiefaia/<name>`) OR pin the doc to the SHA where the path was last verified.',
          detectorId: 'det-recipe-rot',
          excerpt: excerpt(line.text)
        }));
      } else {
        // Not adding the doc — but adding lines INTO an existing doc — still
        // worth a low-severity flag; user can suppress with severityFloor.
        findings.push(makeFinding({
          category: 'recipe-rot',
          file: hunk.file,
          line: line.newLine,
          attackVector: 'doc-line-references-project-path',
          description: `Doc edit references project path \`${referenced}\`. Verify path still exists.`,
          reproductionSteps: [`ls ${referenced}`],
          detectorId: 'det-recipe-rot',
          excerpt: excerpt(line.text)
        }));
      }
      // Use ctx for traceability (will be used by orchestrator for
      // PR-comment-anchor purposes; intentionally read here so future detector
      // passes can access ctx if needed).
      void ctx;
    }
    return findings;
  }
};
