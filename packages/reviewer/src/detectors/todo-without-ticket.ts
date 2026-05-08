/**
 * todo-without-ticket detector.
 *
 * Flags `TODO` / `FIXME` / `XXX` markers added without a follow-up tracker
 * reference. CAIA convention: every TODO carries either a ticket id
 * (`CAIA-1234`), a github issue (`#1234`), or an explicit timestamp
 * (`TODO(2026-05-06):`).
 */

import type { Detector } from '../types.js';
import { addedTextOnly, excerpt, isFixturePath, makeFinding } from './shared.js';

const TODO_MARKER = /\b(TODO|FIXME|XXX)\b/;
const TICKET_REF = /\b(?:CAIA-\d+|#\d+|\d{4}-\d{2}-\d{2})\b/;

export const todoWithoutTicketDetector: Detector = {
  id: 'det-todo-without-ticket',
  dimension: 'todo-without-ticket',
  scan(hunk, _ctx) {
    if (isFixturePath(hunk.file)) return [];
    const findings = [];
    for (const line of addedTextOnly(hunk)) {
      const m = TODO_MARKER.exec(line.text);
      if (m === null) continue;
      if (TICKET_REF.test(line.text)) continue;
      const marker = m[1] ?? 'TODO';
      findings.push(makeFinding({
        dimension: 'todo-without-ticket',
        file: hunk.file,
        line: line.newLine,
        suggestionTitle: `${marker.toLowerCase()}-without-ticket`,
        description: `\`${marker}\` marker added without a tracker reference (CAIA-####, #####, or YYYY-MM-DD). Untracked TODOs accumulate as silent debt.`,
        suggestedChange: `Append a ticket / issue / date — e.g. \`${marker}(CAIA-1234): description\` or \`${marker}(2026-05-06): description\`.`,
        detectorId: 'det-todo-without-ticket',
        excerpt: excerpt(line.text)
      }));
    }
    return findings;
  }
};
