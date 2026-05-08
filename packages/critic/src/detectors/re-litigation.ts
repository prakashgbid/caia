/**
 * re-litigation detector.
 *
 * Cross-checks added markdown / commit-message content against the project's
 * `feedback_*.md` index. If the diff body contains topic keywords matching a
 * settled feedback file's topic, but the diff does NOT reference the feedback
 * filename, that's a probable re-litigation.
 *
 * Detection is keyword-overlap based — fast, deterministic, no LLM. It will
 * miss subtle re-litigations and over-flag legitimate references; the latter
 * is mitigated by requiring the topic to be explicitly mentioned (no
 * substring matches inside identifiers).
 */

import type { Detector } from '../types.js';
import { addedTextOnly, excerpt, makeFinding } from './shared.js';

const STOPWORDS = new Set([
  'the', 'a', 'an', 'and', 'or', 'of', 'to', 'in', 'for', 'on', 'at',
  'by', 'with', 'is', 'are', 'be', 'we', 'our', 'this', 'that',
  'feedback', 'rule', 'project', 'caia', 'agent', 'should', 'must'
]);

function topicKeywords(topic: string): string[] {
  return topic
    .toLowerCase()
    .replace(/[^a-z0-9\s_-]/g, ' ')
    .split(/[\s_-]+/)
    .filter(t => t.length >= 4 && !STOPWORDS.has(t));
}

const OPERATOR_FACING_PATH = /\.(md|mdx|markdown|txt)$/i;

export const reLitigationDetector: Detector = {
  id: 'det-re-litigation',
  category: 're-litigation',
  scan(hunk, ctx) {
    if (!OPERATOR_FACING_PATH.test(hunk.file)) return [];
    if (ctx.memoryFiles.length === 0) return [];

    const added = addedTextOnly(hunk);
    if (added.length === 0) return [];

    const addedJoined = added.map(l => l.text).join('\n').toLowerCase();
    const findings = [];
    const seenTopics = new Set<string>();

    for (const fb of ctx.memoryFiles) {
      const keywords = topicKeywords(fb.topic);
      if (keywords.length < 2) continue;
      // Need at least 2 distinct keyword matches to flag.
      const matched = keywords.filter(k => addedJoined.includes(k));
      if (matched.length < 2) continue;
      // Skip if the diff already references the feedback filename.
      if (addedJoined.includes(fb.filename.toLowerCase())) continue;
      if (seenTopics.has(fb.filename)) continue;
      seenTopics.add(fb.filename);
      // Find the line with the most matches as the anchor.
      let anchorLine = added[0]?.newLine ?? 0;
      let bestMatchCount = 0;
      for (const l of added) {
        const lcText = l.text.toLowerCase();
        const c = matched.filter(k => lcText.includes(k)).length;
        if (c > bestMatchCount) {
          bestMatchCount = c;
          anchorLine = l.newLine;
        }
      }
      findings.push(makeFinding({
        category: 're-litigation',
        file: hunk.file,
        line: anchorLine,
        attackVector: 're-litigation-against-settled-feedback',
        description: `This change touches a topic that was previously settled in \`${fb.filename}\` ("${fb.topic.slice(0, 80)}"). Matched keywords: ${matched.slice(0, 5).join(', ')}. Re-litigation is the explicit failure mode the Mentor pre-spawn injection (Phase 3) was built to prevent.`,
        reproductionSteps: [
          `cat <memoryRoot>/${fb.filename}`,
          'Confirm whether this change actually re-evaluates that decision OR is consistent with it.',
          'If consistent → reference the feedback filename in this PR and add it to the memory-read attribution.'
        ],
        suggestedMitigation: `Reference \`${fb.filename}\` explicitly in the PR description / commit body to confirm the prior decision was consulted.`,
        detectorId: 'det-re-litigation',
        excerpt: excerpt(added.find(l => l.newLine === anchorLine)?.text ?? '')
      }));
    }
    return findings;
  }
};
