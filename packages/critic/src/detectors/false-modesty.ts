/**
 * false-modesty detector.
 *
 * Flags committed agent-output text that says "I cannot / I'm unable to /
 * impossible" without explicit justification. Per Mentor's taxonomy this
 * appears when the agent reflexively declines a task it could do.
 *
 * Only fires on markdown files (where committed agent output typically
 * lands) and JSON / YAML files that look like report payloads.
 */

import type { Detector } from '../types.js';
import { addedTextOnly, excerpt, makeFinding } from './shared.js';

const REPORT_PATH = /\.(md|mdx|markdown|json|yaml|yml|txt)$/i;
const MODESTY = /\b(I\s+cannot|I'?m\s+unable\s+to|impossible\s+to|I\s+can'?t)\b/i;
const JUSTIFICATION_HINT = /(security|policy|capability-broker|prohibited|safety|rule)/i;

export const falseModestyDetector: Detector = {
  id: 'det-false-modesty',
  category: 'false-modesty',
  scan(hunk, _ctx) {
    if (!REPORT_PATH.test(hunk.file)) return [];
    const findings = [];
    for (const line of addedTextOnly(hunk)) {
      if (!MODESTY.test(line.text)) continue;
      // Skip if the line includes a justification hint — those are legit
      // (capability-broker refusals, prohibited-actions explanations).
      if (JUSTIFICATION_HINT.test(line.text)) continue;
      findings.push(makeFinding({
        category: 'false-modesty',
        file: hunk.file,
        line: line.newLine,
        attackVector: 'unjustified-cant-claim',
        description: 'Added text contains an "I cannot / unable to" claim without an obvious justification. Verify the agent actually couldn\'t do the task — false-modesty is the "Keychain was right there" pattern from Mentor\'s taxonomy.',
        reproductionSteps: [
          `Read ${hunk.file} line ${line.newLine}`,
          'Cross-check whether the agent had a tool / MCP / skill that could have done the task.'
        ],
        suggestedMitigation: 'Either remove the modesty claim and do the task, OR add the specific reason (e.g. "I cannot — capability-broker prohibits credential entry per ...").',
        detectorId: 'det-false-modesty',
        excerpt: excerpt(line.text)
      }));
    }
    return findings;
  }
};
