/**
 * decision-classifier-violation detector.
 *
 * Per feedback_decision_classifier.md the agent must "decide → execute → inform"
 * on tech matters, not present options. This detector flags added markdown,
 * commit messages, or comments that contain option-presenting phrases.
 */

import type { Detector } from '../types.js';
import { addedTextOnly, excerpt, makeFinding } from './shared.js';

// Phrases that indicate options-presentation rather than decision-making.
// Cribbed from feedback_decision_classifier.md examples.
const OPTION_PHRASES: { name: string; re: RegExp }[] = [
  { name: 'should-i', re: /\bshould\s+I\b/i },
  { name: 'want-me-to', re: /\bwant\s+me\s+to\b/i },
  { name: 'your-call', re: /\byour\s+call\b/i },
  { name: 'let-me-know-if', re: /\blet\s+me\s+know\s+if\b/i },
  { name: 'do-you-want', re: /\bdo\s+you\s+want\s+me\s+to\b/i },
  { name: 'would-you-like', re: /\bwould\s+you\s+like\s+me\s+to\b/i },
  { name: 'shall-i', re: /\bshall\s+I\b/i }
];

// Only check operator-facing files (markdown, comments in code, commit msgs
// surfaced as the diff). Source files have legit `if` branches.
const OPERATOR_FACING_PATH = /\.(md|mdx|markdown|txt)$/i;
const COMMENT_LINE = /^\s*(?:\/\/|#|--|\*)\s/;

export const decisionClassifierDetector: Detector = {
  id: 'det-decision-classifier',
  category: 'decision-classifier-violation',
  scan(hunk, _ctx) {
    const isMarkdown = OPERATOR_FACING_PATH.test(hunk.file);
    const findings = [];
    for (const line of addedTextOnly(hunk)) {
      const isComment = COMMENT_LINE.test(line.text);
      if (!isMarkdown && !isComment) continue;
      for (const phrase of OPTION_PHRASES) {
        if (phrase.re.test(line.text)) {
          findings.push(makeFinding({
            category: 'decision-classifier-violation',
            file: hunk.file,
            line: line.newLine,
            attackVector: `option-phrase-${phrase.name}`,
            description: `Operator-facing text uses an option-presenting phrase ("${phrase.name.replace(/-/g, ' ')}"). Per feedback_decision_classifier.md the agent must decide → execute → inform on tech matters, not present options.`,
            reproductionSteps: [
              `Read ${hunk.file} line ${line.newLine}`,
              'Confirm the phrase is asking the operator to make a tech decision the agent could have made itself.'
            ],
            suggestedMitigation: 'Rewrite to state the decision the agent made and why (e.g. "decided X because Y; reverting if you say so").',
            detectorId: 'det-decision-classifier',
            excerpt: excerpt(line.text)
          }));
        }
      }
    }
    return findings;
  }
};
